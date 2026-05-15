import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { logAudit } from '@/lib/audit-log';
import { recomputeMovilAndCapEntrega } from '@/lib/zonas-cap-entrega';

/**
 * POST /api/admin/recalcular-cap-entrega-all
 *
 * Recalcula zonas_cap_entrega para TODOS los moviles de TODOS los escenarios
 * (o de un escenario especifico si se pasa escenarioId en el body).
 *
 * Util para el refresh inicial tras aplicar la migration de peso_transito_alpha.
 *
 * Gate: x-track-isroot: 'S'
 *
 * Body (opcional):
 *   { "escenarioId": 1 }  — si se omite, procesa todos los escenarios
 *
 * Response:
 *   { success: true, total: N, processed: N, errors: [...] }
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

export async function POST(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  let escenarioIdFilter: number | undefined = undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body.escenarioId === 'number' && Number.isInteger(body.escenarioId) && body.escenarioId > 0) {
      escenarioIdFilter = body.escenarioId;
    }
  } catch {
    // body opcional
  }

  const supabase = getServerSupabaseClient();

  // Obtener lista de moviles (con o sin filtro de escenario)
  type MovilNroRow = { nro: number };
  type MovilQueryResult = { data: MovilNroRow[] | null; error: { message: string } | null };

  const movilesResult: MovilQueryResult = escenarioIdFilter !== undefined
    ? await (supabase
        .from('moviles') as unknown as {
          select: (cols: string) => {
            eq: (col: string, val: number) => Promise<MovilQueryResult>;
          };
        })
        .select('nro')
        .eq('escenario_id', escenarioIdFilter)
    : await (supabase
        .from('moviles') as unknown as {
          select: (cols: string) => Promise<MovilQueryResult>;
        })
        .select('nro');

  if (movilesResult.error) {
    console.error('[recalcular-cap-entrega-all] error leyendo moviles:', movilesResult.error.message);
    return NextResponse.json({ success: false, error: 'Error al leer moviles' }, { status: 500 });
  }

  const moviles = movilesResult.data ?? [];
  const total = moviles.length;
  const errors: Array<{ movilNro: number; error: string }> = [];
  let processed = 0;

  console.log(`[recalcular-cap-entrega-all] iniciando recalculo de ${total} moviles${escenarioIdFilter ? ` (escenario ${escenarioIdFilter})` : ''}...`);

  // Recalculo serial para evitar rate limiting de Supabase
  for (const m of moviles) {
    try {
      await recomputeMovilAndCapEntrega(supabase, m.nro);
      processed++;
      if (processed % 50 === 0 || processed === total) {
        console.log(`[recalcular-cap-entrega-all]: ${processed}/${total} moviles procesados...`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[recalcular-cap-entrega-all] error en movil ${m.nro}:`, msg);
      errors.push({ movilNro: m.nro, error: msg });
    }
  }

  console.log(`[recalcular-cap-entrega-all] completado. ${processed}/${total} OK, ${errors.length} errores.`);

  // Audit log
  const username = request.headers.get('x-track-user') ?? null;
  logAudit({
    username,
    event_type: 'custom',
    method: 'POST',
    endpoint: '/api/admin/recalcular-cap-entrega-all',
    request_body: { escenarioId: escenarioIdFilter ?? 'all', total, processed, errores: errors.length },
    response_status: 200,
    source: 'server',
  });

  return NextResponse.json({
    success: true,
    total,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
