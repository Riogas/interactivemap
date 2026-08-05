/**
 * GET /api/metricas/evolucion-dia
 *
 * La sala de control del día EN VIVO: una fila por corrida del motor con
 * lo publicado (motor y Despacho), las fases del arranque predictivo y el
 * acumulado de cumplimiento calculado directo de `pedidos` (sin esperar
 * el job nocturno). Todo el cálculo vive en la RPC
 * `metricas_evolucion_dia` (docs/sqls/2026-08-05-evolucion-dia.sql);
 * este handler valida, resuelve scope y llama — mismos gates que el resto
 * de la pantalla de estadística cumplimiento.
 *
 * Query params: escenario (req), tipo? (URGENTE|NOCTURNO), fecha?
 * (YYYY-MM-DD, default hoy Montevideo), empresa? (se intersecta con el
 * scope; filtra las ENTREGAS — las corridas son publicaciones por zona).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { EvolucionDiaData } from '@/types/metricas-evolucion';

export const dynamic = 'force-dynamic';

const EMPTY_DATA: EvolucionDiaData = { fecha: null, corridas: [], resumen: null };

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

  const fechaRaw = sp.get('fecha');
  if (fechaRaw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "fecha" inválido (YYYY-MM-DD)', code: 'INVALID_FECHA' },
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
  const { data, error } = await db.rpc('metricas_evolucion_dia', {
    p: { escenario, fecha: fechaRaw, tipo, empresas: empresasParam },
  });

  if (error) {
    console.error('[metricas/evolucion-dia] error en RPC:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la evolución del día', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_DATA) as EvolucionDiaData });
}
