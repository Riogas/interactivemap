/**
 * GET  /api/audit/config — estado actual del toggle (público, sin auth)
 * POST /api/audit/config — cambia el toggle (solo root)
 *
 * GET: retorna { enabled, updated_at, updated_by }. Cache server 5s.
 * POST: body { enabled: boolean }. Auth:
 *   - JWT válido en `Authorization: Bearer ...` (firmado por Security Suite,
 *     contiene userId/username pero NO isRoot — solo prueba autenticación).
 *   - Header `x-track-isroot: 'S'` indicando que el cliente reporta ser root.
 *     Mismo patrón que /api/audit (header `x-track-user` confiado del cliente).
 *     La seguridad es consistente con el resto del codebase: los gates admin
 *     son client-side. Para endurecer en el futuro habría que añadir un check
 *     contra el Security Suite o una tabla de roles en la DB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

// ─── helpers ────────────────────────────────────────────────────────────────

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

interface AuditSettingsRow {
  id: number;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

async function readSettings(): Promise<AuditSettingsRow | null> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await (
    supabase.from('audit_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          single: () => Promise<{ data: AuditSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select('id, enabled, updated_at, updated_by')
    .eq('id', 1)
    .single();

  if (error) {
    console.warn('[audit/config] read error:', error.message);
    return null;
  }
  return data;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const row = await readSettings();
  if (!row) {
    // Si la tabla no existe aún o está vacía, devolver default OFF
    return NextResponse.json(
      { enabled: false, updated_at: new Date().toISOString(), updated_by: null },
      {
        status: 200,
        headers: {
          // Cache 5s del lado del CDN/servidor
          'Cache-Control': 's-maxage=5, stale-while-revalidate=10',
        },
      },
    );
  }

  return NextResponse.json(
    { enabled: row.enabled, updated_at: row.updated_at, updated_by: row.updated_by ?? null },
    {
      status: 200,
      headers: {
        'Cache-Control': 's-maxage=5, stale-while-revalidate=10',
      },
    },
  );
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: JWT en Authorization: Bearer ...
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  const payload = decodeJwtPayload(authHeader.slice(7));
  if (!payload) {
    return NextResponse.json({ success: false, error: 'Token inválido' }, { status: 401 });
  }

  // El JWT del Security Suite no contiene isRoot — solo username/userId.
  // El flag de role se pasa vía header `x-track-isroot`, mismo patrón que
  // `x-track-user` en /api/audit. Confianza client-side, consistente con el
  // resto de la app.
  const isRootHeader = request.headers.get('x-track-isroot');
  if (isRootHeader !== 'S') {
    return NextResponse.json(
      { success: false, error: 'Permiso denegado — solo root puede modificar esta configuración' },
      { status: 403 },
    );
  }

  const username = String(payload.username ?? '');

  let body: { enabled: boolean } | null = null;
  try {
    body = (await request.json()) as { enabled: boolean };
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 });
  }

  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'Campo "enabled" requerido (boolean)' },
      { status: 400 },
    );
  }

  const supabase = getServerSupabaseClient();
  const now = new Date().toISOString();

  const { data, error } = await (
    supabase.from('audit_settings') as unknown as {
      update: (vals: { enabled: boolean; updated_at: string; updated_by: string }) => {
        eq: (col: string, val: number) => {
          select: (cols: string) => {
            single: () => Promise<{ data: AuditSettingsRow | null; error: { message: string } | null }>;
          };
        };
      };
    }
  )
    .update({ enabled: body.enabled, updated_at: now, updated_by: username })
    .eq('id', 1)
    .select('id, enabled, updated_at, updated_by')
    .single();

  if (error) {
    console.error('[audit/config] update error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    enabled: data!.enabled,
    updated_at: data!.updated_at,
    updated_by: data!.updated_by ?? null,
  });
}
