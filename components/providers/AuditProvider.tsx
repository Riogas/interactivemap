'use client';

/**
 * AuditProvider
 *
 * Interceptor global de window.fetch que captura cada call (método, url,
 * status, duración, tamaño response, y BODY de response cuando es JSON y
 * <= MAX_BODY_BYTES). También trackea cambios de ruta (navegación).
 *
 * Buffer: envía batches cada 5s o cada 20 eventos, y al cerrar la pestaña
 * via sendBeacon.
 *
 * Toggle ON/OFF: al montar se consulta GET /api/audit/config y se almacena
 * enabled en un ref. Cada 60s se re-consulta para detectar cambios globales.
 * Si enabled=false, el interceptor es un passthrough sin capturar nada.
 *
 * Para eventos custom (ej. Realtime status) usar lib/audit-client.ts
 * directamente (sendAuditBatch).
 */

import { ReactNode, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  sendAuditBatch,
  sendAuditBeacon,
  type AuditClientEvent,
} from '@/lib/audit-client';

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_SIZE = 20;
const MAX_BODY_BYTES = 20_000; // 20 KB máximo del response body (truncado si excede)
const IGNORED_ENDPOINTS = ['/api/audit', '/_next/', '/__nextjs'];
const CONFIG_POLL_INTERVAL_MS = 60_000; // Re-consultar el toggle cada 60s

function shouldIgnoreUrl(url: string): boolean {
  return IGNORED_ENDPOINTS.some((p) => url.includes(p));
}

function isJsonContentType(ct: string | null): boolean {
  return !!ct && ct.toLowerCase().includes('application/json');
}

/**
 * Lee el body de una Response clonada, con truncation si es muy grande.
 * Devuelve { body?, sizeBytes? }. Silencioso: nunca tira.
 */
async function readResponseBody(
  response: Response,
): Promise<{ body?: unknown; bytes?: number }> {
  if (!response.body) return {};
  const ct = response.headers.get('content-type');
  if (!isJsonContentType(ct)) return {};

  try {
    const text = await response.clone().text();
    const bytes = text.length;
    if (bytes > MAX_BODY_BYTES) {
      return {
        body: { _truncated: true, preview: text.slice(0, MAX_BODY_BYTES), original_size: bytes },
        bytes,
      };
    }
    try {
      return { body: JSON.parse(text), bytes };
    } catch {
      return { body: text, bytes };
    }
  } catch {
    return {};
  }
}

/**
 * Consulta GET /api/audit/config y retorna enabled (true/false).
 * Silencioso en caso de error — devuelve false para no capturar por defecto.
 */
async function fetchAuditEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/audit/config', { cache: 'no-store' });
    if (!res.ok) return false;
    const json = (await res.json()) as { enabled?: boolean };
    return json.enabled === true;
  } catch {
    return false;
  }
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const { user: _user } = useAuth(); // solo para re-renderizar cuando cambie el user
  const bufferRef = useRef<AuditClientEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const installedRef = useRef(false);
  const enabledRef = useRef(false);
  const loggedDisableRef = useRef(false); // para loggear solo una vez al pasar a false
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Reference para lint — el user no se usa en este efecto pero el context sí
  void _user;

  /**
   * Actualiza enabledRef con el valor remoto. Loggea transiciones relevantes.
   */
  const syncEnabled = async () => {
    const newEnabled = await fetchAuditEnabled();
    const prev = enabledRef.current;
    enabledRef.current = newEnabled;

    if (!newEnabled && prev !== newEnabled && !loggedDisableRef.current) {
      console.info('[audit] enabled=false, skipping');
      loggedDisableRef.current = true;
    }
    if (newEnabled && !prev) {
      // Al pasar de false a true, resetear la bandera de "ya logueé disable"
      loggedDisableRef.current = false;
      // Descartar buffer acumulado mientras estaba desactivado (por si acaso)
      bufferRef.current = [];
    }
  };

  // Enqueue helper — solo encola si está habilitado
  const enqueue = (event: AuditClientEvent) => {
    if (!enabledRef.current) return;
    bufferRef.current.push(event);
    if (bufferRef.current.length >= FLUSH_SIZE) {
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      sendAuditBatch(batch);
    }
  };

  // Patch de window.fetch
  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;

    // Cargar el estado inicial del toggle antes de instalar el interceptor
    void syncEnabled();

    const originalFetch = window.fetch.bind(window);

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (shouldIgnoreUrl(url)) {
        return originalFetch(input, init);
      }

      const started = Date.now();
      let status: number | undefined;
      let sizeHeader: number | undefined;
      let errorMsg: string | undefined;
      let responseForAudit: Response | undefined;

      try {
        const response = await originalFetch(input, init);
        status = response.status;
        responseForAudit = response;

        const contentLength = response.headers.get('content-length');
        if (contentLength) sizeHeader = Number(contentLength);

        return response;
      } catch (e) {
        errorMsg = (e as Error).message;
        throw e;
      } finally {
        // Si no está habilitado, no capturar nada
        if (enabledRef.current) {
        const duration = Date.now() - started;

        const isApi =
          url.includes('/api/') ||
          url.includes('/rest/v1/') ||
          url.includes('/realtime/v1/');

        if (isApi) {
          let endpoint = url;
          let query: Record<string, string> | undefined;
          try {
            const u = url.startsWith('http')
              ? new URL(url)
              : new URL(url, window.location.origin);
            endpoint = u.pathname;
            if (u.search) {
              query = Object.fromEntries(u.searchParams.entries());
            }
          } catch {
            // mantener url raw
          }

          // Capturar body si es JSON y manageable. Hacemos esto de forma
          // asincrónica después del enqueue inicial para no bloquear al caller.
          if (responseForAudit) {
            const resCopy = responseForAudit;
            void (async () => {
              // Re-verificar enabled al momento de encolar (puede haber cambiado)
              if (!enabledRef.current) return;
              const { body, bytes } = await readResponseBody(resCopy);
              enqueue({
                event_type: 'api_call',
                method,
                endpoint,
                request_query: query,
                response_status: status,
                response_size: bytes ?? sizeHeader,
                response_body: body,
                duration_ms: duration,
                error: errorMsg,
              });
            })();
          } else {
            // Request que falló antes de tener response (network error, abort, etc.)
            enqueue({
              event_type: 'api_call',
              method,
              endpoint,
              request_query: query,
              response_status: status,
              response_size: sizeHeader,
              duration_ms: duration,
              error: errorMsg,
            });
          }
        }
        } // end if (enabledRef.current)
      }
    }) as typeof window.fetch;

    flushTimerRef.current = setInterval(() => {
      if (!enabledRef.current || bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      sendAuditBatch(batch);
    }, FLUSH_INTERVAL_MS);

    // Polling del toggle cada 60s
    configPollTimerRef.current = setInterval(() => {
      void syncEnabled();
    }, CONFIG_POLL_INTERVAL_MS);

    const onBeforeUnload = () => {
      if (!enabledRef.current || bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      sendAuditBeacon(batch);
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (configPollTimerRef.current) clearInterval(configPollTimerRef.current);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trackear navegación (cambios de pathname/query)
  useEffect(() => {
    // Solo trackear si está habilitado
    if (!enabledRef.current) return;
    enqueue({
      event_type: 'navigation',
      endpoint: pathname,
      request_query: Object.fromEntries(searchParams.entries()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return <>{children}</>;
}
