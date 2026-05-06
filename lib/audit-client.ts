'use client';

/**
 * audit-client.ts
 *
 * Helper para enviar eventos de auditoría al endpoint /api/audit desde
 * cualquier código client-side. Usado por el AuditProvider (fetch
 * interceptor + navegación) y por los hooks de Realtime (cambios de
 * estado del WebSocket).
 *
 * No requiere hook ni context — lee el user actual del localStorage
 * directo. Si no hay user, igual emite el evento sin user_id.
 *
 * Fire-and-forget: nunca tira excepción, nunca bloquea.
 */

export interface AuditClientEvent {
  event_type: 'api_call' | 'navigation' | 'click' | 'custom' | 'realtime' | 'realtime_drift' | 'realtime_drift_fetch_failed';
  method?: string;
  endpoint?: string;
  request_body?: unknown;
  request_query?: unknown;
  response_status?: number;
  response_size?: number;
  response_body?: unknown;
  duration_ms?: number;
  error?: string;
  extra?: unknown;
}

interface TrackUserBlob {
  id?: string;
  username?: string;
}

function readLocalUser(): TrackUserBlob {
  if (typeof window === 'undefined') return {};
  try {
    // sessionStorage primero (sesión activa); fallback a localStorage por
    // migración suave de sesiones pre-deploy.
    const raw = window.sessionStorage.getItem('trackmovil_user')
      ?? window.localStorage.getItem('trackmovil_user');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TrackUserBlob;
    return { id: parsed.id, username: parsed.username };
  } catch {
    return {};
  }
}

export function sendAuditBatch(events: AuditClientEvent[]): void {
  if (!events.length || typeof window === 'undefined') return;
  const user = readLocalUser();

  // keepalive: aunque cierren la pestaña, el browser intenta enviarlo.
  try {
    void fetch('/api/audit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-track-userid': user.id ?? '',
        'x-track-user': user.username ?? '',
      },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {
      // no-op
    });
  } catch {
    // no-op
  }
}

export function sendAuditBeacon(events: AuditClientEvent[]): void {
  if (!events.length || typeof window === 'undefined') return;
  try {
    const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' });
    const ok = navigator.sendBeacon?.('/api/audit', blob);
    if (!ok) sendAuditBatch(events);
  } catch {
    sendAuditBatch(events);
  }
}
