import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { recomputeMovilAndCapEntrega } from '@/lib/zonas-cap-entrega';

/**
 * GET  /api/admin/escenario-settings
 * POST — no aplica
 * PUT  /api/admin/escenario-settings
 *
 * Gate: header x-track-isroot: 'S'  (mismo patron que audit/config)
 */

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DEFAULT_PESO_TRANSITO_ALPHA = 0.3;

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
  peso_transito_alpha: number | null;
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
  ).select('escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno, peso_transito_alpha');

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
      pesoTransitoAlpha: s ? (s.peso_transito_alpha ?? DEFAULT_PESO_TRANSITO_ALPHA) : DEFAULT_PESO_TRANSITO_ALPHA,
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
  pesoTransitoAlpha: unknown;
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

  const { escenarioId, pedidosSaMinutosAntes, aplica_serv_nocturno, horaIniNocturno, horaFinNocturno, pesoTransitoAlpha } = body;

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

  // Validar pesoTransitoAlpha: number entre 0 y 1
  let pesoTransitoAlphaValue: number | undefined = undefined;
  if (pesoTransitoAlpha !== undefined) {
    if (typeof pesoTransitoAlpha !== 'number' || isNaN(pesoTransitoAlpha) || pesoTransitoAlpha < 0 || pesoTransitoAlpha > 1) {
      return NextResponse.json(
        { success: false, error: 'pesoTransitoAlpha debe ser un numero entre 0 y 1' },
        { status: 400 }
      );
    }
    pesoTransitoAlphaValue = pesoTransitoAlpha;
  }

  const supabase = getServerSupabaseClient();

  // Leer valor anterior de pesoTransitoAlpha para detectar cambio
  let previousAlpha: number | null = null;
  if (pesoTransitoAlphaValue !== undefined) {
    const { data: prevRow } = await (
      supabase.from('escenario_settings') as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: number) => {
            maybeSingle: () => Promise<{ data: { peso_transito_alpha: number | null } | null; error: unknown }>;
          };
        };
      }
    )
      .select('peso_transito_alpha')
      .eq('escenario_id', escenarioId)
      .maybeSingle();

    previousAlpha = prevRow?.peso_transito_alpha ?? null;
  }

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
  if (pesoTransitoAlphaValue !== undefined) {
    upsertData.peso_transito_alpha = pesoTransitoAlphaValue;
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
    request_body: { escenarioId, pedidosSaMinutosAntes, aplica_serv_nocturno, horaIniNocturno, horaFinNocturno, pesoTransitoAlpha },
    response_status: 200,
    source: 'server',
  });

  // Si cambio pesoTransitoAlpha, disparar recalculo masivo de todos los moviles del escenario
  const alphaChanged =
    pesoTransitoAlphaValue !== undefined &&
    previousAlpha !== pesoTransitoAlphaValue;

  if (alphaChanged) {
    console.log(
      `[recalc-alpha] escenario=${escenarioId}: alpha cambio de ${previousAlpha} a ${pesoTransitoAlphaValue} — iniciando recalculo masivo...`
    );

    // Obtener todos los movil_nro del escenario
    const { data: movilesRows, error: movilesError } = await (
      supabase.from('moviles') as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: number) => Promise<{ data: Array<{ nro: number }> | null; error: { message: string } | null }>;
        };
      }
    )
      .select('nro')
      .eq('escenario_id', escenarioId);

    if (movilesError) {
      console.error(`[recalc-alpha] escenario=${escenarioId}: error leyendo moviles:`, movilesError.message);
      return NextResponse.json({
        success: true,
        recalc: { status: 'error', message: 'No se pudo obtener lista de moviles para recalculo' },
      });
    }

    const moviles = movilesRows ?? [];
    const total = moviles.length;
    const errors: Array<{ movilNro: number; error: string }> = [];
    let processed = 0;

    // Recalculo serial para evitar rate limiting de Supabase
    for (const m of moviles) {
      try {
        await recomputeMovilAndCapEntrega(supabase, m.nro);
        processed++;
        if (processed % 50 === 0 || processed === total) {
          console.log(`[recalc-alpha] escenario=${escenarioId}: ${processed}/${total} moviles procesados...`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[recalc-alpha] escenario=${escenarioId}: error en movil ${m.nro}:`, msg);
        errors.push({ movilNro: m.nro, error: msg });
      }
    }

    console.log(
      `[recalc-alpha] escenario=${escenarioId}: recalculo completado. ${processed}/${total} OK, ${errors.length} errores.`
    );

    return NextResponse.json({
      success: true,
      recalc: {
        status: errors.length === 0 ? 'ok' : 'partial',
        total,
        processed,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  }

  return NextResponse.json({ success: true });
}
