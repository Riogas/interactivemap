import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { getMovilColor } from '@/types';
import { requireAuth } from '@/lib/auth-middleware';
import {
  isValidLatLng,
  selectMovilesNeedingDailyPosition,
  buildHistoryInsertRows,
  type MovilCandidate,
} from '@/lib/import-helpers/gps-autocreate';
import { todayMontevideo } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

/**
 * Best-effort: para los móviles que cayeron en PTOVTA_FALLBACK (tienen pto_vta_lat/lng
 * pero no tienen entry en gps_latest_positions hoy), inserta un registro en
 * gps_tracking_history → el trigger sync_gps_latest_position hace el upsert a
 * gps_latest_positions. Esto garantiza consistencia: si algo más lee
 * gps_latest_positions directamente (ej: /api/latest o suscripciones realtime),
 * verá al móvil.
 *
 * Fire-and-forget: no bloquea la respuesta. Errores son silenciados (ya los loggea
 * gps-autocreate internamente).
 */
async function maybeSeedGpsFromPtoVta(
  supabase: ReturnType<typeof getServerSupabaseClient>,
  candidates: Array<{ movil_id: string; escenario_id: number; lat: number; lng: number }>
): Promise<void> {
  if (candidates.length === 0) return;

  const movil_candidates: MovilCandidate[] = candidates;
  const needing = await selectMovilesNeedingDailyPosition(supabase as any, movil_candidates);
  if (needing.length === 0) return;

  const rows = buildHistoryInsertRows(needing);
  const { error } = await (supabase as any)
    .from('gps_tracking_history')
    .insert(rows);

  if (error) {
    console.error('[all-positions] gps-seed insert falló', error);
    return;
  }
  console.log(`✅ [all-positions] gps-seed: ${rows.length} posición(es) sembrada(s) desde pto_vta`);
}

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

    // Si no se proporciona startDate, usar hoy en hora Montevideo
    const dateFilter = startDate || todayMontevideo();

    if (movilIdParam) {
      console.log(`🚀 API /all-positions - Fetching móvil específico: ${movilIdParam} (fecha: ${dateFilter})`);
    } else if (empresaIds && empresaIds.length > 0) {
      console.log(`🚀 API /all-positions - Fetching móviles for empresas: ${empresaIds.join(', ')} (fecha: ${dateFilter})`);
    } else {
      console.log(`🚀 API /all-positions - Fetching ALL móviles from Supabase (fecha: ${dateFilter})`);
    }

    const supabase = getServerSupabaseClient();

    // Obtener móviles activos con sus datos.
    // escenario_id incluido para poder usar gps-autocreate helper (necesita escenario_id).
    // pto_vta_lat/pto_vta_lng se incluyen para fallback cuando no hay
    // posición GPS reportada por la app de pedidos (ver más abajo).
    let movilesQuery = supabase
      .from('moviles')
      .select('id, empresa_fletera_id, matricula, estado_nro, descripcion, pto_vta_lat, pto_vta_lng, escenario_id')
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
    // Candidatos para sembrar en gps_latest_positions (fire-and-forget al final)
    const seedCandidates: MovilCandidate[] = [];

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
        if (isValidLatLng(lat, lng)) {
          ptovtaFallbackCount.used++;
          // Encolar para sembrar en gps_latest_positions (idempotente vía selectMovilesNeedingDailyPosition)
          seedCandidates.push({
            movil_id: String(movil.id),
            escenario_id: Number(movil.escenario_id) || 1000,
            lat,
            lng,
          });
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

    // 🌱 Sembrar posiciones en gps_latest_positions para los móviles en PTOVTA_FALLBACK.
    // Fire-and-forget: no esperamos, no bloqueamos la respuesta. Si falla, el
    // PTOVTA_FALLBACK ya está devuelto al cliente. En el próximo poll (60s) el
    // trigger habrá sincronizado gps_latest_positions y se usará el path normal.
    if (seedCandidates.length > 0) {
      maybeSeedGpsFromPtoVta(supabase, seedCandidates).catch((err) => {
        console.error('[all-positions] gps-seed error inesperado', err);
      });
    }

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
