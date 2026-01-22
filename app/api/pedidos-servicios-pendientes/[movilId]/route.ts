import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  try {
    const resolvedParams = await params;
    const movilId = parseInt(resolvedParams.movilId);
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenario_id') || '1000'; // Cambiado a 1000
    const fechaDesde = searchParams.get('fechaDesde');

    const supabase = getServerSupabaseClient();
    
    // Obtener pedidos pendientes (estados 1 y 2 = pendientes)
    // Estado 1: Asignado, Estado 2: En camino
    let query = supabase
      .from('pedidos')
      .select('*')
      .eq('movil', movilId)
      .eq('escenario', escenarioId)
      .in('estado_nro', [1, 2]); // Solo pedidos pendientes
    
    if (fechaDesde) {
      query = query.gte('fch_para', fechaDesde);
    }
    
    const { data: pedidos, error } = await query.order('prioridad', { ascending: false });
    
    if (error) throw error;
    
    const result = {
      success: true,
      movilId,
      fechaDesde: fechaDesde || new Date().toISOString().split('T')[0],
      total: pedidos?.length || 0,
      pedidosPendientes: pedidos?.length || 0,
      serviciosPendientes: 0, // Puede ajustarse según tu lógica de negocio
      data: pedidos || [],
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching pendientes:', error);
    return NextResponse.json(
      { success: false, error: 'Error al obtener pendientes' },
      { status: 500 }
    );
  }
}
