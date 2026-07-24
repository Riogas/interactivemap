/**
 * GET /api/metricas/dashboard
 *
 * Datos agregados (KPIs con percentiles exactos, tendencia, por-tipo,
 * ranking) para /dashboard/metricas-cumplimiento. Consume la RPC
 * `metricas_dashboard(p jsonb)` (ver docs/sqls/2026-07-24-metricas-dashboard-rpc.sql),
 * que lee directo de la tabla de hechos `metricas_cumplimiento` (nunca de las
 * vistas `vw_metricas_cumplimiento_*` — promediar promedios da mal).
 *
 * Query params:
 *   - escenario  (requerido, int)
 *   - desde/hasta (opcional, YYYY-MM-DD) — período elegido; si faltan, la RPC
 *     resuelve el último período disponible según `ventana` (1ra carga).
 *   - ventana    (opcional, 'diario'|'semanal'|'mensual', default 'diario')
 *   - dimension  (opcional, 'chofer'|'movil'|'zona', default 'chofer')
 *   - tipos      (opcional, CSV de tipo_servicio; vacío/ausente = todos)
 *   - empresa    (opcional, int) — empresa fletera elegida en el filtro.
 *     Se INTERSECTA server-side con el scope del header (nunca amplía).
 *
 * Auth-scope vía headers (mismo patrón que capacidad-snapshot):
 *   - x-track-isroot       : 'S' -> sin restricción de empresa (root)
 *   - x-track-empresas-ids : CSV de empresa_fletera_id del scope del caller
 *
 * Gate de funcionalidad (server-side, `lib/api-auth-gates.ts`): requiere
 * 'Estadisticas Cumplimiento' (o `x-track-isroot: S`) — reproduce server-side
 * el guard client-only de `app/dashboard/metricas-cumplimiento/layout.tsx`.
 *
 * Fail-closed (AC11 spec): no-root con header ausente/vacío -> payload vacío
 * SIN ejecutar la RPC pesada. La API nunca amplía scope: si `empresa` no
 * pertenece al set permitido de un no-root, se ignora (intersección vacía).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import type { MetricasDashboardData, Ventana, Dimension } from '@/types/metricas-dashboard';

export const dynamic = 'force-dynamic';

const VENTANAS: Ventana[] = ['diario', 'semanal', 'mensual'];
const DIMENSIONES: Dimension[] = ['chofer', 'movil', 'zona'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Supabase RPC client — tipo local: la función no está en types/supabase.ts ──
type SupabaseCompat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const EMPTY_KPIS = {
  cantidad: 0,
  promedio: null,
  mediana: null,
  p90: null,
  min: null,
  max: null,
  promedio_atraso: null,
  on_time_pct: null,
} as const;

function emptyPayload(): MetricasDashboardData {
  return {
    rango: null,
    periodo_sel: { desde: null, hasta: null },
    kpis: { ...EMPTY_KPIS },
    kpis_prev: { ...EMPTY_KPIS },
    serie: [],
    por_tipo: [],
    ranking: [],
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1) Autenticación requerida — primer paso.
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // 1a) Allowlist server-side por EMAIL (defensa contra headers spoofeables).
  //     El gate de funcionalidad y el scope de empresa viajan en headers
  //     (x-track-*) que el cliente puede forjar; este endpoint expone PII de
  //     chofer cruzando empresa, así que exigimos que el email de la sesión
  //     (verificado server-side por requireAuth) esté en una allowlist env
  //     antes de servir nada. Si METRICAS_DASHBOARD_ALLOWED_EMAILS no está
  //     seteada, se mantiene el comportamiento previo (solo gate por headers)
  //     con un warning — configurarla antes de exponer el dashboard.
  //     Fix completo (scope real por empresa para fletera) = authz server-side
  //     contra SecuritySuite, pendiente de decisión de equipo (ver doc).
  const allowGate = requireAllowlistedEmail(
    authResult.user?.email,
    process.env.METRICAS_DASHBOARD_ALLOWED_EMAILS,
  );
  if (allowGate !== true) return allowGate;

  // 1b) Gate de funcionalidad — mismo patrón que los endpoints admin/*
  // (root pasa siempre; reproduce server-side el guard client-only del layout).
  const gate = requireFuncionalidad(request, 'Estadisticas Cumplimiento');
  if (gate !== true) return gate;

  const sp = request.nextUrl.searchParams;

  // 2) Validar escenario (requerido).
  const escenarioRaw = sp.get('escenario');
  const escenario = escenarioRaw !== null ? parseInt(escenarioRaw, 10) : NaN;
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y debe ser numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  // 3) Validar ventana (opcional, default 'diario').
  const ventanaRaw = sp.get('ventana');
  const ventana: Ventana = (ventanaRaw as Ventana) ?? 'diario';
  if (ventanaRaw !== null && !VENTANAS.includes(ventanaRaw as Ventana)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "ventana" inválido: diario | semanal | mensual', code: 'INVALID_VENTANA' },
      { status: 400 },
    );
  }

  // 4) Validar dimension (opcional, default 'chofer').
  const dimensionRaw = sp.get('dimension');
  const dimension: Dimension = (dimensionRaw as Dimension) ?? 'chofer';
  if (dimensionRaw !== null && !DIMENSIONES.includes(dimensionRaw as Dimension)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "dimension" inválido: chofer | movil | zona', code: 'INVALID_DIMENSION' },
      { status: 400 },
    );
  }

  // 5) Validar desde/hasta (opcionales, formato YYYY-MM-DD si vienen).
  const desdeRaw = sp.get('desde');
  const hastaRaw = sp.get('hasta');
  if ((desdeRaw !== null && !DATE_RE.test(desdeRaw)) || (hastaRaw !== null && !DATE_RE.test(hastaRaw))) {
    return NextResponse.json(
      { success: false, error: 'Parámetros "desde"/"hasta" deben tener formato YYYY-MM-DD', code: 'INVALID_DATE' },
      { status: 400 },
    );
  }

  // 6) tipos (CSV opcional). Vacío/ausente -> null (todos los tipos, lo resuelve la RPC).
  const tiposRaw = sp.get('tipos');
  const tipos: string[] | null = tiposRaw
    ? tiposRaw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : null;

  // 7) Auth-scope desde headers (patrón capacidad-snapshot).
  const isRoot = request.headers.get('x-track-isroot') === 'S';
  let scopeEmpresaIds: number[] | null = null;
  if (!isRoot) {
    const empresasHeader = request.headers.get('x-track-empresas-ids');
    if (empresasHeader !== null && empresasHeader.trim() !== '') {
      scopeEmpresaIds = empresasHeader
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((n) => Number.isFinite(n));
    } else {
      scopeEmpresaIds = []; // fail-closed
    }
  }

  // Fail-closed: no-root sin empresas válidas -> payload vacío SIN tocar la RPC.
  if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
    return NextResponse.json({ success: true, data: emptyPayload() });
  }

  // 8) empresaSel (query "empresa", int opcional) — INTERSECCIÓN server-side,
  //    nunca amplía el scope. Root puede elegir cualquier empresa; no-root
  //    solo si está dentro de su scope (si no, queda fuera -> sin resultados,
  //    nunca espía otra empresa).
  const empresaSelRaw = sp.get('empresa');
  const empresaSel = empresaSelRaw !== null ? parseInt(empresaSelRaw, 10) : null;
  const empresaSelValida = empresaSel !== null && Number.isFinite(empresaSel);

  let empresasParam: number[] | null;
  if (isRoot) {
    empresasParam = empresaSelValida ? [empresaSel as number] : null;
  } else {
    // scopeEmpresaIds acá siempre es un array no vacío (por el fail-closed de arriba).
    empresasParam = empresaSelValida
      ? (scopeEmpresaIds ?? []).filter((id) => id === empresaSel)
      : scopeEmpresaIds;
  }

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;

  const rpcParams = {
    escenario,
    desde: desdeRaw,
    hasta: hastaRaw,
    ventana,
    dimension,
    tipos,
    empresas: empresasParam,
  };

  const { data, error } = await db.rpc('metricas_dashboard', { p: rpcParams });

  if (error) {
    console.error('[metricas/dashboard] error en RPC metricas_dashboard:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener métricas de cumplimiento', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data as MetricasDashboardData) ?? emptyPayload() });
}
