/**
 * GET /api/metricas/variantes
 *
 * El scoreboard del Laboratorio de variantes (pedido de Diego, audio
 * 7/8): qué hubiera publicado cada configuración alternativa del motor
 * (otro estadístico, otro factor, otro escalón, sin escalera…) contra
 * las entregas reales, por día y acumulado, versus el Despacho y versus
 * el motor real. Incluye el control de sanidad campeon_ok.
 *
 * Cálculo en la RPC `metricas_variantes_scoreboard`
 * (docs/sqls/2026-08-07-variantes-scoreboard.sql); gates y scope
 * idénticos al resto de la pantalla de estadística cumplimiento.
 *
 * Query params: escenario (req), tipo? (URGENTE|NOCTURNO), desde?
 * (YYYY-MM-DD), hasta? (YYYY-MM-DD), tolerancia? (5..60), empresa?.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { VariantesScoreboardData } from '@/types/metricas-variantes';

export const dynamic = 'force-dynamic';

const EMPTY_DATA: VariantesScoreboardData = {
  desde: null,
  hasta: null,
  tolerancia: null,
  min_n_dia: null,
  desde_datos: null,
  campeon_ok: null,
  desfase: null,
  despacho: null,
  motor: null,
  variantes: [],
};

type SupabaseCompat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

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

  const desdeRaw = sp.get('desde');
  const hastaRaw = sp.get('hasta');
  for (const [nombre, valor] of [['desde', desdeRaw], ['hasta', hastaRaw]] as const) {
    if (valor !== null && !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      return NextResponse.json(
        { success: false, error: `Parámetro "${nombre}" inválido (YYYY-MM-DD)`, code: 'INVALID_FECHA' },
        { status: 400 },
      );
    }
  }

  const toleranciaRaw = sp.get('tolerancia');
  const tolerancia = toleranciaRaw !== null ? Number.parseInt(toleranciaRaw, 10) : null;
  if (toleranciaRaw !== null && (!Number.isFinite(tolerancia) || (tolerancia as number) < 5 || (tolerancia as number) > 60)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "tolerancia" inválido (5..60)', code: 'INVALID_TOLERANCIA' },
      { status: 400 },
    );
  }

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

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;
  const { data, error } = await db.rpc('metricas_variantes_scoreboard', {
    p: { escenario, tipo, desde: desdeRaw, hasta: hastaRaw, tolerancia, empresas: empresasParam },
  });

  if (error) {
    console.error('[metricas/variantes] error en RPC:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener el laboratorio de variantes', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_DATA) as VariantesScoreboardData });
}
