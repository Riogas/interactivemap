import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { getMovilColor } from '@/types';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Obtener parámetros de query string
    const searchParams = request.nextUrl.searchParams;
    const empresaIdsParam = searchParams.get('empresaIds');
    const movilIdParam = searchParams.get('movilId'); // Nuevo parámetro
    
    // Parsear empresaIds si existe
    const empresaIds = empresaIdsParam 
      ? empresaIdsParam.split(',').map(id => parseInt(id.trim()))
      : undefined;
    
    if (movilIdParam) {
      console.log(`🚀 API /all-positions - Fetching móvil específico: ${movilIdParam}`);
    } else if (empresaIds && empresaIds.length > 0) {
      console.log(`🚀 API /all-positions - Fetching móviles for empresas: ${empresaIds.join(', ')}`);
    } else {
      console.log(`🚀 API /all-positions - Fetching ALL móviles from Supabase`);
    }
    
    const supabase = getServerSupabaseClient();
    
    // Obtener móviles activos con sus datos
    let movilesQuery = supabase
      .from('moviles')
      .select('id, empresa_fletera_id, matricula, estado_nro, descripcion')
      .eq('mostrar_en_mapa', true);
    
    // Filtro por móvil específico (tiene prioridad)
    if (movilIdParam) {
      movilesQuery = movilesQuery.eq('id', movilIdParam);
    } else if (empresaIds && empresaIds.length > 0) {
      movilesQuery = movilesQuery.in('empresa_fletera_id', empresaIds);
    }
    
    const { data: moviles, error: movilesError } = await movilesQuery;
    
    if (movilesError) throw movilesError;
    
    if (!moviles || moviles.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        data: [],
        empresaIds: empresaIds || null,
        movilId: movilIdParam || null,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Obtener las últimas posiciones GPS de cada móvil
    const movilIds = moviles.map((m: any) => m.id);
    
    // Query para obtener la última posición de cada móvil
    const { data: gpsData, error: gpsError } = await supabase
      .from('gps_tracking_extended')
      .select('*')
      .in('movil_id', movilIds)
      .order('fecha_hora', { ascending: false });
    
    if (gpsError) throw gpsError;
    
    // Agrupar por móvil y obtener la última posición de cada uno
    const latestPositions = new Map();
    gpsData?.forEach((pos: any) => {
      if (!latestPositions.has(pos.movil_id)) {
        latestPositions.set(pos.movil_id, pos);
      }
    });
    
    // Combinar datos de móviles con posiciones
    const data = moviles.map((movil: any, index: number) => {
      const position = latestPositions.get(movil.id);
      
      // Si no tiene posición GPS, retornar con flag especial
      if (!position) {
        return {
          movilId: movil.id,
          movilName: movil.descripcion || `Móvil-${movil.id}`,
          color: getMovilColor(index),
          empresa_fletera_id: movil.empresa_fletera_id,
          estado: movil.estado_nro,
          position: null, // Sin posición GPS
          noGpsData: true, // Flag para indicar que no hay datos GPS
        };
      }
      
      return {
        movilId: movil.id,
        movilName: movil.descripcion || `Móvil-${movil.id}`,
        color: getMovilColor(index),
        empresa_fletera_id: movil.empresa_fletera_id,
        estado: movil.estado_nro,
        position: {
          identificador: position.id,
          origen: 'SUPABASE',
          coordX: position.latitud,
          coordY: position.longitud,
          fechaInsLog: position.fecha_hora,
          auxIn2: position.velocidad?.toString() || '0',
          distRecorrida: position.distancia_recorrida || 0,
        },
      };
    }); // NO filtrar - mostrar todos los móviles

    console.log(`✅ API /all-positions - Returning ${data.length} móviles with GPS data`);

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
      empresaIds: empresaIds || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch all positions',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
