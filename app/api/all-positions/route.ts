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
    const escenarioId = searchParams.get('escenario_id') || '1000'; // Cambiado a 1000
    
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
      .select('movil, empresa_fletera_id, matricula, estado')
      .eq('escenario_id', escenarioId)
      .eq('mostrar_en_mapa', true);
    
    // Filtro por móvil específico (tiene prioridad)
    if (movilIdParam) {
      movilesQuery = movilesQuery.eq('movil', parseInt(movilIdParam));
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
    const movilIds = moviles.map(m => m.movil.toString());
    
    // Query para obtener la última posición de cada móvil
    const { data: gpsData, error: gpsError } = await supabase
      .from('gps_tracking_extended')
      .select('*')
      .in('movil', movilIds)
      .eq('escenario_id', escenarioId)
      .order('fecha_hora', { ascending: false });
    
    if (gpsError) throw gpsError;
    
    // Agrupar por móvil y obtener la última posición de cada uno
    const latestPositions = new Map();
    gpsData?.forEach(pos => {
      if (!latestPositions.has(pos.movil)) {
        latestPositions.set(pos.movil, pos);
      }
    });
    
    // Combinar datos de móviles con posiciones
    const data = moviles.map((movil, index) => {
      const position = latestPositions.get(movil.movil.toString());
      
      if (!position) return null; // Sin posición GPS
      
      return {
        movilId: movil.movil,
        movilName: `Móvil-${movil.movil}`,
        color: getMovilColor(index),
        empresa_fletera_id: movil.empresa_fletera_id,
        estado: movil.estado,
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
    }).filter(m => m !== null); // Solo móviles con posición GPS

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
