import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/moviles-with-activity?date=YYYY-MM-DD[&empresaIds=N,M,...]
 *
 * Devuelve la lista de números de móvil (moviles.nro) distintos que tienen
 * al menos un pedido O al menos un service en la fecha indicada.
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

  const supabase = getServerSupabaseClient();

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

    // 3. Unir y deduplicar — el campo movil es moviles.nro (número del móvil)
    const movilSet = new Set<number>();
    for (const row of pedidosData || []) {
      const n = Number((row as { movil: unknown }).movil);
      if (Number.isFinite(n) && n !== 0) movilSet.add(n);
    }
    for (const row of servicesData || []) {
      const n = Number((row as { movil: unknown }).movil);
      if (Number.isFinite(n) && n !== 0) movilSet.add(n);
    }

    let movilNros = Array.from(movilSet).sort((a, b) => a - b);

    // 4. Si hay filtro de empresas, intersectar con los nros de esas empresas
    if (empresaIds && empresaIds.length > 0 && movilNros.length > 0) {
      // Usamos cast a any para evitar el tipo never que produce el chaining .in().in()
      // en el cliente de Supabase tipado cuando las columnas tienen tipos diferentes.
      const { data: movilesRaw, error: movilesErr } = await (supabase as any)
        .from('moviles')
        .select('nro')
        .in('empresa_fletera_id', empresaIds)
        .in('nro', movilNros);

      if (movilesErr) {
        console.error('[moviles-with-activity] Error en query moviles:', movilesErr);
        // Fallback: devolver todos (sin filtro empresa) en vez de romper la UX
        return NextResponse.json({ success: true, data: movilNros });
      }

      const movilesData = (movilesRaw || []) as Array<{ nro: number | null }>;
      movilNros = movilesData
        .map((m) => Number(m.nro))
        .filter((n) => Number.isFinite(n) && n !== 0)
        .sort((a, b) => a - b);
    }

    console.log(
      `[moviles-with-activity] date=${date} empresaIds=${empresaIdsParam ?? 'all'} → ${movilNros.length} móviles con actividad`,
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
