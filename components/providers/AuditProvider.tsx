'use client';

/**
 * AuditProvider
 *
 * Instala un interceptor global de window.fetch que captura cada call
 * (método, url, status, tamaño response, duración) y los encola.
 * También captura eventos de navegación (cambio de path).
 *
 * Los eventos se envían al backend en batches cada 5s o al alcanzar 20
 * eventos, lo que ocurra primero. No bloquea ninguna request del usuario
 * (fire-and-forget).
 *
 * Para no loggearse a sí mismo, ignora requests al endpoint /api/audit.
 */

import { ReactNode, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface BufferedEvent {
  event_type: 'api_call' | 'navigation' | 'custom';
  method?: string;
  endpoint?: string;
  request_body?: unknown;
  request_query?: unknown;
  response_status?: number;
  response_size?: number;
  duration_ms?: number;
  error?: string;
  extra?: unknown;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_SIZE = 20;
const IGNORED_ENDPOINTS = ['/api/audit', '/_next/', '/__nextjs'];

function shouldIgnoreUrl(url: string): boolean {
  return IGNORED_ENDPOINTS.some((p) => url.includes(p));
}

async function sendBatch(events: BufferedEvent[], userId: string, username: string) {
  if (events.length === 0) return;
  try {
    await fetch('/api/audit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-track-userid': userId,
        'x-track-user': username,
      },
      body: JSON.stringify({ events }),
      keepalive: true, // aunque el user cierre la pestaña, el browser intenta mandar
    });
  } catch {
    // no-op: si falla, pierdo el batch, no hago retry para no spamear
  }
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const bufferRef = useRef<BufferedEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const installedRef = useRef(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const userId = user?.id ?? '';
  const username = user?.username ?? '';

  // Enqueue helper
  const enqueue = (event: BufferedEvent) => {
    bufferRef.current.push(event);
    if (bufferRef.current.length >= FLUSH_SIZE) {
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      void sendBatch(batch, userId, username);
    }
  };

  // Patch de window.fetch
  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      // Saltar self-calls y assets del dev
      if (shouldIgnoreUrl(url)) {
        return originalFetch(input, init);
      }

      const started = Date.now();
      let status: number | undefined;
      let size: number | undefined;
      let errorMsg: string | undefined;

      try {
        const response = await originalFetch(input, init);
        status = response.status;

        // size estimado desde el header (si el server lo expone)
        const contentLength = response.headers.get('content-length');
        if (contentLength) size = Number(contentLength);

        return response;
      } catch (e) {
        errorMsg = (e as Error).message;
        throw e;
      } finally {
        const duration = Date.now() - started;

        // Solo loggeamos API calls (GET/POST/... a paths que parecen API).
        // El cliente hace también fetch de assets que no nos interesan.
        const isApi = url.includes('/api/') || url.includes('/rest/v1/') || url.includes('/realtime/v1/');

        if (isApi) {
          // Separar path y query
          let endpoint = url;
          let query: Record<string, string> | undefined;
          try {
            const u = url.startsWith('http') ? new URL(url) : new URL(url, window.location.origin);
            endpoint = u.pathname;
            if (u.search) {
              query = Object.fromEntries(u.searchParams.entries());
            }
          } catch {
            // mantener url raw
          }

          enqueue({
            event_type: 'api_call',
            method,
            endpoint,
            request_query: query,
            response_status: status,
            response_size: size,
            duration_ms: duration,
            error: errorMsg,
          });
        }
      }
    };

    // Flush periódico
    flushTimerRef.current = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      void sendBatch(batch, userId, username);
    }, FLUSH_INTERVAL_MS);

    // Flush al cerrar la pestaña
    const onBeforeUnload = () => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      // sendBeacon es más confiable que fetch en unload
      try {
        const blob = new Blob(
          [JSON.stringify({ events: batch })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.('/api/audit', blob);
      } catch {
        void sendBatch(batch, userId, username);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Nota: no restauramos window.fetch original porque pueden quedar
      // componentes todavía usando la versión parcheada; la app es SPA.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trackear navegación (cambios de pathname/query)
  useEffect(() => {
    enqueue({
      event_type: 'navigation',
      endpoint: pathname,
      request_query: Object.fromEntries(searchParams.entries()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return <>{children}</>;
}
