import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
      .from('gps_tracking_extended')
      .select('*')
      .eq('movil_id', movilId.toString()) // Nombre correcto de la columna
      .gte('fecha_hora', startDateTime)
      .lte('fecha_hora', endDateTime)
      .order('fecha_hora', { ascending: false })
      .limit(500); // Más registros para animación
    
    if (error) {
      console.error(`❌ Error en query:`, error);
      throw error;
    }
    
    console.log(`📊 Registros encontrados: ${coordinates?.length || 0}`);
    
    // Transformar al formato esperado por el frontend
    const history = (coordinates || []).map(coord => ({
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
