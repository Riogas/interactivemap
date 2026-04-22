/**
 * POST /api/audit
 *
 * Endpoint que recibe eventos de auditoría desde el interceptor de fetch
 * del cliente (AuditProvider). El body es un array de eventos; los insertamos
 * en batch en audit_log junto con user_id/username derivados del JWT.
 *
 * Este endpoint NO pasa por rate limit (está en la exclusión del proxy) ni
 * requiere auth formal — si hay token lo usa; si no, guarda como usuario anón.
 * Motivo: queremos capturar todo incluso si el JWT expiró mientras navegaban.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit-log';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payloadB64));
  } catch {
    return null;
  }
}

interface ClientEvent {
  event_type: 'api_call' | 'navigation' | 'click' | 'custom';
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

function extractUser(req: NextRequest): { userId: string | null; username: string | null } {
  // El JWT del Security Suite va en localStorage y es reenviado por el cliente
  // como header 'x-track-user' (username) cuando el AuditProvider envía los batches.
  // No confiamos en ese header para auth, pero para audit está ok (es label informativo).
  const headerUsername = req.headers.get('x-track-user');
  const headerUserId = req.headers.get('x-track-userid');
  if (headerUsername) {
    return { userId: headerUserId, username: headerUsername };
  }

  // Fallback: si el cliente mandó el JWT en Authorization
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const decoded = decodeJwtPayload(auth.slice(7));
    if (decoded) {
      return {
        userId: String(decoded.userId ?? '') || null,
        username: String(decoded.username ?? '') || null,
      };
    }
  }

  return { userId: null, username: null };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { events?: ClientEvent[] } | null;
    if (!body?.events || !Array.isArray(body.events)) {
      return NextResponse.json({ success: false, error: 'events array requerido' }, { status: 400 });
    }

    const { userId, username } = extractUser(request);
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    // Cap a 100 eventos por batch para protección
    const events = body.events.slice(0, 100);

    for (const ev of events) {
      logAudit({
        user_id: userId,
        username,
        event_type: ev.event_type,
        method: ev.method,
        endpoint: ev.endpoint,
        request_body: ev.request_body,
        request_query: ev.request_query,
        response_status: ev.response_status,
        response_size: ev.response_size,
        duration_ms: ev.duration_ms,
        ip,
        user_agent: userAgent,
        source: 'client',
        error: ev.error,
        extra: ev.extra,
      });
    }

    return NextResponse.json({ success: true, received: events.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
