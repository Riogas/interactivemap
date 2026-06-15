/**
 * GET  /api/realtime-config — config GLOBAL de Realtime/Intervalos (lectura pública)
 * PUT  /api/realtime-config — actualiza la config (gate: root o funcionalidad "Preferencias Globales")
 *
 * Config GLOBAL ÚNICA para todo el sistema (una sola fila id=1 en realtime_settings).
 * Antes estos 9 valores se guardaban por-usuario en user_preferences y un cambio
 * de un admin no lo veían los demás. Ahora son compartidos por todos los usuarios.
 *
 * GET es público (sin auth) porque TODO usuario logueado necesita leer la config
 * al cargar el dashboard. Cache server 5s (igual que /api/audit/config).
 *
 * Modelo de confianza del PUT: igual que /api/audit/config — header x-track-isroot
 * y/o x-track-funcs confiados client-side (consistente con el resto del codebase).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

// camelCase (cliente) ↔ snake_case (DB)
interface RealtimeSettings {
  realtimePollingReconcileSeconds: number;
  realtimeSilenceTimeoutSeconds: number;
  realtimeRefetchOnVisible: boolean;
  realtimeHeartbeatSeconds: number;
  realtimeEventsPerSecond: number;
  realtimePauseOnHiddenEnabled: boolean;
  realtimePauseOnHiddenMinutes: number;
  demorasPollingSeconds: number;
  movilesZonasPollingSeconds: number;
}

const DEFAULTS: RealtimeSettings = {
  realtimePollingReconcileSeconds: 60,
  realtimeSilenceTimeoutSeconds: 45,
  realtimeRefetchOnVisible: true,
  realtimeHeartbeatSeconds: 15,
  realtimeEventsPerSecond: 10,
  realtimePauseOnHiddenEnabled: false,
  realtimePauseOnHiddenMinutes: 15,
  demorasPollingSeconds: 120,
  movilesZonasPollingSeconds: 90,
};

interface RealtimeSettingsRow {
  id: number;
  realtime_polling_reconcile_seconds: number;
  realtime_silence_timeout_seconds: number;
  realtime_refetch_on_visible: boolean;
  realtime_heartbeat_seconds: number;
  realtime_events_per_second: number;
  realtime_pause_on_hidden_enabled: boolean;
  realtime_pause_on_hidden_minutes: number;
  demoras_polling_seconds: number;
  moviles_zonas_polling_seconds: number;
  updated_at: string;
  updated_by: string | null;
}

function rowToSettings(row: RealtimeSettingsRow): RealtimeSettings {
  return {
    realtimePollingReconcileSeconds: row.realtime_polling_reconcile_seconds,
    realtimeSilenceTimeoutSeconds: row.realtime_silence_timeout_seconds,
    realtimeRefetchOnVisible: row.realtime_refetch_on_visible,
    realtimeHeartbeatSeconds: row.realtime_heartbeat_seconds,
    realtimeEventsPerSecond: row.realtime_events_per_second,
    realtimePauseOnHiddenEnabled: row.realtime_pause_on_hidden_enabled,
    realtimePauseOnHiddenMinutes: row.realtime_pause_on_hidden_minutes,
    demorasPollingSeconds: row.demoras_polling_seconds,
    movilesZonasPollingSeconds: row.moviles_zonas_polling_seconds,
  };
}

async function readSettings(): Promise<RealtimeSettings> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await (
    supabase.from('realtime_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          maybeSingle: () => Promise<{ data: RealtimeSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn('[realtime-config] read error:', error.message);
    return DEFAULTS;
  }
  return rowToSettings(data);
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json(
    { success: true, data: settings },
    { status: 200, headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate=10' } },
  );
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

// Clamp a rangos coherentes con los sliders del modal.
function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export async function PUT(request: NextRequest) {
  // Gate: root (x-track-isroot=S) O funcionalidad "Preferencias Globales".
  // Mismo criterio que abre el modal de Preferencias Globales en el front.
  const isRootHeader = request.headers.get('x-track-isroot') === 'S';
  const funcs = new Set(
    (request.headers.get('x-track-funcs') ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  if (!isRootHeader && !funcs.has('Preferencias Globales')) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NO_FUNCIONALIDAD' },
      { status: 403 },
    );
  }

  let body: Partial<RealtimeSettings>;
  try {
    body = (await request.json()) as Partial<RealtimeSettings>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 });
  }

  const updatedBy = request.headers.get('x-track-user');

  const upsert = {
    id: 1,
    realtime_polling_reconcile_seconds: clampInt(body.realtimePollingReconcileSeconds, 0, 600, DEFAULTS.realtimePollingReconcileSeconds),
    realtime_silence_timeout_seconds: clampInt(body.realtimeSilenceTimeoutSeconds, 0, 300, DEFAULTS.realtimeSilenceTimeoutSeconds),
    realtime_refetch_on_visible: typeof body.realtimeRefetchOnVisible === 'boolean' ? body.realtimeRefetchOnVisible : DEFAULTS.realtimeRefetchOnVisible,
    realtime_heartbeat_seconds: clampInt(body.realtimeHeartbeatSeconds, 5, 60, DEFAULTS.realtimeHeartbeatSeconds),
    realtime_events_per_second: clampInt(body.realtimeEventsPerSecond, 5, 100, DEFAULTS.realtimeEventsPerSecond),
    realtime_pause_on_hidden_enabled: typeof body.realtimePauseOnHiddenEnabled === 'boolean' ? body.realtimePauseOnHiddenEnabled : DEFAULTS.realtimePauseOnHiddenEnabled,
    realtime_pause_on_hidden_minutes: clampInt(body.realtimePauseOnHiddenMinutes, 5, 60, DEFAULTS.realtimePauseOnHiddenMinutes),
    demoras_polling_seconds: clampInt(body.demorasPollingSeconds, 10, 120, DEFAULTS.demorasPollingSeconds),
    moviles_zonas_polling_seconds: clampInt(body.movilesZonasPollingSeconds, 10, 120, DEFAULTS.movilesZonasPollingSeconds),
    updated_at: new Date().toISOString(),
    updated_by: updatedBy ?? null,
  };

  const supabase = getServerSupabaseClient();
  const { data, error } = await (
    supabase.from('realtime_settings') as unknown as {
      upsert: (vals: Record<string, unknown>, opts?: { onConflict: string }) => {
        select: (cols: string) => {
          single: () => Promise<{ data: RealtimeSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .upsert(upsert, { onConflict: 'id' })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[realtime-config] update error:', error?.message);
    return NextResponse.json({ success: false, error: error?.message ?? 'Error al guardar' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: rowToSettings(data) });
}
