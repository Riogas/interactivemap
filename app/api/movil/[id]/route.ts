import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const params = await context.params;
    const movilId = parseInt(params.id);
    
    if (isNaN(movilId)) {
      return NextResponse.json(
        { error: 'Invalid movil ID' },
        { status: 400 }
      );
    }

    // Obtener startDate del query string si existe
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const dateToUse = startDate || new Date().toISOString().split('T')[0];

    // Obtener historial de coordenadas del móvil para el día especificado
    const startDateTime = `${dateToUse}T00:00:00`;
    const endDateTime = `${dateToUse}T23:59:59`;

    console.log(`🚗 API /movil/${movilId} - Fetching history (date: ${dateToUse})`);
    console.log(`🔍 Filtros: movil_id=${movilId}, fecha=${startDateTime} to ${endDateTime}`);
    
    const supabase = getServerSupabaseClient();
    
    const { data: coordinates, error } = await supabase
      .from('gps_tracking_history')
      .select('id, latitud, longitud, fecha_hora, velocidad, distancia_recorrida, movil_id')
      .eq('movil_id', movilId.toString())
      .gte('fecha_hora', startDateTime)
      .lte('fecha_hora', endDateTime)
      .order('fecha_hora', { ascending: false })
      .limit(500) as any;
    
    if (error) {
      console.error(`❌ Error en query:`, error);
      throw error;
    }
    
    console.log(`📊 Registros encontrados: ${coordinates?.length || 0}`);
    
    // Transformar al formato esperado por el frontend
    const history = (coordinates || []).map((coord: any) => ({
      identificador: coord.id,
      origen: 'SUPABASE',
      coordX: parseFloat(coord.latitud.toString()),
      coordY: parseFloat(coord.longitud.toString()),
      fechaInsLog: coord.fecha_hora,
      auxIn2: coord.velocidad?.toString() || '0',
      distRecorrida: coord.distancia_recorrida || 0,
    }));
    
    console.log(`✅ API /movil/${movilId} - Returning ${history.length} coordinates`);

    return NextResponse.json({
      success: true,
      movilId,
      count: history.length,
      data: history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const params = await context.params;
    console.error(`❌ API Error for movil ${params.id}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch movil history',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
