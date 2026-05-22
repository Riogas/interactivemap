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
 *   - x-track-funcionalidades : JSON array de nombres de funcionalidades del caller
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
import type { ZonaCapSnapshot, PedidoSinAsignarMini, MovilDetalleZona } from '@/types/zona-capacidad';

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
}

interface PedidoSinAsignarRow {
  id: number;
  zona_nro: number | null;
  cliente_nombre: string | null;
  fch_para: string | null;
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

  // 7. Feature flag "Ped s/asignar x zona"
  let hasFeature = false;
  const funcsHeader = request.headers.get('x-track-funcionalidades');
  if (funcsHeader) {
    try {
      const funcs: string[] = JSON.parse(funcsHeader);
      hasFeature = Array.isArray(funcs) && funcs.some(
        (f) => String(f).trim() === 'Ped s/asignar x zona',
      );
    } catch {
      // header malformado → sin feature (seguro)
    }
  }

  clog(`escenario=${escenario} tipoServicio=${tipoServicio} isRoot=${isRoot} hasFeature=${hasFeature}`);

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
    const mzQuery = db.from('moviles_zonas')
      .select('movil_id, zona_id, escenario_id, prioridad_o_transito')
      .in('movil_id', movilIds)
      .eq('escenario_id', escenario);
    mzResult = await (mzQuery as unknown as Promise<{ data: MovilZonaRow[] | null; error: { message: string } | null }>);
  }

  if (mzResult.error) {
    console.error('[CAP-SNAPSHOT] Error leyendo moviles_zonas:', mzResult.error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener asignaciones de móviles', details: mzResult.error.message },
      { status: 500 },
    );
  }

  // ─── Query 4: moviles (para capacidad_actual y tamano_lote) ───────────────

  const movilIdsInt = Array.from(new Set(zceRows.map((r) => r.movil)));
  let movilCapRows: MovilCapRow[] = [];
  if (movilIdsInt.length > 0) {
    const mCapQuery = db.from('moviles')
      .select('nro, capacidad, tamano_lote')
      .in('nro', movilIdsInt);
    const mCapResult = await (mCapQuery as unknown as Promise<{ data: MovilCapRow[] | null; error: { message: string } | null }>);
    if (!mCapResult.error) movilCapRows = mCapResult.data ?? [];
  }

  // ─── Query 5: pedidos sin asignar (solo si hasFeature) ─────────────────────

  let pedidosSinAsignarRows: PedidoSinAsignarRow[] = [];
  if (hasFeature && zonaIds.length > 0) {
    const pedQuery = db.from('pedidos')
      .select('id, zona_nro, cliente_nombre, fch_para, cliente_direccion')
      .eq('escenario', escenario)
      .eq('estado_nro', 1)
      .in('zona_nro', zonaIds)
      .or('movil.is.null,movil.eq.0');

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

  // moviles: nro → { capacidad, tamano_lote }
  const movilCapIndex = new Map<number, { capacidad: number; tamano_lote: number | null }>();
  for (const m of movilCapRows) movilCapIndex.set(m.nro, { capacidad: m.capacidad, tamano_lote: m.tamano_lote });

  // pedidos sin asignar: zona_nro → PedidoSinAsignarMini[]
  const pedidosIndex = new Map<number, PedidoSinAsignarMini[]>();
  for (const p of pedidosSinAsignarRows) {
    if (p.zona_nro == null) continue;
    if (!pedidosIndex.has(p.zona_nro)) pedidosIndex.set(p.zona_nro, []);
    pedidosIndex.get(p.zona_nro)!.push({
      id: p.id,
      cliente: p.cliente_nombre ?? '',
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
    const movilDedupMap = new Map<number, MovilDetalleZona>();
    for (const m of zceByZona.get(zonaId) ?? []) {
      const existing = movilDedupMap.get(m.movil);
      if (existing) {
        existing.aporte_a_zona += m.lote_disponible;
        continue;
      }
      const enTransito = mzIndex.get(`${m.movil}:${zonaId}`) ?? false;
      const capData = movilCapIndex.get(m.movil);
      movilDedupMap.set(m.movil, {
        movil_id: m.movil,
        lote_asignado: capData?.tamano_lote ?? 0,
        en_transito: enTransito,
        capacidad_actual: capData?.capacidad ?? 0,
        aporte_a_zona: m.lote_disponible,
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
      pedidos_sin_asignar: hasFeature ? (pedidosIndex.get(zonaId)?.length ?? 0) : 0,
      moviles_prioridad: movilesPrioridadDedup,
      moviles_transito: movilesTransitoDedup,
      moviles_detalle: movilesDetalle,
    };

    if (hasFeature) {
      snapshot.pedidos_sin_asignar_detalle = pedidosIndex.get(zonaId) ?? [];
    }

    data.push(snapshot);
  }

  clog(`respuesta: ${data.length} zonas`);
  return NextResponse.json({ success: true, data, count: data.length });
}
