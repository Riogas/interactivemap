import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const resolvedParams = await params;
    const movilId = parseInt(resolvedParams.movilId);
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenario_id') || '1000';
    // Obtener fecha: param 'fecha' o default a hoy
    const fecha = searchParams.get('fecha') || new Date().toISOString().split('T')[0];

    const supabase = getServerSupabaseClient();
    
    // Obtener pedidos pendientes - Solo estado 1 (Asignado) del día exacto
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('movil', movilId)
      .eq('escenario', parseInt(escenarioId))
      .in('estado_nro', [1])
      .eq('fch_para', fecha) // Filtrar por fecha exacta del día
      .order('prioridad', { ascending: false });
    
    if (error) throw error;
    
    const result = {
      success: true,
      movilId,
      fecha,
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
