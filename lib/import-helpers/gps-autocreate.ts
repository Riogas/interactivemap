/**
 * Autocreación de posición GPS inicial del día a partir del punto de venta del móvil.
 *
 * Cuando se importa un móvil con coordenadas pto_vta_lat / pto_vta_lng, si el móvil
 * no tiene un registro en gps_latest_positions con fecha_hora >= inicio del día
 * (TZ America/Montevideo), insertamos una fila en gps_tracking_history con esas
 * coordenadas — el trigger sync_gps_latest_position se encarga de hacer el upsert
 * a gps_latest_positions con su guard de "fecha_hora más reciente".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MovilCandidate {
  movil_id: string;
  escenario_id: number;
  lat: number;
  lng: number;
}

/**
 * Devuelve un ISO con el inicio del día actual en America/Montevideo.
 * Uruguay no tiene DST desde 2015 → offset estable -03:00.
 */
export function startOfDayMontevideoIso(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const yyyymmdd = fmt.format(now);
  return `${yyyymmdd}T00:00:00-03:00`;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 || ln === 0) return false;
  if (la < -90 || la > 90) return false;
  if (ln < -180 || ln > 180) return false;
  return true;
}

/**
 * Filtra los candidatos que NO tienen registro en gps_latest_positions con
 * fecha_hora >= inicio del día Montevideo. Best-effort: si la query falla,
 * devuelve [] (no se autocrea nada y no se aborta el import).
 */
export async function selectMovilesNeedingDailyPosition(
  client: SupabaseClient,
  candidatos: MovilCandidate[],
  nowFn: () => Date = () => new Date()
): Promise<MovilCandidate[]> {
  if (candidatos.length === 0) return [];
  const ids = candidatos.map((c) => c.movil_id);
  const startIso = startOfDayMontevideoIso(nowFn());
  const { data, error } = await client
    .from('gps_latest_positions')
    .select('movil_id,fecha_hora')
    .in('movil_id', ids)
    .gte('fecha_hora', startIso);

  if (error) {
    console.error('[gps-autocreate] query gps_latest_positions falló', error);
    return [];
  }

  const covered = new Set(
    (data || []).map((r: { movil_id: unknown }) => String(r.movil_id))
  );
  return candidatos.filter((c) => !covered.has(String(c.movil_id)));
}

/**
 * Construye los rows para insertar en gps_tracking_history. Solo incluye campos
 * confirmados en el schema (movil_id, escenario_id, latitud, longitud, fecha_hora).
 * El trigger sync_gps_latest_position hace el upsert a gps_latest_positions.
 */
export function buildHistoryInsertRows(
  needing: MovilCandidate[],
  nowFn: () => Date = () => new Date()
) {
  const fecha_hora = nowFn().toISOString();
  return needing.map((n) => ({
    movil_id: n.movil_id,
    escenario_id: n.escenario_id,
    latitud: n.lat,
    longitud: n.lng,
    fecha_hora,
  }));
}
