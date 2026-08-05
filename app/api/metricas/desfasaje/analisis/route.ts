/**
 * GET /api/metricas/desfasaje/analisis
 *
 * El análisis del acierto ("dónde y cuándo falla"): población común por
 * día (Despacho vs motor), por hora de la toma, peores zonas y peores
 * incumplimientos — todo vivo sobre metricas_cumplimiento. El cálculo
 * entero vive en la RPC `metricas_desfasaje_analisis`
 * (docs/sqls/2026-08-05-desfasaje-analisis.sql); este handler solo valida,
 * resuelve scope y llama — mismo contrato y gates que
 * app/api/metricas/desfasaje/route.ts (es la misma pantalla).
 *
 * Query params (además de los de /api/metricas/desfasaje):
 *   - fuente (opcional, informada|calculada; default informada) — qué
 *     proyección se autopsia en por_hora/por_zona/peores.
 *   - fecha  (opcional, YYYY-MM-DD) — filtra el detalle a UN día
 *     (por_dia no se filtra: es el índice del selector de días).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { todayMontevideo } from '@/lib/date-utils';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { TipoDesfasaje, FuenteAnalisis, DesfasajeAnalisisData } from '@/types/metricas-desfasaje';

export const dynamic = 'force-dynamic';

const DIAS_VALIDOS = [7, 30, 90] as const;

const EMPTY_DATA: DesfasajeAnalisisData = {
  rango: null, fuente: null, fecha: null, resumen: null,
  por_dia: [], por_hora: [], por_zona: [], peores: [],
};

type SupabaseCompat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

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
  const dias = diasRaw !== null ? Number.parseInt(diasRaw, 10) : 7;
  if (!DIAS_VALIDOS.includes(dias as (typeof DIAS_VALIDOS)[number])) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "dias" inválido: 7 | 30 | 90', code: 'INVALID_DIAS' },
      { status: 400 },
    );
  }

  const fuenteRaw = sp.get('fuente');
  if (fuenteRaw !== null && fuenteRaw !== 'informada' && fuenteRaw !== 'calculada') {
    return NextResponse.json(
      { success: false, error: 'Parámetro "fuente" inválido: informada | calculada', code: 'INVALID_FUENTE' },
      { status: 400 },
    );
  }
  const fuente: FuenteAnalisis = (fuenteRaw as FuenteAnalisis | null) ?? 'informada';

  const fechaRaw = sp.get('fecha');
  if (fechaRaw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "fecha" inválido (YYYY-MM-DD)', code: 'INVALID_FECHA' },
      { status: 400 },
    );
  }

  // Scope por headers — mismo patrón fail-closed que metricas/desfasaje.
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
  const { data, error } = await db.rpc('metricas_desfasaje_analisis', {
    p: { escenario, desde, hasta, tipo, empresas: empresasParam, fuente, fecha: fechaRaw },
  });

  if (error) {
    console.error('[metricas/desfasaje/analisis] error en RPC:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener el análisis del acierto', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_DATA) as DesfasajeAnalisisData });
}
