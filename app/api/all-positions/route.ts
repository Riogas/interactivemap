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
    
    // Obtener móviles activos con sus datos.
    // pto_vta_lat/pto_vta_lng se incluyen para fallback cuando no hay
    // posición GPS reportada por la app de pedidos (ver más abajo).
    let movilesQuery = supabase
      .from('moviles')
      .select('id, empresa_fletera_id, matricula, estado_nro, descripcion, pto_vta_lat, pto_vta_lng')
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
    
    // Query directa a gps_latest_positions (1 fila por móvil, siempre actualizada por trigger)
    // La tabla se limpia cada madrugada por cron, así que solo contiene posiciones vigentes.
    console.log(`🔍 Buscando últimas posiciones GPS para ${movilIds.length} móviles`);
    
    const { data: gpsData, error: gpsError } = await supabase
      .from('gps_latest_positions')
      .select('*')
      .in('movil_id', movilIds);
    
    if (gpsError) throw gpsError;
    
    // Ya viene 1 fila por móvil — mapear directamente
    const latestPositions = new Map();
    gpsData?.forEach((pos: any) => {
      latestPositions.set(pos.movil_id, pos);
    });
    
    console.log(`📍 Móviles con posición vigente: ${latestPositions.size} de ${moviles.length}`);

    // Política: si un móvil tiene gps_latest_position vigente la usamos; si NO
    // la tiene pero el importer le asignó pto_vta_lat/lng, usamos esas como
    // posición fallback. Esto evita el delay entre importer → trigger →
    // gps_latest_positions, y permite que un móvil recién activado aparezca
    // en el mapa/colapsable inmediatamente. Sin ninguna de las dos, el móvil
    // se descarta para no romper el mapa.
    const ptovtaFallbackCount = { used: 0, dropped: 0 };
    const data = moviles
      .map((movil: any, index: number) => {
        const position = latestPositions.get(movil.id);
        if (position) {
          return {
            movilId: Number(movil.id),
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
        }
        // Fallback: pto_vta_lat/lng (definidos en moviles por el importer).
        const lat = Number(movil.pto_vta_lat);
        const lng = Number(movil.pto_vta_lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
          ptovtaFallbackCount.used++;
          return {
            movilId: Number(movil.id),
            movilName: movil.descripcion || `Móvil-${movil.id}`,
            color: getMovilColor(index),
            empresa_fletera_id: movil.empresa_fletera_id,
            estado: movil.estado_nro,
            position: {
              identificador: 0,
              origen: 'PTOVTA_FALLBACK',
              coordX: lat,
              coordY: lng,
              fechaInsLog: new Date().toISOString(),
              auxIn2: '0',
              distRecorrida: 0,
            },
          };
        }
        ptovtaFallbackCount.dropped++;
        return null;
      })
      .filter(Boolean);

    console.log(
      `✅ Total devueltos: ${data.length} (gps=${latestPositions.size}, ptovta_fallback=${ptovtaFallbackCount.used}, sin_coords=${ptovtaFallbackCount.dropped})`
    );

    console.log(`✅ API /all-positions - Returning ${data.length} móviles with GPS data`);

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
