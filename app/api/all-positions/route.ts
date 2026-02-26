import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { getMovilColor } from '@/types';
import { requireAuth } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    // Obtener parámetros de query string
    const searchParams = request.nextUrl.searchParams;
    const empresaIdsParam = searchParams.get('empresaIds');
    const movilIdParam = searchParams.get('movilId'); // Nuevo parámetro
    const startDate = searchParams.get('startDate'); // Nuevo parámetro para filtrar por fecha
    
    // Parsear empresaIds si existe
    const empresaIds = empresaIdsParam 
      ? empresaIdsParam.split(',').map(id => parseInt(id.trim()))
      : undefined;
    
    // Si no se proporciona startDate, usar hoy
    const dateFilter = startDate || new Date().toISOString().split('T')[0];
    
    if (movilIdParam) {
      console.log(`🚀 API /all-positions - Fetching móvil específico: ${movilIdParam} (fecha: ${dateFilter})`);
    } else if (empresaIds && empresaIds.length > 0) {
      console.log(`🚀 API /all-positions - Fetching móviles for empresas: ${empresaIds.join(', ')} (fecha: ${dateFilter})`);
    } else {
      console.log(`🚀 API /all-positions - Fetching ALL móviles from Supabase (fecha: ${dateFilter})`);
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
    
    // Filtrar por fecha: obtener coordenadas desde las 00:00:00 hasta las 23:59:59 del día especificado
    const startDateTime = `${dateFilter}T00:00:00`;
    const endDateTime = `${dateFilter}T23:59:59`;
    
    console.log(`🔍 Buscando coordenadas GPS entre ${startDateTime} y ${endDateTime}`);
    
    // Query directa a gps_latest_positions (1 fila por móvil, siempre actualizada por trigger)
    const { data: gpsData, error: gpsError } = await supabase
      .from('gps_latest_positions')
      .select('*')
      .in('movil_id', movilIds)
      .gte('fecha_hora', startDateTime)
      .lte('fecha_hora', endDateTime);
    
    if (gpsError) throw gpsError;
    
    // Ya viene 1 fila por móvil — mapear directamente
    const latestPositions = new Map();
    gpsData?.forEach((pos: any) => {
      latestPositions.set(pos.movil_id, pos);
    });
    
    console.log(`📍 Móviles con coordenadas en ${dateFilter}: ${latestPositions.size} de ${moviles.length}`);
    
    // 🔥 FILTRAR: Solo incluir móviles que tienen coordenadas del día especificado
    const movilesConCoordenadas = moviles.filter((movil: any) => latestPositions.has(movil.id));
    
    console.log(`✅ Móviles filtrados con GPS del día: ${movilesConCoordenadas.length}`);
    
    // Combinar datos de móviles con posiciones
    const data = movilesConCoordenadas.map((movil: any, index: number) => {
      const position = latestPositions.get(movil.id);
      
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
    });

    console.log(`✅ API /all-positions - Returning ${data.length} móviles with GPS data from ${dateFilter}`);

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
      empresaIds: empresaIds || null,
      startDate: dateFilter, // Incluir fecha usada en el filtro
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
