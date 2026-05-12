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

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

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
  aplica_serv_nocturno: boolean | null;
  hora_ini_nocturno: string | null;
  hora_fin_nocturno: string | null;
};

/**
 * Retorna la lista de escenarios con sus settings actuales.
 * Si un escenario no tiene row en escenario_settings, los campos usan sus defaults.
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
  ).select('escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno');

  if (settingsError) {
    console.error('[admin/escenario-settings] GET settings error:', settingsError.message);
    return NextResponse.json({ success: false, error: 'Error al leer configuracion' }, { status: 500 });
  }

  const settingsMap = new Map<number, SettingsRow>();
  for (const s of settings ?? []) {
    settingsMap.set(s.escenario_id, s);
  }

  const result = escenarioIds.map(id => {
    const s = settingsMap.get(id);
    return {
      escenarioId: id,
      nombre: escenarioMap.get(id) ?? null,
      pedidosSaMinutosAntes: s ? s.pedidos_sa_minutos_antes : null,
      aplicaServNocturno: s ? (s.aplica_serv_nocturno ?? true) : true,
      horaIniNocturno: s ? s.hora_ini_nocturno : null,
      horaFinNocturno: s ? s.hora_fin_nocturno : null,
    };
  });

  result.sort((a, b) => a.escenarioId - b.escenarioId);

  return NextResponse.json({ success: true, data: result });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

type PutBody = {
  escenarioId: unknown;
  pedidosSaMinutosAntes: unknown;
  aplica_serv_nocturno: unknown;
  horaIniNocturno: unknown;
  horaFinNocturno: unknown;
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

  const { escenarioId, pedidosSaMinutosAntes, aplica_serv_nocturno, horaIniNocturno, horaFinNocturno } = body;

  // Validar escenarioId
  if (typeof escenarioId !== 'number' || !Number.isInteger(escenarioId) || escenarioId <= 0) {
    return NextResponse.json({ success: false, error: 'escenarioId debe ser un entero positivo' }, { status: 400 });
  }

  // Validar pedidosSaMinutosAntes: null o entero >= 0
  if (pedidosSaMinutosAntes !== null && pedidosSaMinutosAntes !== undefined) {
    if (typeof pedidosSaMinutosAntes !== 'number' || !Number.isInteger(pedidosSaMinutosAntes) || pedidosSaMinutosAntes < 0) {
      return NextResponse.json(
        { success: false, error: 'pedidosSaMinutosAntes debe ser null o un entero >= 0' },
        { status: 400 }
      );
    }
  }

  // Validar aplica_serv_nocturno: boolean obligatorio si viene en el body
  if (aplica_serv_nocturno !== undefined && typeof aplica_serv_nocturno !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'aplica_serv_nocturno debe ser un boolean' },
      { status: 400 }
    );
  }

  // Validar horaIniNocturno: null o string HH:MM o HH:MM:SS
  if (horaIniNocturno !== undefined && horaIniNocturno !== null) {
    if (typeof horaIniNocturno !== 'string' || !TIME_REGEX.test(horaIniNocturno)) {
      return NextResponse.json(
        { success: false, error: 'horaIniNocturno debe ser null o un string en formato HH:MM o HH:MM:SS' },
        { status: 400 }
      );
    }
  }

  // Validar horaFinNocturno: null o string HH:MM o HH:MM:SS
  if (horaFinNocturno !== undefined && horaFinNocturno !== null) {
    if (typeof horaFinNocturno !== 'string' || !TIME_REGEX.test(horaFinNocturno)) {
      return NextResponse.json(
        { success: false, error: 'horaFinNocturno debe ser null o un string en formato HH:MM o HH:MM:SS' },
        { status: 400 }
      );
    }
  }

  const supabase = getServerSupabaseClient();

  const upsertData: Record<string, unknown> = {
    escenario_id: escenarioId,
    updated_at: new Date().toISOString(),
  };

  if (pedidosSaMinutosAntes !== undefined) {
    upsertData.pedidos_sa_minutos_antes = pedidosSaMinutosAntes as number | null;
  }
  if (aplica_serv_nocturno !== undefined) {
    upsertData.aplica_serv_nocturno = aplica_serv_nocturno as boolean;
  }
  if (horaIniNocturno !== undefined) {
    upsertData.hora_ini_nocturno = horaIniNocturno as string | null;
  }
  if (horaFinNocturno !== undefined) {
    upsertData.hora_fin_nocturno = horaFinNocturno as string | null;
  }

  const { error } = await (
    supabase.from('escenario_settings') as unknown as {
      upsert: (data: Record<string, unknown>, options?: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
    }
  ).upsert(upsertData, { onConflict: 'escenario_id' });

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
    request_body: { escenarioId, pedidosSaMinutosAntes, aplica_serv_nocturno, horaIniNocturno, horaFinNocturno },
    response_status: 200,
    source: 'server',
  });

  return NextResponse.json({ success: true });
}
