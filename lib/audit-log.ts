/**
 * Helper server-side para insertar eventos en public.audit_log.
 * Usa el service_role key para bypass RLS — nunca llamar desde el browser.
 */
import 'server-only';
import { getServerSupabaseClient } from '@/lib/supabase';

export type AuditEventType = 'api_call' | 'navigation' | 'click' | 'custom';
export type AuditSource = 'client' | 'server';

export interface AuditEvent {
  user_id?: string | null;
  username?: string | null;
  event_type: AuditEventType;
  method?: string | null;
  endpoint?: string | null;
  request_body?: unknown;
  request_query?: unknown;
  response_status?: number | null;
  response_size?: number | null;
  duration_ms?: number | null;
  ip?: string | null;
  user_agent?: string | null;
  source: AuditSource;
  error?: string | null;
  extra?: unknown;
}

const MAX_BODY_BYTES = 50_000; // 50 KB por campo para no explotar la DB

function truncateJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    const s = JSON.stringify(value);
    if (s.length <= MAX_BODY_BYTES) return value;
    return { _truncated: true, preview: s.slice(0, MAX_BODY_BYTES) };
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Inserta un evento en audit_log. Fire-and-forget: no bloquea al caller.
 * En caso de error, solo loguea warning — nunca tira excepción hacia arriba.
 */
export function logAudit(event: AuditEvent): void {
  const row = {
    user_id: event.user_id ?? null,
    username: event.username ?? null,
    event_type: event.event_type,
    method: event.method ?? null,
    endpoint: event.endpoint?.slice(0, 2000) ?? null,
    request_body: truncateJson(event.request_body),
    request_query: truncateJson(event.request_query),
    response_status: event.response_status ?? null,
    response_size: event.response_size ?? null,
    duration_ms: event.duration_ms ?? null,
    ip: event.ip?.slice(0, 100) ?? null,
    user_agent: event.user_agent?.slice(0, 500) ?? null,
    source: event.source,
    error: event.error?.slice(0, 2000) ?? null,
    extra: truncateJson(event.extra),
  };

  try {
    const supabase = getServerSupabaseClient();
    // La tabla audit_log no está en types/supabase.ts (generado). Cast para evitar
    // error de tipos sin regenerar schema types.
    (supabase.from('audit_log') as unknown as {
      insert: (r: typeof row) => Promise<{ error: { message: string } | null }>;
    })
      .insert(row)
      .then(({ error }) => {
        if (error) console.warn('[audit] insert error:', error.message);
      });
  } catch (e) {
    console.warn('[audit] unexpected:', (e as Error).message);
  }
}
