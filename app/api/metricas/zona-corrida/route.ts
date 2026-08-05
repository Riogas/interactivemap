/**
 * GET /api/metricas/zona-corrida
 *
 * La radiografía POR ZONA de una corrida del día (pedido de Diego, audio
 * 12): qué demora dio el Despacho en cada zona, qué dio el motor, la
 * brecha, la fase del arranque, y el % de acierto DEL DÍA por zona
 * calculado en vivo desde pedidos. El combo de corridas permite elegir
 * cualquier horario del día; sin `corrida` se muestra la última.
 *
 * Cálculo en la RPC `metricas_zona_corrida`
 * (docs/sqls/2026-08-05-zona-corrida.sql); gates y scope idénticos al
 * resto de la pantalla de estadística cumplimiento.
 *
 * Query params: escenario (req), tipo? (URGENTE|NOCTURNO), fecha?
 * (YYYY-MM-DD, default hoy), corrida? (ISO timestamptz), empresa?.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { ZonaCorridaData } from '@/types/metricas-evolucion';

export const dynamic = 'force-dynamic';

const EMPTY_DATA: ZonaCorridaData = { fecha: null, corrida: null, corridas: [], zonas: [] };

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

  const corridaRaw = sp.get('corrida');
  if (corridaRaw !== null && Number.isNaN(Date.parse(corridaRaw))) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "corrida" inválido (timestamp ISO)', code: 'INVALID_CORRIDA' },
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
  const { data, error } = await db.rpc('metricas_zona_corrida', {
    p: { escenario, fecha: fechaRaw, corrida: corridaRaw, tipo, empresas: empresasParam },
  });

  if (error) {
    console.error('[metricas/zona-corrida] error en RPC:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la radiografía por zona', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_DATA) as ZonaCorridaData });
}
