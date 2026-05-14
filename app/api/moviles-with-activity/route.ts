import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/moviles-with-activity?date=YYYY-MM-DD[&empresaIds=N,M,...]
 *
 * Devuelve la lista de números de móvil (moviles.nro) distintos que tienen
 * al menos un pedido, al menos un service, O al menos una posición GPS
 * en la fecha indicada.
 *
 * Fuentes de actividad:
 *   1. pedidos.fch_para = date (formato YYYY-MM-DD)
 *   2. services.fch_para = date (formato YYYYMMDD)
 *   3. gps_tracking_history.fecha_hora dentro del día (via RPC moviles_con_gps_en_dia)
 *
 * El estado del móvil (activo/inactivo) NO filtra — un móvil inactivo
 * que tuvo recorrido a la mañana debe seguir apareciendo en el modal.
 *
 * Si empresaIds está presente, solo incluye móviles de esas empresas fleteras.
 *
 * Respuesta: { success: true, data: number[] }
 *
 * Usado por TrackingModal para filtrar la lista de móviles por actividad real
 * en la fecha de recorrido seleccionada.
 */
export async function GET(request: NextRequest) {
  // Autenticación requerida (mismo scope que el resto de endpoints del dashboard)
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // Esperado: YYYY-MM-DD
  const empresaIdsParam = searchParams.get('empresaIds'); // Opcional: "1,2,3"

  // Validar date
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro date requerido en formato YYYY-MM-DD' },
      { status: 400 },
    );
  }

  // pedidos.fch_para usa formato YYYY-MM-DD
  const dateDash = date;
  // services.fch_para usa formato YYYYMMDD (sin guiones)
  const dateCompact = date.replace(/-/g, '');

  // Parsear empresaIds (validar que sean números finitos)
  const empresaIds: number[] | null = empresaIdsParam
    ? empresaIdsParam
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : null;

  // Usamos cast a any en el cliente para sortear los tipos never que produce
  // el cliente de Supabase tipado cuando las funciones RPC o columnas no están
  // en el schema generado (Functions: { [_ in never]: never }).
  const supabase = getServerSupabaseClient() as any;

  try {
    // 1. Móviles con pedido en la fecha (fch_para YYYY-MM-DD en pedidos)
    const { data: pedidosData, error: pedidosErr } = await supabase
      .from('pedidos')
      .select('movil')
      .eq('fch_para', dateDash)
      .not('movil', 'is', null);

    if (pedidosErr) {
      console.error('[moviles-with-activity] Error en query pedidos:', pedidosErr);
      return NextResponse.json(
        { success: false, error: pedidosErr.message },
        { status: 500 },
      );
    }

    // 2. Móviles con service en la fecha (fch_para YYYYMMDD en services)
    const { data: servicesData, error: servicesErr } = await supabase
      .from('services')
      .select('movil')
      .eq('fch_para', dateCompact)
      .not('movil', 'is', null);

    if (servicesErr) {
      console.error('[moviles-with-activity] Error en query services:', servicesErr);
      return NextResponse.json(
        { success: false, error: servicesErr.message },
        { status: 500 },
      );
    }

    // 3. Móviles con al menos una posición GPS en la fecha
    //    Opción B (preferida): RPC SQL con SELECT DISTINCT server-side —
    //    evita traer miles de rows al cliente.
    //    Fallback Opción A: paginación client-side si la función RPC no existe aún.
    const gpsMovilSet = new Set<number>();

    const { data: gpsRpcData, error: gpsRpcErr } = await supabase.rpc(
      'moviles_con_gps_en_dia',
      { p_date: date },
    );

    if (gpsRpcErr) {
      // Fallback Opción A: paginación + dedup client-side
      console.warn(
        '[moviles-with-activity] RPC moviles_con_gps_en_dia no disponible, usando paginación:',
        gpsRpcErr.message,
      );

      const startOfDay = `${date} 00:00:00`;
      const nextDateObj = new Date(`${date}T00:00:00Z`);
      nextDateObj.setUTCDate(nextDateObj.getUTCDate() + 1);
      const endOfDay = `${nextDateObj.toISOString().slice(0, 10)} 00:00:00`;

      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: pageData, error: pageErr } = await supabase
          .from('gps_tracking_history')
          .select('movil_id')
          .gte('fecha_hora', startOfDay)
          .lt('fecha_hora', endOfDay)
          .range(offset, offset + pageSize - 1);

        if (pageErr) {
          console.error('[moviles-with-activity] Error en paginación GPS:', pageErr);
          break;
        }
        if (!pageData || pageData.length === 0) break;

        for (const r of pageData) {
          const n = Number((r as { movil_id: unknown }).movil_id);
          if (Number.isFinite(n) && n !== 0) gpsMovilSet.add(n);
        }

        if (pageData.length < pageSize) break;
      }
    } else {
      // RPC OK: colectar movil_id del resultado
      for (const r of (gpsRpcData ?? []) as Array<{ movil_id: unknown }>) {
        const n = Number(r.movil_id);
        if (Number.isFinite(n) && n !== 0) gpsMovilSet.add(n);
      }
    }

    // 4. Unir las tres fuentes y deduplicar
    const movilSet = new Set<number>();
    for (const row of (pedidosData ?? []) as Array<{ movil: unknown }>) {
      const n = Number(row.movil);
      if (Number.isFinite(n) && n !== 0) movilSet.add(n);
    }
    for (const row of (servicesData ?? []) as Array<{ movil: unknown }>) {
      const n = Number(row.movil);
      if (Number.isFinite(n) && n !== 0) movilSet.add(n);
    }

    const allMovilSet = new Set<number>([...movilSet, ...gpsMovilSet]);
    let movilNros = Array.from(allMovilSet).sort((a, b) => a - b);

    // 5. Si hay filtro de empresas, intersectar con los nros de esas empresas
    if (empresaIds && empresaIds.length > 0 && movilNros.length > 0) {
      const { data: movilesRaw, error: movilesErr } = await supabase
        .from('moviles')
        .select('nro')
        .in('empresa_fletera_id', empresaIds)
        .in('nro', movilNros);

      if (movilesErr) {
        console.error('[moviles-with-activity] Error en query moviles:', movilesErr);
        // Fallback: devolver todos (sin filtro empresa) en vez de romper la UX
        return NextResponse.json({ success: true, data: movilNros });
      }

      const movilesData = (movilesRaw ?? []) as Array<{ nro: number | null }>;
      movilNros = movilesData
        .map((m) => Number(m.nro))
        .filter((n) => Number.isFinite(n) && n !== 0)
        .sort((a, b) => a - b);
    }

    console.log(
      `[moviles-with-activity] date=${date} empresaIds=${empresaIdsParam ?? 'all'} → ` +
        `${movilNros.length} móviles (pedidos: ${(pedidosData ?? []).length}, services: ${(servicesData ?? []).length}, gps: ${gpsMovilSet.size})`,
    );

    return NextResponse.json({ success: true, data: movilNros });
  } catch (err) {
    console.error('[moviles-with-activity] Error inesperado:', err);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
