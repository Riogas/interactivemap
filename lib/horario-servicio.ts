/**
 * Helpers de horario de servicio.
 *
 * Fuente unica de verdad para las constantes y funciones de calculo
 * del periodo diurno/nocturno. Usable en cliente y servidor (sin 'use client' ni 'server-only').
 *
 * Horarios (hardcodeados por decision de diseno — item #31/#32):
 *   Nocturno: 20:30 <= hora < 06:00 (envuelve medianoche)
 *   Diurno:   06:00 <= hora < 20:30
 *
 * Los defaults pueden ser sobreescritos por los campos hora_ini_nocturno / hora_fin_nocturno
 * de escenario_settings (cuando estan seteados). El caller es responsable de pasar los valores;
 * si no los pasa, se usan los defaults hardcodeados.
 */

/** Hora de inicio del periodo nocturno (20:30 = 20.5 en formato decimal). */
export const NIGHT_START_HOUR = 20.5;

/** Hora de inicio del periodo diurno (06:00 = 6 en formato decimal). */
export const DAY_START_HOUR = 6;

/** Tipo del periodo de servicio activo. */
export type ServicePeriod = 'URGENTE' | 'NOCTURNO';

/**
 * Parsea un string de hora en formato HH:MM o HH:MM:SS a un numero decimal (horas).
 * Retorna null si el string es invalido o null.
 *
 * @param timeStr - String de hora, e.g. "20:30" o "20:30:00"
 */
export function parseTimeToDecimal(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h + m / 60;
}

/**
 * Determina si la hora de la fecha dada cae en periodo nocturno.
 *
 * Nocturno: hora >= nightStart O hora < dayStart (envuelve medianoche).
 * Usa la hora LOCAL del objeto Date (getHours/getMinutes).
 *
 * @param d - Fecha a evaluar. Tipicamente serverNow del hook useServerTime.
 * @param customNightStart - Hora decimal de inicio nocturno (override del default 20.5). Opcional.
 * @param customDayStart - Hora decimal de inicio diurno (override del default 6). Opcional.
 * @returns true si es periodo nocturno, false si es diurno.
 */
export function isNocturnoHour(d: Date, customNightStart?: number | null, customDayStart?: number | null): boolean {
  const nightStart = customNightStart ?? NIGHT_START_HOUR;
  const dayStart = customDayStart ?? DAY_START_HOUR;
  const hour = d.getHours() + d.getMinutes() / 60;
  return hour >= nightStart || hour < dayStart;
}

/**
 * Determina el periodo de servicio activo segun la hora del servidor
 * y si el escenario cubre servicio nocturno.
 *
 * @param serverNow - Hora actual del servidor (de useServerTime).
 * @param aplicaNocturno - Si el escenario tiene capa nocturna activa.
 * @param customNightStart - Hora decimal de inicio nocturno (override). Opcional.
 * @param customDayStart - Hora decimal de inicio diurno (override). Opcional.
 * @returns 'URGENTE' o 'NOCTURNO'.
 */
export function determineServicePeriod(
  serverNow: Date,
  aplicaNocturno: boolean,
  customNightStart?: number | null,
  customDayStart?: number | null,
): ServicePeriod {
  if (!aplicaNocturno) return 'URGENTE';
  return isNocturnoHour(serverNow, customNightStart, customDayStart) ? 'NOCTURNO' : 'URGENTE';
}
