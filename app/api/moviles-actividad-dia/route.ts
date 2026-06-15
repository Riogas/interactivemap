import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { getMovilColor } from '@/types';
import { todayMontevideo } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/moviles-actividad-dia?fecha=YYYY-MM-DD&empresaIds=1,2,3
 *
 * Devuelve el universo de móviles con actividad en una fecha histórica:
 * pedidos ∪ services ∪ GPS de esa fecha.
 *
 * NO filtra por mostrar_en_mapa ni por estado_nro actual.
 * El estado_nro actual se incluye en la respuesta solo para ícono/tachado en UI.
 *
 * Solo para fechas pasadas (no hoy, no futuras).
 */
export async function GET(request: NextRequest) {
  // Autenticación requerida
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const fecha = searchParams.get('fecha');
    const empresaIdsParam = searchParams.get('empresaIds');

    // Validar fecha
    if (!fecha) {
      return NextResponse.json(
        { success: false, error: 'Parámetro fecha requerido (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json(
        { success: false, error: 'Formato de fecha inválido. Use YYYY-MM-DD' },
        { status: 400 },
      );
    }

    // No permitir hoy ni fechas futuras
    const today = todayMontevideo();
    if (fecha >= today) {
      return NextResponse.json(
        { success: false, error: 'Este endpoint es solo para fechas históricas (anteriores a hoy)' },
        { status: 400 },
      );
    }

    // Parsear empresaIds
    const empresaIds: number[] = empresaIdsParam
      ? empresaIdsParam
          .split(',')
          .map(id => parseInt(id.trim(), 10))
          .filter(n => Number.isFinite(n) && n > 0)
      : [];

    console.log(
      `🔍 [moviles-actividad-dia] fecha=${fecha}, empresaIds=[${empresaIds.join(',')}]`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getServerSupabaseClient() as any;

    // pedidos.fch_para → formato YYYY-MM-DD
    const fechaDash = fecha;
    // services.fch_para → formato YYYYMMDD (sin guiones, distinto al de pedidos)
    const fechaCompact = fecha.replace(/-/g, '');
    // Rangos de fecha para services.fch_hora_para (timestamp)
    const fechaIni = `${fecha}T00:00:00`;
    const fechaFin = `${fecha}T23:59:59`;
    // Inicio del día siguiente para range exclusivo en GPS
    const fechaSigDia = `${incrementDate(fecha)}T00:00:00`;

    // ─────────────────────────────────────────────────────────────────────────
    // Query 1: Móviles con pedidos en la fecha
    // Excluimos cancelados (estado_nro=2 AND sub_estado_nro=17) en JS
    // ─────────────────────────────────────────────────────────────────────────
    let pedidosQuery = supabase
      .from('pedidos')
      .select('movil, empresa_fletera_id, estado_nro, sub_estado_nro')
      .eq('fch_para', fechaDash)
      .not('movil', 'is', null)
      .neq('movil', 0);

    if (empresaIds.length > 0) {
      pedidosQuery = pedidosQuery.in('empresa_fletera_id', empresaIds);
    }

    const { data: pedidosRows, error: pedidosError } = await pedidosQuery;
    if (pedidosError) throw pedidosError;

    // ─────────────────────────────────────────────────────────────────────────
    // Query 2a: Móviles con services por fch_para (formato YYYYMMDD en services)
    // ─────────────────────────────────────────────────────────────────────────
    let servicesFchParaQuery = supabase
      .from('services')
      .select('movil, empresa_fletera_id')
      .eq('fch_para', fechaCompact)
      .not('movil', 'is', null)
      .neq('movil', 0);

    if (empresaIds.length > 0) {
      servicesFchParaQuery = servicesFchParaQuery.in('empresa_fletera_id', empresaIds);
    }

    const { data: servicesFchParaRows, error: servicesFchParaError } = await servicesFchParaQuery;
    if (servicesFchParaError) throw servicesFchParaError;

    // ─────────────────────────────────────────────────────────────────────────
    // Query 2b: Móviles con services por fch_hora_para en el rango del día
    // Dos queries separadas en vez de .or() con template strings (lección
    // supabase-or-injection-prevention: nunca .or() con input externo interpolado)
    // ─────────────────────────────────────────────────────────────────────────
    let servicesRangoQuery = supabase
      .from('services')
      .select('movil, empresa_fletera_id')
      .gte('fch_hora_para', fechaIni)
      .lte('fch_hora_para', fechaFin)
      .not('movil', 'is', null)
      .neq('movil', 0);

    if (empresaIds.length > 0) {
      servicesRangoQuery = servicesRangoQuery.in('empresa_fletera_id', empresaIds);
    }

    const { data: servicesRangoRows, error: servicesRangoError } = await servicesRangoQuery;
    if (servicesRangoError) throw servicesRangoError;

    // ─────────────────────────────────────────────────────────────────────────
    // Query 3: movil_ids TEXT con GPS en la fecha
    // Usar RPC moviles_con_gps_en_dia si existe (server-side DISTINCT, eficiente).
    // Fallback: paginación client-side con gps_tracking_history.
    // ─────────────────────────────────────────────────────────────────────────
    const gpsMovilIds = new Set<string>(); // TEXT ids (moviles.id, no .nro)

    const { data: gpsRpcData, error: gpsRpcError } = await supabase.rpc(
      'moviles_con_gps_en_dia',
      { p_date: fecha },
    );

    if (gpsRpcError) {
      // Fallback: paginación sobre gps_tracking_history
      console.warn(
        '[moviles-actividad-dia] RPC moviles_con_gps_en_dia no disponible, usando paginación:',
        gpsRpcError.message,
      );
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: pageData, error: pageErr } = await supabase
          .from('gps_tracking_history')
          .select('movil_id')
          .gte('fecha_hora', fechaIni)
          .lt('fecha_hora', fechaSigDia)
          .range(offset, offset + pageSize - 1);

        if (pageErr) {
          console.error('[moviles-actividad-dia] Error en paginación GPS:', pageErr);
          break;
        }
        if (!pageData || pageData.length === 0) break;
        for (const r of pageData) {
          if (r.movil_id) gpsMovilIds.add(String(r.movil_id));
        }
        if (pageData.length < pageSize) break;
      }
    } else {
      // RPC devuelve movil_id (TEXT, el id del movil, no el nro)
      for (const r of (gpsRpcData ?? [])) {
        if (r.movil_id) gpsMovilIds.add(String(r.movil_id));
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Construir el universo: Set de nros de móviles con actividad
    // pedidos ∪ services ∪ GPS
    // ─────────────────────────────────────────────────────────────────────────

    // Nros de pedidos (excluir cancelados estado=2 sub=17)
    const pedidoNros = new Set<number>();
    for (const row of (pedidosRows ?? [])) {
      if (row.estado_nro === 2 && row.sub_estado_nro === 17) continue; // cancelados
      if (row.movil != null && Number(row.movil) !== 0) {
        pedidoNros.add(Number(row.movil));
      }
    }

    // Nros de services (fch_para + rango fch_hora_para, union en JS)
    const serviceNros = new Set<number>();
    for (const row of [...(servicesFchParaRows ?? []), ...(servicesRangoRows ?? [])]) {
      if (row.movil != null && Number(row.movil) !== 0) {
        serviceNros.add(Number(row.movil));
      }
    }

    // Universo de nros conocidos (pedidos + services)
    const universalNros = new Set<number>([...pedidoNros, ...serviceNros]);

    // ─────────────────────────────────────────────────────────────────────────
    // Query 4: Resolver GPS movil_ids (TEXT) → nro (INT) via tabla moviles
    // y añadir al universo
    // ─────────────────────────────────────────────────────────────────────────
    let gpsNros = new Set<number>();
    if (gpsMovilIds.size > 0) {
      const { data: movilesGps, error: movilesGpsError } = await supabase
        .from('moviles')
        .select('id, nro, empresa_fletera_id')
        .in('id', Array.from(gpsMovilIds));

      if (movilesGpsError) throw movilesGpsError;

      for (const m of (movilesGps ?? [])) {
        if (m.nro == null) continue;
        // Filtrar por empresa si aplica
        if (empresaIds.length > 0) {
          if (m.empresa_fletera_id == null || !empresaIds.includes(m.empresa_fletera_id)) continue;
        }
        gpsNros.add(m.nro);
        universalNros.add(m.nro);
      }
    }

    if (universalNros.size === 0) {
      console.log(`[moviles-actividad-dia] Sin actividad para fecha=${fecha}`);
      return NextResponse.json({ success: true, fecha, count: 0, data: [] });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query 5: Datos de moviles del universo
    // Sin filtrar por mostrar_en_mapa ni estado_nro.
    // ─────────────────────────────────────────────────────────────────────────
    const universalNrosArray = Array.from(universalNros);

    const { data: movilesData, error: movilesDataError } = await supabase
      .from('moviles')
      .select('id, nro, empresa_fletera_id, matricula, descripcion, estado_nro')
      .in('nro', universalNrosArray);

    if (movilesDataError) throw movilesDataError;

    // Filtrar por empresa (seguridad por si GPS no fue filtrado antes)
    const movilesFiltered = (movilesData ?? []).filter((m: any) => {
      if (empresaIds.length === 0) return true;
      return m.empresa_fletera_id != null && empresaIds.includes(m.empresa_fletera_id);
    });

    if (movilesFiltered.length === 0) {
      return NextResponse.json({ success: true, fecha, count: 0, data: [] });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query 6: Última posición GPS del día para cada móvil del universo
    // gps_tracking_history.movil_id es el .id del movil (TEXT), no el .nro.
    // ─────────────────────────────────────────────────────────────────────────
    const movilIdsByNro = new Map<number, string>();
    for (const m of movilesFiltered) {
      if (m.nro != null && m.id != null) movilIdsByNro.set(m.nro, String(m.id));
    }
    const movilIdsForGps = Array.from(movilIdsByNro.values());

    const { data: lastGpsRows, error: lastGpsError } = await supabase
      .from('gps_tracking_history')
      .select('movil_id, latitud, longitud, fecha_hora')
      .in('movil_id', movilIdsForGps)
      .gte('fecha_hora', fechaIni)
      .lt('fecha_hora', fechaSigDia)
      .order('fecha_hora', { ascending: false });

    if (lastGpsError) throw lastGpsError;

    // Construir mapa movil_id → última posición del día (primer row es el más reciente)
    const lastGpsMap = new Map<string, { latitud: number; longitud: number; fecha_hora: string }>();
    for (const row of (lastGpsRows ?? [])) {
      if (!lastGpsMap.has(row.movil_id)) {
        // Ya viene ordenado DESC, primer row = más reciente
        lastGpsMap.set(row.movil_id, {
          latitud: row.latitud,
          longitud: row.longitud,
          fecha_hora: row.fecha_hora,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Construir response
    // ─────────────────────────────────────────────────────────────────────────
    const data = movilesFiltered.map((movil: any, index: number) => {
      const movilIdText = movil.id != null ? String(movil.id) : null;
      const lastPos = movilIdText ? lastGpsMap.get(movilIdText) : undefined;

      return {
        movilId: movil.nro!,
        movilName: movil.descripcion || `Móvil-${movil.nro}`,
        color: getMovilColor(index),
        empresa_fletera_id: movil.empresa_fletera_id,
        estado: movil.estado_nro,
        matricula: movil.matricula,
        position: lastPos
          ? {
              identificador: 0,
              origen: 'GPS_HISTORY' as const,
              coordX: lastPos.latitud,
              coordY: lastPos.longitud,
              fechaInsLog: lastPos.fecha_hora,
              auxIn2: '0',
              distRecorrida: 0,
            }
          : null,
      };
    });

    console.log(
      `✅ [moviles-actividad-dia] fecha=${fecha}: ${data.length} móviles ` +
        `(pedidos=${pedidoNros.size}, services=${serviceNros.size}, gps=${gpsNros.size})`,
    );

    return NextResponse.json({
      success: true,
      fecha,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('[moviles-actividad-dia] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}

/**
 * Incrementa una fecha YYYY-MM-DD en 1 día (sin librerías externas).
 */
function incrementDate(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`); // Mediodía UTC para evitar DST issues
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
