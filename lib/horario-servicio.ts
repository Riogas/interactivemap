/**
 * Helpers de horario de servicio.
 *
 * Fuente unica de verdad para las constantes y funciones de calculo
 * del periodo diurno/nocturno. Usable en cliente y servidor (sin 'use client' ni 'server-only').
 *
 * Horarios (hardcodeados por decision de diseno — item #31/#32):
 *   Nocturno: 20:30 <= hora < 06:00 (envuelve medianoche)
 *   Diurno:   06:00 <= hora < 20:30
 */

/** Hora de inicio del periodo nocturno (20:30 = 20.5 en formato decimal). */
export const NIGHT_START_HOUR = 20.5;

/** Hora de inicio del periodo diurno (06:00 = 6 en formato decimal). */
export const DAY_START_HOUR = 6;

/** Tipo del periodo de servicio activo. */
export type ServicePeriod = 'URGENTE' | 'NOCTURNO';

/**
 * Determina si la hora de la fecha dada cae en periodo nocturno.
 *
 * Nocturno: hora >= 20:30 O hora < 06:00 (envuelve medianoche).
 * Usa la hora LOCAL del objeto Date (getHours/getMinutes).
 *
 * @param d - Fecha a evaluar. Tipicamente serverNow del hook useServerTime.
 * @returns true si es periodo nocturno, false si es diurno.
 */
export function isNocturnoHour(d: Date): boolean {
  const hour = d.getHours() + d.getMinutes() / 60;
  return hour >= NIGHT_START_HOUR || hour < DAY_START_HOUR;
}

/**
 * Determina el periodo de servicio activo segun la hora del servidor
 * y si el escenario cubre servicio nocturno.
 *
 * @param serverNow - Hora actual del servidor (de useServerTime).
 * @param aplicaNocturno - Si el escenario tiene capa nocturna activa.
 * @returns 'URGENTE' o 'NOCTURNO'.
 */
export function determineServicePeriod(
  serverNow: Date,
  aplicaNocturno: boolean,
): ServicePeriod {
  if (!aplicaNocturno) return 'URGENTE';
  return isNocturnoHour(serverNow) ? 'NOCTURNO' : 'URGENTE';
}
