/**
 * GET /api/metricas/desfasaje
 *
 * Franjas de 5 minutos del desfasaje |demora proyectada − demora real| por
 * pedido entregado (URGENTE/NOCTURNO no agendados), contra la demora
 * informada del AS400 y la calculada por el motor, más la población común
 * para comparar acierto. Todo el cálculo vive en la RPC
 * `metricas_desfasaje` (docs/sqls/2026-08-03-desfasaje-demoras.sql) — este
 * handler solo valida, resuelve scope y llama.
 *
 * Query params:
 *   - escenario (requerido, int)
 *   - tipo      (opcional, URGENTE|NOCTURNO; ausente = ambos)
 *   - dias      (opcional, 7|30|90; default 30) — rango [hoy−(dias−1), hoy]
 *     en fecha Montevideo. Se manda desde/hasta explícitos a la RPC para que
 *     el rango sea el que el usuario eligió, no el que la RPC defaultee.
 *   - empresa   (opcional, int) — se INTERSECTA con el scope, nunca amplía.
 *
 * Gates (mismo orden y helpers que app/api/metricas/dashboard/route.ts —
 * la card vive en la misma pantalla y comparte su umbral de acceso):
 *   requireAuth → requireAllowlistedEmail(METRICAS_DASHBOARD_ALLOWED_EMAILS)
 *   → requireFuncionalidad('Estadisticas Cumplimiento') → scope por headers
 *   x-track-isroot / x-track-empresas-ids (fail-closed sin tocar la RPC).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { todayMontevideo } from '@/lib/date-utils';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { TipoDesfasaje, DesfasajeData } from '@/types/metricas-desfasaje';

export const dynamic = 'force-dynamic';

/** Rangos que ofrece la card. Cualquier otro valor es 400, no un default silencioso. */
const DIAS_VALIDOS = [7, 30, 90] as const;

const EMPTY_DATA: DesfasajeData = { rango: null, kpis: null, franjas: [] };

type SupabaseCompat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Resta días a un YYYY-MM-DD sin pasar por el reloj local del proceso. */
function restarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const allowGate = requireAllowlistedEmail(auth.user?.email, process.env.METRICAS_DASHBOARD_ALLOWED_EMAILS);
  if (allowGate !== true) return allowGate;

  const funcGate = requireFuncionalidad(request, 'Estadisticas Cumplimiento');
  if (funcGate !== true) return funcGate;

  const sp = request.nextUrl.searchParams;

  const escenario = Number.parseInt(sp.get('escenario') ?? '', 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const tipoRaw = sp.get('tipo');
  if (tipoRaw !== null && !TIPOS_DESFASAJE.includes(tipoRaw as TipoDesfasaje)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "tipo" inválido: URGENTE | NOCTURNO', code: 'INVALID_TIPO' },
      { status: 400 },
    );
  }
  const tipo = tipoRaw as TipoDesfasaje | null;

  const diasRaw = sp.get('dias');
  const dias = diasRaw !== null ? Number.parseInt(diasRaw, 10) : 30;
  if (!DIAS_VALIDOS.includes(dias as (typeof DIAS_VALIDOS)[number])) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "dias" inválido: 7 | 30 | 90', code: 'INVALID_DIAS' },
      { status: 400 },
    );
  }

  // Scope por headers — mismo patrón fail-closed que metricas/dashboard.
  const isRoot = request.headers.get('x-track-isroot') === 'S';
  let scopeEmpresaIds: number[] | null = null;
  if (!isRoot) {
    const empresasHeader = request.headers.get('x-track-empresas-ids');
    scopeEmpresaIds =
      empresasHeader !== null && empresasHeader.trim() !== ''
        ? empresasHeader.split(',').map((v) => Number.parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n))
        : [];
  }
  if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
    return NextResponse.json({ success: true, data: EMPTY_DATA });
  }

  // empresa elegida: intersección con el scope, nunca ampliación.
  const empresaSelRaw = sp.get('empresa');
  const empresaSel = empresaSelRaw !== null ? Number.parseInt(empresaSelRaw, 10) : null;
  const empresaSelValida = empresaSel !== null && Number.isFinite(empresaSel);

  let empresasParam: number[] | null;
  if (isRoot) {
    empresasParam = empresaSelValida ? [empresaSel as number] : null;
  } else {
    empresasParam = empresaSelValida
      ? (scopeEmpresaIds ?? []).filter((id) => id === empresaSel)
      : scopeEmpresaIds;
  }

  const hasta = todayMontevideo();
  const desde = restarDias(hasta, dias - 1);

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;
  const { data, error } = await db.rpc('metricas_desfasaje', {
    p: { escenario, desde, hasta, tipo, empresas: empresasParam },
  });

  if (error) {
    console.error('[metricas/desfasaje] error en RPC metricas_desfasaje:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener el desfasaje de demoras', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_DATA) as DesfasajeData });
}
