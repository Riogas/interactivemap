/**
 * GET /api/zonas/capacidad-snapshot
 *
 * Devuelve el snapshot consolidado de capacidad de entrega por zona.
 * Consume la vista vw_zona_capacidad (creada en docs/sqls/2026-05-22-vw-zona-capacidad.sql).
 *
 * Query params:
 *   - escenario        (requerido, int)
 *   - tipoServicio     (requerido, 'PEDIDOS' | 'SERVICES')
 *   - subFiltroPedidos (opcional, 'NOCTURNO' | 'URGENTE' | 'TODOS') — reservado para PR2
 *   - zonas            (opcional, CSV de zona_id; si se omite, devuelve todas las del scope)
 *
 * Auth-scope via headers (enviados por el cliente desde AuthContext):
 *   - x-track-isroot          : 'S' → sin restricción de empresa (ve todo)
 *   - x-track-empresas-ids    : CSV de emp_fletera_id (scope de empresa fletera)
 *   - x-track-funcs           : CSV de nombres de funcionalidades del caller
 *
 * Feature gate:
 *   - "Ped s/asignar x zona": si el caller tiene esta funcionalidad,
 *     pedidos_sin_asignar es count real y se incluye pedidos_sin_asignar_detalle.
 *     Si NO la tiene, pedidos_sin_asignar = 0 y el campo detalle se omite.
 *
 * Nota: el endpoint devuelve datos crudos (capacidad puede ser negativa).
 * El cap a 0 / -9999 es responsabilidad del cliente (PR2).
 *
 * PR: PR1 — Backend zona-capacidad-snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { MOVIL_ESTADOS_INACTIVOS } from '@/lib/movil-estados';
import { getEscenarioSettings } from '@/lib/escenario-settings';
import type { ZonaCapSnapshot, PedidoSinAsignarMini, MovilDetalleZona } from '@/types/zona-capacidad';

/**
 * Construye el límite superior de la ventana SA como ISO-8601 UTC comparable
 * contra `fch_hora_para`.
 *
 * Los pedidos almacenan fch_hora_para como timestamptz con offset CORRECTO
 * (ej. "-03:00"), por lo que la comparación se hace por INSTANTE REAL: un SA es
 * visible si su instante de inicio <= ahora + minutosAntes. Postgres normaliza
 * ambos lados a UTC automáticamente.
 *
 * (Antes esta función asumía la convención legacy "hora de pared UY etiquetada
 * +00" y restaba 3h; eso introducía un error de 3h con los datos actuales.)
 *
 * @returns string ISO-8601 UTC, o null si no hay que filtrar.
 */
function buildSaWindowEnd(serverNow: Date, minutosAntes: number | null): string | null {
  if (minutosAntes === null || minutosAntes === 0) return null;
  return new Date(serverNow.getTime() + minutosAntes * 60_000).toISOString();
}


const CAP_LOG = process.env.ENABLE_MIDDLEWARE_LOGGING === 'true';
const clog = (...args: unknown[]) => { if (CAP_LOG) console.log('[CAP-SNAPSHOT]', ...args); };

// Valores 1:1 con zonas_cap_entrega.tipo_servicio.
const TIPO_SERVICIO_ALLOWED = new Set(['URGENTE', 'SERVICE', 'NOCTURNO']);

// ─── Supabase query builder type helper ──────────────────────────────────────
// El tipo de retorno del Supabase JS client v2 es complejo y las vistas no
// están en el schema generado. Usamos un type local para las queries internas.

type SQB = {
  eq: (col: string, val: unknown) => SQB;
  in: (col: string, vals: unknown[]) => SQB;
  or: (filter: string) => SQB;
  then: Promise<{ data: unknown[] | null; error: { message: string } | null }>['then'];
};

type SupabaseCompat = {
  from: (table: string) => { select: (cols: string) => SQB };
};

// ─── Row types ────────────────────────────────────────────────────────────────

interface VwZonaCapacidadRow {
  escenario: number;
  zona: number;
  emp_fletera_id: number;
  tipo_servicio: string;
  capacidad_total: number;
  moviles_count: number;
  moviles_prioridad: number;
  moviles_transito: number;
  last_sync: string | null;
}

interface ZonaCapEntregaRow {
  zona: number;
  movil: number;
  lote_disponible: number;
  emp_fletera_id: number;
  tipo_servicio: string;
}

interface MovilZonaRow {
  movil_id: string;
  zona_id: number;
  escenario_id: number;
  prioridad_o_transito: number | null;
}

interface MovilCapRow {
  nro: number;
  capacidad: number;
  tamano_lote: number | null;
  estado_nro: number | null;
}

interface PedidoSinAsignarRow {
  id: number;
  zona_nro: number | null;
  servicio_nombre: string | null;
  fch_para: string | null;
  fch_hora_para: string | null;
  cliente_direccion: string | null;
}

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Autenticación requerida
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const sp = request.nextUrl.searchParams;

  // 2. Validar escenario (requerido)
  const escenarioRaw = sp.get('escenario');
  const escenario = escenarioRaw !== null ? parseInt(escenarioRaw, 10) : NaN;
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y debe ser numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  // 3. Validar tipoServicio (requerido) — uno de los 3 valores reales de BD
  const tipoServicio = sp.get('tipoServicio') ?? '';
  if (!TIPO_SERVICIO_ALLOWED.has(tipoServicio)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "tipoServicio" requerido: URGENTE | SERVICE | NOCTURNO', code: 'INVALID_TIPO_SERVICIO' },
      { status: 400 },
    );
  }

  // 5. zonas (opcional CSV)
  const zonasRaw = sp.get('zonas');
  const zonasFiltro: number[] | null = zonasRaw
    ? zonasRaw.split(',').map((v) => parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n))
    : null;

  // 6. Auth-scope desde headers
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

  // Fail-closed: no-root sin empresas válidas
  if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
    clog('fail-closed: no-root sin empresas_ids -> []');
    return NextResponse.json({ success: true, data: [], count: 0 });
  }

  // 7. Feature flags SA (jerarquía: "unitarios" ⊃ "x zona")
  //   - hasCount   = considera los SA en los cálculos (x zona O unitarios)
  //   - hasDetalle = incluye el detalle por pedido en el modal (SOLO unitarios)
  // Sin ninguna de las 2: pedidos_sin_asignar = 0 y no se incluye detalle.
  const funcsHeader = request.headers.get('x-track-funcs') ?? '';
  const funcs = new Set(
    funcsHeader
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  const hasUnitarios = funcs.has('Ped s/asignar unitarios');
  const hasCount = hasUnitarios || funcs.has('Ped s/asignar x zona');
  const hasDetalle = hasUnitarios;

  clog(`escenario=${escenario} tipoServicio=${tipoServicio} isRoot=${isRoot} hasCount=${hasCount} hasDetalle=${hasDetalle}`);

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;

  // ─── Helpers para construir queries con filtros condicionales ─────────────

  function buildVwQuery(): SQB {
    let q = db.from('vw_zona_capacidad')
      .select('escenario, zona, emp_fletera_id, tipo_servicio, capacidad_total, moviles_count, moviles_prioridad, moviles_transito, last_sync')
      .eq('escenario', escenario)
      .eq('tipo_servicio', tipoServicio);
    if (!isRoot && scopeEmpresaIds) q = q.in('emp_fletera_id', scopeEmpresaIds);
    if (zonasFiltro && zonasFiltro.length > 0) q = q.in('zona', zonasFiltro);
    return q;
  }

  function buildZceQuery(): SQB {
    let q = db.from('zonas_cap_entrega')
      .select('zona, movil, lote_disponible, emp_fletera_id, tipo_servicio')
      .eq('escenario', escenario)
      .eq('tipo_servicio', tipoServicio);
    if (!isRoot && scopeEmpresaIds) q = q.in('emp_fletera_id', scopeEmpresaIds);
    if (zonasFiltro && zonasFiltro.length > 0) q = q.in('zona', zonasFiltro);
    return q;
  }

  // ─── Ejecutar queries en paralelo ────────────────────────────────────────

  const [vwResult, zceResult] = await Promise.all([
    buildVwQuery() as unknown as Promise<{ data: VwZonaCapacidadRow[] | null; error: { message: string } | null }>,
    buildZceQuery() as unknown as Promise<{ data: ZonaCapEntregaRow[] | null; error: { message: string } | null }>,
  ]);

  if (vwResult.error) {
    console.error('[CAP-SNAPSHOT] Error leyendo vw_zona_capacidad:', vwResult.error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener capacidad por zona', details: vwResult.error.message },
      { status: 500 },
    );
  }

  if (zceResult.error) {
    console.error('[CAP-SNAPSHOT] Error leyendo zonas_cap_entrega:', zceResult.error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener detalle de móviles', details: zceResult.error.message },
      { status: 500 },
    );
  }

  const vwRows: VwZonaCapacidadRow[] = vwResult.data ?? [];
  const zceRows: ZonaCapEntregaRow[] = zceResult.data ?? [];
  const zonaIds = Array.from(new Set(vwRows.map((r) => r.zona)));

  if (zonaIds.length === 0) {
    return NextResponse.json({ success: true, data: [], count: 0 });
  }

  // ─── Query 3: moviles_zonas (para en_transito) ─────────────────────────────

  const movilIds = Array.from(new Set(zceRows.map((r) => String(r.movil))));
  let mzResult: { data: MovilZonaRow[] | null; error: { message: string } | null } = { data: [], error: null };
  if (movilIds.length > 0) {
    // Filtrar por el tipo de servicio activo: el detalle (en_transito) y el conteo
    // de zonas P|T deben reflejar SOLO las zonas del móvil en ese tipo de servicio.
    const mzQuery = db.from('moviles_zonas')
      .select('movil_id, zona_id, escenario_id, prioridad_o_transito')
      .in('movil_id', movilIds)
      .eq('escenario_id', escenario)
      .eq('tipo_de_servicio', tipoServicio);
    mzResult = await (mzQuery as unknown as Promise<{ data: MovilZonaRow[] | null; error: { message: string } | null }>);
  }

  if (mzResult.error) {
    console.error('[CAP-SNAPSHOT] Error leyendo moviles_zonas:', mzResult.error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener asignaciones de móviles', details: mzResult.error.message },
      { status: 500 },
    );
  }

  // ─── Query 4: moviles (para capacidad_actual, tamano_lote y estado_nro) ───────────────

  const movilIdsInt = Array.from(new Set(zceRows.map((r) => r.movil)));
  let movilCapRows: MovilCapRow[] = [];
  if (movilIdsInt.length > 0) {
    const mCapQuery = db.from('moviles')
      .select('nro, capacidad, tamano_lote, estado_nro')
      .in('nro', movilIdsInt);
    const mCapResult = await (mCapQuery as unknown as Promise<{ data: MovilCapRow[] | null; error: { message: string } | null }>);
    if (!mCapResult.error) movilCapRows = mCapResult.data ?? [];
  }

  // ─── Query 5: pedidos sin asignar (solo si hasCount) ───────────────────────
  //
  // Ventana SA transversal (R4): los SA solo se cuentan si caen dentro de la
  // ventana temporal del escenario (fch_hora_para <= ahora_servidor + minutosAntes).
  // Filtro aplicado en SQL para eficiencia. Los SA sin fch_hora_para (null) se
  // incluyen siempre (mismo criterio que isWithinSaWindow).

  let pedidosSinAsignarRows: PedidoSinAsignarRow[] = [];
  if (hasCount && zonaIds.length > 0) {
    const { pedidosSaMinutosAntes } = await getEscenarioSettings(escenario);
    const saWindowEnd = buildSaWindowEnd(new Date(), pedidosSaMinutosAntes);

    let pedQuery = db.from('pedidos')
      .select('id, zona_nro, servicio_nombre, fch_para, fch_hora_para, cliente_direccion')
      .eq('escenario', escenario)
      .eq('estado_nro', 1)
      .in('zona_nro', zonaIds)
      .or('movil.is.null,movil.eq.0');

    // Ventana SA: incluir SA dentro de la ventana O sin fecha registrada.
    if (saWindowEnd !== null) {
      pedQuery = pedQuery.or(`fch_hora_para.is.null,fch_hora_para.lte.${saWindowEnd}`);
    }

    const pedResult = await (pedQuery as unknown as Promise<{ data: PedidoSinAsignarRow[] | null; error: { message: string } | null }>);

    if (!pedResult.error) {
      pedidosSinAsignarRows = pedResult.data ?? [];
    } else {
      console.error('[CAP-SNAPSHOT] Error leyendo pedidos sin asignar:', pedResult.error.message);
      // Fallback graceful: devolvemos con pedidos_sin_asignar = 0
    }
  }

  // ─── Construir índices en memoria ─────────────────────────────────────────

  // moviles_zonas: key = `${movil_id}:${zona_id}` → en_transito
  const mzIndex = new Map<string, boolean>();
  for (const mz of mzResult.data ?? []) {
    const key = `${mz.movil_id}:${mz.zona_id}`;
    mzIndex.set(key, mz.prioridad_o_transito !== 1);
  }

  // Conteo de zonas (únicas) que cubre cada móvil, separadas en prioridad/tránsito.
  // moviles_zonas puede tener varias filas por (movil,zona) si hay multiples tipo_servicio;
  // se deduplica por zona_id usando sets.
  const movilZonasPrio = new Map<string, Set<number>>();
  const movilZonasTrans = new Map<string, Set<number>>();
  for (const mz of mzResult.data ?? []) {
    const id = String(mz.movil_id);
    const target = mz.prioridad_o_transito === 1 ? movilZonasPrio : movilZonasTrans;
    if (!target.has(id)) target.set(id, new Set());
    target.get(id)!.add(mz.zona_id);
  }
  const zonasPrioDe = (movil: number) => movilZonasPrio.get(String(movil))?.size ?? 0;
  const zonasTransDe = (movil: number) => movilZonasTrans.get(String(movil))?.size ?? 0;

  // moviles: nro → { capacidad, tamano_lote, estado_nro }
  const movilCapIndex = new Map<number, { capacidad: number; tamano_lote: number | null; estado_nro: number | null }>();
  for (const m of movilCapRows) movilCapIndex.set(m.nro, { capacidad: m.capacidad, tamano_lote: m.tamano_lote, estado_nro: m.estado_nro ?? null });

  // pedidos sin asignar: zona_nro → PedidoSinAsignarMini[]
  const pedidosIndex = new Map<number, PedidoSinAsignarMini[]>();
  for (const p of pedidosSinAsignarRows) {
    if (p.zona_nro == null) continue;
    if (!pedidosIndex.has(p.zona_nro)) pedidosIndex.set(p.zona_nro, []);
    pedidosIndex.get(p.zona_nro)!.push({
      id: p.id,
      tipo_servicio: p.servicio_nombre ?? '',
      fecha: p.fch_para ?? '',
      direccion_corta: (p.cliente_direccion ?? '').slice(0, 60),
    });
  }

  // Agregar vw_zona_capacidad por zona (suma sobre empresas del scope)
  const zonaAgg = new Map<number, { capacidad_total: number; moviles_prioridad: number; moviles_transito: number }>();
  for (const row of vwRows) {
    const prev = zonaAgg.get(row.zona) ?? { capacidad_total: 0, moviles_prioridad: 0, moviles_transito: 0 };
    zonaAgg.set(row.zona, {
      capacidad_total: prev.capacidad_total + (row.capacidad_total ?? 0),
      moviles_prioridad: prev.moviles_prioridad + (row.moviles_prioridad ?? 0),
      moviles_transito: prev.moviles_transito + (row.moviles_transito ?? 0),
    });
  }

  // zce por zona para detalle de móviles
  const zceByZona = new Map<number, ZonaCapEntregaRow[]>();
  for (const row of zceRows) {
    if (!zceByZona.has(row.zona)) zceByZona.set(row.zona, []);
    zceByZona.get(row.zona)!.push(row);
  }

  // ─── Armar respuesta ───────────────────────────────────────────────────────

  const data: ZonaCapSnapshot[] = [];
  for (const zonaId of zonaIds) {
    const agg = zonaAgg.get(zonaId);
    if (!agg) continue;

    // Dedupar por movil_id: zonas_cap_entrega tiene una fila por tipo_servicio,
    // así que un móvil que sirve URGENTE y NOCTURNO aparece 2 veces. Sumamos los
    // aportes y conservamos un solo registro por móvil.
    // Filtro read-time: se omiten móviles con estado_nro inactivo (IN {3, 5, 15}).
    // La sincronización (zonas-cap-entrega.ts) queda out of scope; este filtro
    // garantiza que el detalle y los counts sólo reflejen móviles operativos.
    const movilDedupMap = new Map<number, MovilDetalleZona>();
    for (const m of zceByZona.get(zonaId) ?? []) {
      const capData = movilCapIndex.get(m.movil);

      // Excluir móviles inactivos del detalle y del cálculo de capacidad
      if (capData && MOVIL_ESTADOS_INACTIVOS.has(capData.estado_nro as number)) continue;

      const existing = movilDedupMap.get(m.movil);
      if (existing) {
        existing.aporte_a_zona += m.lote_disponible;
        continue;
      }
      const enTransito = mzIndex.get(`${m.movil}:${zonaId}`) ?? false;
      movilDedupMap.set(m.movil, {
        movil_id: m.movil,
        lote_asignado: capData?.tamano_lote ?? 0,
        en_transito: enTransito,
        capacidad_actual: capData?.capacidad ?? 0,
        aporte_a_zona: m.lote_disponible,
        zonas_prioridad: zonasPrioDe(m.movil),
        zonas_transito: zonasTransDe(m.movil),
      });
    }
    const movilesDetalle: MovilDetalleZona[] = Array.from(movilDedupMap.values());

    // Re-derivar moviles_prioridad/transito desde el detalle deduplicado para
    // evitar la inflación que produce sumar la vista sobre múltiples tipo_servicio.
    let movilesPrioridadDedup = 0;
    let movilesTransitoDedup = 0;
    for (const m of movilesDetalle) {
      if (m.en_transito) movilesTransitoDedup += 1;
      else movilesPrioridadDedup += 1;
    }

    const snapshot: ZonaCapSnapshot = {
      zona_id: zonaId,
      capacidad_total: agg.capacidad_total,
      pedidos_sin_asignar: hasCount ? (pedidosIndex.get(zonaId)?.length ?? 0) : 0,
      moviles_prioridad: movilesPrioridadDedup,
      moviles_transito: movilesTransitoDedup,
      moviles_detalle: movilesDetalle,
    };

    // Detalle por pedido SOLO con "Ped s/asignar unitarios".
    if (hasDetalle) {
      snapshot.pedidos_sin_asignar_detalle = pedidosIndex.get(zonaId) ?? [];
    }

    data.push(snapshot);
  }

  clog(`respuesta: ${data.length} zonas`);
  return NextResponse.json({ success: true, data, count: data.length });
}
