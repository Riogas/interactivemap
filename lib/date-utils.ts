/**
 * Helpers de fecha con timezone correcto para America/Montevideo.
 *
 * Problema: `new Date().toISOString()` devuelve SIEMPRE en UTC. Entre las 21:00
 * y 23:59 hora Montevideo (UTC-3), UTC ya marca el día siguiente, por lo que
 * `.split('T')[0]` devuelve la fecha de mañana.
 *
 * Solución: usar `Intl.DateTimeFormat` con `timeZone: 'America/Montevideo'`,
 * que funciona igual en SSR (Node) y en CSR (cualquier browser moderno).
 * Uruguay no tiene DST desde 2015 → offset estable -03:00.
 *
 * Reutiliza la misma lógica que `startOfDayMontevideoIso` en
 * `lib/import-helpers/gps-autocreate.ts`.
 */

const MONTEVIDEO_TZ = 'America/Montevideo';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: MONTEVIDEO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Devuelve la fecha actual en formato `YYYY-MM-DD` según la hora de Montevideo.
 *
 * @param now - Opcional. Permite inyectar una fecha específica (útil en tests).
 * @returns string con formato `YYYY-MM-DD`
 *
 * @example
 * // 02/05/2026 22:40 Montevideo (= 03/05 01:40 UTC)
 * todayMontevideo() // → '2026-05-02'
 */
export function todayMontevideo(now: Date = new Date()): string {
  return fmt.format(now);
}

/**
 * Devuelve la fecha actual en formato `YYYY-MM-DD` para el timezone dado.
 * Versión genérica para uso futuro.
 *
 * @param tz - IANA timezone (ej: 'America/Montevideo', 'America/Sao_Paulo')
 * @param now - Opcional. Inyección de fecha para tests.
 */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Devuelve la fecha de hace `days` días en formato `YYYY-MM-DD` según hora Montevideo.
 * Util para fijar `min` en inputs `type="date"` y limitar cuánto hacia atrás se puede ir.
 *
 * @param days - Cantidad de días hacia atrás (debe ser >= 0).
 * @param now - Opcional. Inyección de fecha para tests.
 *
 * @example
 * // Hoy es 2026-05-07 en Montevideo
 * daysAgoMontevideo(10) // → '2026-04-27'
 */
export function daysAgoMontevideo(days: number, now: Date = new Date()): string {
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return fmt.format(past);
}
