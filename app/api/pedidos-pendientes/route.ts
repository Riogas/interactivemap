import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { todayMontevideo, pendienteDateRangeCompact } from '@/lib/date-utils';

const VERBOSE = process.env.ENABLE_MIDDLEWARE_LOGGING === 'true';
const rlog = (...args: unknown[]) => { if (VERBOSE) console.log(...args); };

export async function GET(request: NextRequest) {
  // AUTENTICACION REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    // Obtener parámetros de query
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = parseInt(searchParams.get('escenarioId') || '1000');
    const fecha = searchParams.get('fecha') || todayMontevideo();

    rlog(`Obteniendo TODOS los pedidos pendientes del día ${fecha}`);

    // Arrastre (feature 2026-05-29): cuando fecha === hoy (Montevideo), incluir
    // también fch_para = ayer en el filtro de pendientes.
    // fch_para se almacena como YYYYMMDD (sin guiones) en la BD.
    const rangoCompact = pendienteDateRangeCompact(fecha); // ['YYYYMMDD'] o ['YYYYMMDD', 'YYYYMMDD_ayer']

    // Consultar TODOS los pedidos pendientes filtrando por rango de fecha
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        escenario,
        movil,
        estado_nro,
        latitud,
        longitud,
        zona_nro,
        tipo,
        servicio_nombre,
        producto_cod,
        producto_nom,
        producto_cant,
        precio,
        prioridad,
        pedido_obs,
        imp_flete,
        imp_bruto,
        fch_para,
        fch_hora_max_ent_comp,
        fch_hora_para,
        fch_hora_mov,
        cliente_nombre,
        cliente_direccion,
        cliente_nro,
        cliente_tel,
        cliente_obs,
        empresa_fletera_id,
        prodsadicionales
      `)
      .eq('escenario', escenarioId)
      .in('fch_para', rangoCompact) // arrastre: [hoy] o [hoy, ayer] segun la fecha
      .in('estado_nro', [1, 2]) // Solo pedidos pendientes (Asignado y En camino)
      .eq('sub_estado_desc', '5') // Solo pedidos asignados (sub_estado_desc=5)
      .not('latitud', 'is', null) // Solo pedidos con coordenadas
      .not('longitud', 'is', null)
      .order('prioridad', { ascending: false })
      .order('fch_hora_para', { ascending: true});

    if (error) {
      console.error('Error al obtener todos los pedidos pendientes:', error);
      return NextResponse.json(
        { error: 'Error al obtener pedidos pendientes' },
        { status: 500 }
      );
    }

    rlog(`Encontrados ${pedidos?.length || 0} pedidos pendientes para el día ${fecha} (rango: ${rangoCompact.join(', ')})`);

    return NextResponse.json({
      escenarioId,
      fecha,
      pedidos: pedidos || [],
      total: pedidos?.length || 0,
    });
  } catch (error) {
    console.error('Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
