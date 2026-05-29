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

/**
 * Devuelve el rango de fechas (formato `YYYY-MM-DD`) que cuentan como "pendiente"
 * para una fecha dada.
 *
 * Regla de arrastre (feature: pendientes del día anterior):
 * - Si `fecha` es hoy (según hora Montevideo): devuelve `[hoy, ayer]`.
 *   El arrastre incluye pedidos/services con `fch_para = ayer` que siguen pendientes.
 * - En cualquier otra fecha (día pasado): devuelve `[fecha]` (comportamiento original).
 *
 * La activación del arrastre es estricta: solo `selectedDate === todayMontevideo()`.
 * Los días pasados nunca muestran arrastre.
 *
 * @param fecha - Fecha seleccionada en formato `YYYY-MM-DD`.
 * @param now - Opcional. Inyección de `Date` para tests (permite simular franja nocturna).
 * @returns Array de fechas `YYYY-MM-DD`. Longitud 1 (fecha pasada) o 2 (hoy+ayer).
 *
 * @example
 * // Hoy es 2026-05-29
 * pendienteDateRange('2026-05-29') // → ['2026-05-29', '2026-05-28']
 * pendienteDateRange('2026-05-28') // → ['2026-05-28']
 *
 * // Franja nocturna: 23:30 UY = 02:30 UTC del día siguiente
 * pendienteDateRange('2026-05-29', new Date('2026-05-30T02:30:00Z'))
 * // → ['2026-05-29', '2026-05-28']  (hoy UY sigue siendo '2026-05-29')
 */
export function pendienteDateRange(fecha: string, now: Date = new Date()): string[] {
  const hoy = todayMontevideo(now);
  if (fecha !== hoy) return [fecha];
  const ayer = daysAgoMontevideo(1, now);
  return [hoy, ayer];
}

/**
 * Variante compacta de `pendienteDateRange`: devuelve las fechas en formato
 * `YYYYMMDD` (sin guiones), para comparar directamente con `fch_para` en la BD
 * (almacenada como YYYYMMDD).
 *
 * @param fecha - Fecha seleccionada en formato `YYYY-MM-DD`.
 * @param now - Opcional. Inyección de `Date` para tests.
 * @returns Array de fechas `YYYYMMDD`.
 *
 * @example
 * pendienteDateRangeCompact('2026-05-29') // → ['20260529', '20260528']
 * pendienteDateRangeCompact('2026-05-28') // → ['20260528']
 */
export function pendienteDateRangeCompact(fecha: string, now: Date = new Date()): string[] {
  return pendienteDateRange(fecha, now).map(f => f.replace(/-/g, ''));
}
