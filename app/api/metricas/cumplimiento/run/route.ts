/**
 * POST /api/metricas/cumplimiento/run
 *
 * Job del cron nocturno (pg_cron 00:15 UY, ver docs/sqls/2026-07-22-metricas-cumplimiento-cron.sql)
 * que puebla la tabla de hechos `metricas_cumplimiento` con la demora
 * asignado→cumplido de cada pedido/service cumplido en el rango.
 *
 * Auth: header `x-metricas-token` comparado (timing-safe, safeCompare) contra
 * env `METRICAS_CRON_TOKEN`. Gate como PRIMER paso del handler (AC4) — sin
 * token válido no se toca la BD.
 *
 * Rango: sin params, procesa el día CERRADO anterior (Montevideo) + reprocesa
 * los últimos REPROCESS_DIAS días (late arrivals) — ver defaultRunRange().
 * Acepta `?desde=&hasta=` (YYYY-MM-DD) para backfill manual (AC5).
 *
 * Idempotente: upsert por PK (origen,pedido_id,escenario) + purga de hechos
 * previos del rango que dejaron de calificar (OQ5 del plan).
 *
 * Ver docs/METRICAS_CUMPLIMIENTO.md para el modelo completo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { montevideoRangeToUtc } from '@/lib/date-utils';
import { buildFact, dedupByPk, defaultRunRange, type SourceRow, type MetricaFact, type BuildFactMotivo } from '@/lib/metricas/build-fact';
import { atribuirChofer, type HistorialEntry } from '@/lib/metricas/chofer-atribucion';
import { fetchSessionHistorial } from '@/lib/metricas/movil-session-fetch';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;
const MAX_RANGO_DIAS = 35; // clamp de seguridad — retención de origen ~1 mes

const SOURCE_COLS =
  'id, escenario, servicio_nombre, movil, zona_nro, empresa_fletera_id, orden_cancelacion, estado_nro, fch_hora_asignado, fch_hora_finalizacion, demora_movil_desde_asignacion_mins';

/**
 * Lee todos los cumplidos de una tabla dentro del rango [gte, ltExclusive),
 * paginando en bloques de PAGE_SIZE (el límite implícito de Supabase es 1000
 * filas por request — sin paginar, un día con muchos cumplidos se trunca en
 * silencio).
 */
async function fetchCumplidos(
  sb: any,
  table: 'pedidos' | 'services',
  gte: string,
  ltExclusive: string,
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from(table)
      .select(SOURCE_COLS)
      .eq('estado_nro', 2)
      .not('fch_hora_finalizacion', 'is', null)
      .gte('fch_hora_finalizacion', gte)
      .lt('fch_hora_finalizacion', ltExclusive)
      .range(from, to);

    if (error) {
      console.error(`[metricas/cumplimiento/run] error leyendo ${table} (page ${page}):`, error.message);
      break;
    }

    const batch = (data ?? []) as SourceRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

type ExistenteKey = { origen: string; pedido_id: number; escenario: number };

/**
 * Lee todas las claves (origen,pedido_id,escenario) ya persistidas en el rango
 * [desde, hasta], paginando en bloques de PAGE_SIZE (mismo motivo que
 * fetchCumplidos: sin paginar, un rango con más de 1000 hechos existentes se
 * trunca en silencio y la purga de OQ5 queda incompleta).
 */
async function fetchExistentes(sb: any, desde: string, hasta: string): Promise<ExistenteKey[]> {
  const rows: ExistenteKey[] = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('metricas_cumplimiento')
      .select('origen,pedido_id,escenario')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .range(from, to);

    if (error) {
      console.error(`[metricas/cumplimiento/run] error leyendo existentes para purga (page ${page}):`, error.message);
      break;
    }

    const batch = (data ?? []) as ExistenteKey[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1) TOKEN GATE — PRIMER paso (AC4). Sin BD tocada antes de esto.
  const expectedToken = process.env.METRICAS_CRON_TOKEN;
  if (!expectedToken) {
    console.error('[metricas/cumplimiento/run] METRICAS_CRON_TOKEN no configurado en el servidor');
    return NextResponse.json(
      { success: false, error: 'El servidor no está configurado correctamente', code: 'SERVER_MISCONFIGURED' },
      { status: 500 },
    );
  }

  const headerToken = request.headers.get('x-metricas-token');
  if (!headerToken || !safeCompare(headerToken, expectedToken)) {
    return NextResponse.json(
      { success: false, error: 'Token inválido o ausente', code: 'INVALID_TOKEN' },
      { status: 401 },
    );
  }

  // 2) Parámetros del rango.
  const sp = request.nextUrl.searchParams;
  const desdeParam = sp.get('desde');
  const hastaParam = sp.get('hasta');

  let desde: string;
  let hasta: string;

  if (desdeParam || hastaParam) {
    if (!desdeParam || !hastaParam || !DATE_RE.test(desdeParam) || !DATE_RE.test(hastaParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetros "desde" y "hasta" requeridos juntos, formato YYYY-MM-DD', code: 'INVALID_RANGE' },
        { status: 400 },
      );
    }
    desde = desdeParam;
    hasta = hastaParam;
  } else {
    const def = defaultRunRange();
    desde = def.desde;
    hasta = def.hasta;
  }

  const desdeMs = new Date(`${desde}T00:00:00Z`).getTime();
  const hastaMs = new Date(`${hasta}T00:00:00Z`).getTime();
  if (Number.isNaN(desdeMs) || Number.isNaN(hastaMs) || hastaMs < desdeMs) {
    return NextResponse.json(
      { success: false, error: 'Rango "desde"/"hasta" inválido', code: 'INVALID_RANGE' },
      { status: 400 },
    );
  }
  const rangoDias = Math.round((hastaMs - desdeMs) / 86_400_000) + 1;
  if (rangoDias > MAX_RANGO_DIAS) {
    return NextResponse.json(
      { success: false, error: `Rango máximo permitido: ${MAX_RANGO_DIAS} días`, code: 'RANGE_TOO_LARGE' },
      { status: 400 },
    );
  }

  const { gte, ltExclusive } = montevideoRangeToUtc(desde, hasta);

  // 4) Cliente service_role (bypass RLS) + cast: tabla nueva sin types generados
  // (TODO: regenerar types/supabase.ts cuando se aplique la migración en prod).
  const db = getServerSupabaseClient();
  const sb = db as any;

  // 5) Cargar cumplidos (paginado) de pedidos y services en paralelo.
  const [pedidosRows, servicesRows] = await Promise.all([
    fetchCumplidos(sb, 'pedidos', gte, ltExclusive),
    fetchCumplidos(sb, 'services', gte, ltExclusive),
  ]);

  // 6) Construir hechos: clasificar + calcular demora + atribuir chofer.
  const excluidos: Partial<Record<BuildFactMotivo, number>> = {};
  const addExcluido = (motivo: BuildFactMotivo) => {
    excluidos[motivo] = (excluidos[motivo] ?? 0) + 1;
  };

  const historialCache = new Map<string, HistorialEntry[] | null>();
  const movilesSinChofer = new Set<string>();
  let cumplidosSinMovil = 0;

  const allFacts: MetricaFact[] = [];

  async function procesarFilas(rows: SourceRow[], origen: 'PEDIDO' | 'SERVICE') {
    for (const row of rows) {
      // Validar calificación + demora sin chofer todavía (se resuelve abajo).
      const probe = buildFact(row, origen, { chofer: null });
      if (!probe.ok) {
        addExcluido(probe.motivo);
        continue;
      }

      let chofer: string | null = null;
      if (row.movil == null || row.movil === 0) {
        cumplidosSinMovil += 1;
      } else {
        const cacheKey = `${row.movil}|${probe.fact.fecha}`;
        if (!historialCache.has(cacheKey)) {
          const historial = await fetchSessionHistorial(row.movil, probe.fact.fecha);
          historialCache.set(cacheKey, historial);
        }
        const historial = historialCache.get(cacheKey) ?? null;
        chofer = atribuirChofer(historial, row.fch_hora_finalizacion as string);
        if (historial === null || chofer === null) {
          movilesSinChofer.add(cacheKey);
        }
      }

      probe.fact.chofer = chofer;
      allFacts.push(probe.fact);
    }
  }

  await procesarFilas(pedidosRows, 'PEDIDO');
  await procesarFilas(servicesRows, 'SERVICE');

  // 7) Dedup por PK (garantiza idempotencia dentro del propio batch — AC6).
  const facts = dedupByPk(allFacts);
  const qualifyingKeys = new Set(facts.map((f) => `${f.origen}|${f.pedido_id}|${f.escenario}`));

  // 8) Purga (OQ5): hechos previos del rango que dejaron de calificar.
  try {
    const existentes = await fetchExistentes(sb, desde, hasta);
    const staleKeys = existentes.filter((k) => !qualifyingKeys.has(`${k.origen}|${k.pedido_id}|${k.escenario}`));

    if (staleKeys.length > 0) {
      // Troceado en chunks (mismo motivo que UPSERT_CHUNK más abajo): un
      // .or(...) con demasiadas staleKeys concatenadas puede pegar contra
      // límites de longitud de query string de PostgREST.
      for (let i = 0; i < staleKeys.length; i += UPSERT_CHUNK) {
        const chunk = staleKeys.slice(i, i + UPSERT_CHUNK);
        const orExpr = chunk
          .map((k) => `and(origen.eq.${k.origen},pedido_id.eq.${k.pedido_id},escenario.eq.${k.escenario})`)
          .join(',');
        const { error: delError } = await sb.from('metricas_cumplimiento').delete().or(orExpr);
        if (delError) {
          console.error('[metricas/cumplimiento/run] error purgando hechos stale (chunk):', delError.message);
        }
      }
    }
  } catch (err) {
    console.error('[metricas/cumplimiento/run] excepción en purga:', (err as Error)?.message);
  }

  // 9) Upsert en chunks (ON CONFLICT tolerante a carreras — AC6).
  for (let i = 0; i < facts.length; i += UPSERT_CHUNK) {
    const chunk = facts.slice(i, i + UPSERT_CHUNK);
    const { error: upsertError } = await sb
      .from('metricas_cumplimiento')
      .upsert(chunk, { onConflict: 'origen,pedido_id,escenario' });
    if (upsertError) {
      console.error('[metricas/cumplimiento/run] error en upsert:', upsertError.message);
    }
  }

  // 10) Resumen JSON (AC7).
  return NextResponse.json({
    ok: true,
    rango: { desde, hasta },
    procesados: facts.length,
    excluidos,
    moviles_sin_chofer: movilesSinChofer.size,
    cumplidos_sin_movil: cumplidosSinMovil,
  });
}
