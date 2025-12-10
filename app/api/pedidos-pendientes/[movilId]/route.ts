import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  try {
    const { movilId } = await params;

    // Obtener parámetros de query
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId') || '1';

    // Consultar pedidos pendientes del móvil
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        escenario_id,
        movil_id,
        estado,
        latitud,
        longitud,
        zona,
        tipo,
        nombre_servicio,
        producto_codigo,
        producto_nombre,
        producto_cantidad,
        producto_precio,
        prioridad,
        observacion,
        importe_flete,
        importe_bruto,
        fecha_para,
        fecha_hora_max_comp,
        fecha_hora_para,
        fecha_hora_asignado,
        fecha_hora_cumplido,
        cliente_nombre,
        cliente_direccion,
        cliente_nro,
        cliente_telefono,
        cliente_observacion,
        empresa_fletera_id
      `)
      .eq('movil_id', movilId)
      .eq('escenario_id', escenarioId)
      .is('fecha_hora_cumplido', null) // Solo pedidos NO cumplidos (pendientes)
      .not('latitud', 'is', null) // Solo pedidos con coordenadas
      .not('longitud', 'is', null)
      .order('prioridad', { ascending: false })
      .order('fecha_hora_para', { ascending: true });

    if (error) {
      console.error('Error al obtener pedidos pendientes:', error);
      return NextResponse.json(
        { error: 'Error al obtener pedidos pendientes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      movilId: parseInt(movilId),
      escenarioId: parseInt(escenarioId),
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
