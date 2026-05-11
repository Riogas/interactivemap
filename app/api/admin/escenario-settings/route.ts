import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';

/**
 * GET  /api/admin/escenario-settings
 * POST — no aplica
 * PUT  /api/admin/escenario-settings
 *
 * Gate: header x-track-isroot: 'S'  (mismo patron que audit/config)
 */

function requireRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot !== 'S') {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NOT_ROOT' },
      { status: 403 }
    );
  }
  return true;
}

// ─── GET ────────────────────────────────────────────────────────────────────

type EscenarioRow = {
  escenario_id: number;
  nombre: string;
};

type SettingsRow = {
  escenario_id: number;
  pedidos_sa_minutos_antes: number | null;
};

/**
 * Retorna la lista de escenarios con sus settings actuales.
 * Si un escenario no tiene row en escenario_settings, pedidosSaMinutosAntes = null.
 */
export async function GET(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  const supabase = getServerSupabaseClient();

  // Obtener escenarios distintos desde empresas_fleteras
  const { data: empresas, error: empresasError } = await (
    supabase.from('empresas_fleteras') as unknown as {
      select: (cols: string) => Promise<{ data: EscenarioRow[] | null; error: { message: string } | null }>;
    }
  ).select('escenario_id, nombre');

  if (empresasError || !empresas) {
    console.error('[admin/escenario-settings] GET empresas error:', empresasError?.message);
    return NextResponse.json({ success: false, error: 'Error al leer escenarios' }, { status: 500 });
  }

  // Deduplicar escenarios
  const escenarioMap = new Map<number, string>();
  for (const e of empresas) {
    if (!escenarioMap.has(e.escenario_id)) {
      escenarioMap.set(e.escenario_id, e.nombre);
    }
  }

  const escenarioIds = Array.from(escenarioMap.keys());

  // Obtener settings existentes
  const { data: settings, error: settingsError } = await (
    supabase.from('escenario_settings') as unknown as {
      select: (cols: string) => Promise<{ data: SettingsRow[] | null; error: { message: string } | null }>;
    }
  ).select('escenario_id, pedidos_sa_minutos_antes');

  if (settingsError) {
    console.error('[admin/escenario-settings] GET settings error:', settingsError.message);
    return NextResponse.json({ success: false, error: 'Error al leer configuracion' }, { status: 500 });
  }

  const settingsMap = new Map<number, number | null>();
  for (const s of settings ?? []) {
    settingsMap.set(s.escenario_id, s.pedidos_sa_minutos_antes);
  }

  const result = escenarioIds.map(id => ({
    escenarioId: id,
    nombre: escenarioMap.get(id) ?? null,
    pedidosSaMinutosAntes: settingsMap.has(id) ? settingsMap.get(id) : null,
  }));

  result.sort((a, b) => a.escenarioId - b.escenarioId);

  return NextResponse.json({ success: true, data: result });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

type PutBody = {
  escenarioId: unknown;
  pedidosSaMinutosAntes: unknown;
};

export async function PUT(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  let body: PutBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body invalido' }, { status: 400 });
  }

  const { escenarioId, pedidosSaMinutosAntes } = body;

  // Validar escenarioId
  if (typeof escenarioId !== 'number' || !Number.isInteger(escenarioId) || escenarioId <= 0) {
    return NextResponse.json({ success: false, error: 'escenarioId debe ser un entero positivo' }, { status: 400 });
  }

  // Validar pedidosSaMinutosAntes: null o entero >= 0
  if (pedidosSaMinutosAntes !== null) {
    if (typeof pedidosSaMinutosAntes !== 'number' || !Number.isInteger(pedidosSaMinutosAntes) || pedidosSaMinutosAntes < 0) {
      return NextResponse.json(
        { success: false, error: 'pedidosSaMinutosAntes debe ser null o un entero >= 0' },
        { status: 400 }
      );
    }
  }

  const supabase = getServerSupabaseClient();

  const { error } = await (
    supabase.from('escenario_settings') as unknown as {
      upsert: (data: SettingsRow) => Promise<{ error: { message: string } | null }>;
    }
  ).upsert({
    escenario_id: escenarioId,
    pedidos_sa_minutos_antes: pedidosSaMinutosAntes as number | null,
    updated_at: new Date().toISOString(),
  } as unknown as SettingsRow);

  if (error) {
    console.error('[admin/escenario-settings] PUT error:', error.message);
    return NextResponse.json({ success: false, error: 'Error al guardar configuracion' }, { status: 500 });
  }

  // Audit log (fire-and-forget)
  const username = request.headers.get('x-track-user') ?? null;
  logAudit({
    username,
    event_type: 'custom',
    method: 'PUT',
    endpoint: '/api/admin/escenario-settings',
    request_body: { escenarioId, pedidosSaMinutosAntes },
    response_status: 200,
    source: 'server',
  });

  return NextResponse.json({ success: true });
}
