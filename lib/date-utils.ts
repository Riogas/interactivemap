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
 *
 * REGLA CANONICAL DE TZ:
 *   Storage:     UTC (Postgres guarda timestamptz siempre en UTC — no cambiar)
 *   Display:     America/Montevideo (usar siempre timeZone: 'America/Montevideo')
 *   Comparación SQL: AT TIME ZONE 'America/Montevideo'
 *   Comparación JS:  timeZone: 'America/Montevideo' en Intl o toLocale*
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
 * Normaliza un timestamp "naive" (sin designador de zona horaria) tratándolo
 * como UTC, que es la convención de storage del sistema.
 *
 * Las APIs externas (ej. /tracking/getSessionData de .NET) devuelven fechas en
 * UTC pero SIN el sufijo `Z` (ej. "2026-06-10T16:10:00"). `new Date()` parsea
 * ese string como hora LOCAL del runtime, lo que produce un instante incorrecto
 * en browsers fuera de UTC. Esta función agrega `Z` cuando falta el designador
 * de zona, de modo que el string se interprete como UTC.
 *
 * Es idempotente: si el valor ya tiene `Z` o un offset (`+hh:mm` / `-hh:mm`),
 * se devuelve sin cambios.
 *
 * @param value - string de fecha/hora ISO (posiblemente sin zona).
 * @returns el mismo string con `Z` agregado si era naive, o el valor original.
 *
 * @example
 * ensureUtcIso('2026-06-10T16:10:00')   // → '2026-06-10T16:10:00Z'
 * ensureUtcIso('2026-06-10T16:10:00Z')  // → '2026-06-10T16:10:00Z' (sin cambios)
 * ensureUtcIso('2026-06-10T16:10:00-03:00') // → sin cambios
 */
export function ensureUtcIso(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const trimmed = value.trim();
  // Ya tiene designador de zona (Z, +hh:mm, -hh:mm, +hhmm) tras la parte de hora.
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) return trimmed;
  // Solo normalizamos strings con componente de hora ("...THH:mm...").
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`;
  }
  return trimmed;
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
 * Devuelve la fecha `YYYY-MM-DD` (hora Montevideo) de un instante dado.
 * Reusa el mismo `fmt` (Intl.DateTimeFormat) que `todayMontevideo`, solo que
 * el instante lo aporta el caller en lugar de tomar `now`.
 *
 * Uso típico: derivar la `fecha` de un hecho (metricas_cumplimiento) desde
 * `fch_hora_finalizacion` (timestamptz UTC) — AC11.
 *
 * @param iso - string ISO o Date del instante a convertir.
 * @returns string `YYYY-MM-DD` en hora Montevideo.
 *
 * @example
 * // 23:30 UY del 21/07 = 02:30 UTC del 22/07
 * montevideoDateOf('2026-07-22T02:30:00Z') // → '2026-07-21'
 */
export function montevideoDateOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return fmt.format(d);
}

/**
 * Convierte un rango de días `YYYY-MM-DD` (calendario Montevideo) a bounds
 * UTC comparables contra una columna `timestamptz`: `gte` (inicio del día
 * `desde`, inclusive) y `ltExclusive` (inicio del día siguiente a `hasta`,
 * exclusivo — cubre TODO el día `hasta` en hora Montevideo).
 *
 * Offset fijo `-03:00`: Uruguay no tiene DST desde 2015 (ver nota de
 * REGLA CANONICAL DE TZ al inicio del archivo). Si UY reinstaurara DST, este
 * offset dejaría de ser válido para todo el año.
 *
 * @param desde - Fecha `YYYY-MM-DD` (inclusive), día Montevideo.
 * @param hasta - Fecha `YYYY-MM-DD` (inclusive), día Montevideo.
 * @returns `{ gte, ltExclusive }` — strings ISO-8601 UTC.
 *
 * @example
 * montevideoRangeToUtc('2026-07-21', '2026-07-21')
 * // → { gte: '2026-07-21T03:00:00.000Z', ltExclusive: '2026-07-22T03:00:00.000Z' }
 */
export function montevideoRangeToUtc(desde: string, hasta: string): { gte: string; ltExclusive: string } {
  const gte = new Date(`${desde}T00:00:00-03:00`).toISOString();

  const [y, m, d] = hasta.split('-').map((v) => parseInt(v, 10));
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  const ltExclusive = new Date(`${nextDayStr}T00:00:00-03:00`).toISOString();

  return { gte, ltExclusive };
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

/**
 * Ventana de fecha CANÓNICA (request 2026-06-12), transversal a toda la app.
 *
 * Devuelve los límites `fch_para` (formato `YYYY-MM-DD`, igual que la BD) que
 * definen qué registros "existen" para la fecha seleccionada:
 *
 *  - Si `fecha` === hoy (Montevideo):  desde = ayer, hasta = hoy, isToday = true.
 *      (la app debe traer: pendientes de ayer + pendientes de hoy + finalizados de hoy)
 *  - Si `fecha` < hoy (día pasado):    desde = hasta = fecha, isToday = false.
 *      (solo importan los registros de la fecha seleccionada, cualquier estado)
 *
 * El acoplamiento con `estado_nro` (estado=1 para el arrastre de ayer, estado=2
 * para finalizados de hoy) lo aplica cada call site, porque varía según el uso
 * (ej. el conteo de "sin asignar" solo considera estado=1).
 *
 * NOTA: la BD almacena `fch_para` como `YYYY-MM-DD` (con guiones) tanto en
 * `pedidos` como en `services` — NO usar el formato compacto YYYYMMDD para
 * comparar contra `fch_para`.
 */
export function dateWindowBounds(
  fecha: string,
  now: Date = new Date(),
): { isToday: boolean; desde: string; hasta: string } {
  const hoy = todayMontevideo(now);
  if (fecha === hoy) {
    return { isToday: true, desde: daysAgoMontevideo(1, now), hasta: hoy };
  }
  return { isToday: false, desde: fecha, hasta: fecha };
}

/**
 * Cláusula PostgREST `.or(...)` que implementa la VENTANA DE FECHA canónica
 * (request 2026-06-12) sobre `fch_para` (formato `YYYY-MM-DD`, igual que la BD).
 *
 *  - fecha === hoy:  `(fch_para entre ayer y hoy ∧ estado=1) ∨ (fch_para=hoy ∧ estado=2)`
 *  - fecha < hoy:    `fch_para = fecha`  (cualquier estado)
 *
 * Uso: `query.or(buildFchParaWindowOr(fecha))`.
 *
 * IMPORTANTE: usa guiones (`2026-06-12`). NO usar el formato compacto YYYYMMDD
 * (era el bug histórico: la comparación nunca matcheaba y el arrastre de
 * pendientes de ayer quedaba inactivo).
 */
export function buildFchParaWindowOr(fecha: string, now: Date = new Date()): string {
  const { isToday, desde, hasta } = dateWindowBounds(fecha, now);
  if (isToday) {
    return `and(fch_para.gte.${desde},fch_para.lte.${hasta},estado_nro.eq.1),and(fch_para.eq.${hasta},estado_nro.eq.2)`;
  }
  return `fch_para.eq.${fecha}`;
}

// ─────────────────────────────────────────────────────────────────
// Formatters de display — siempre con timeZone: 'America/Montevideo'
//
// IMPORTANTE: No usar date-fns `format()` para timestamps GPS/moviles
// porque date-fns usa la TZ del proceso JS (UTC en Node SSR).
// Usar estas funciones en su lugar.
// ─────────────────────────────────────────────────────────────────

/**
 * Formatea un timestamp a hora MVD en formato HH:mm:ss.
 * Seguro para SSR y CSR.
 *
 * @param value - string ISO, Date, o timestamp numérico.
 * @returns string "HH:mm:ss" en hora Montevideo.
 *
 * @example
 * // GPS a las 23:59 UY (= 02:59 UTC del día siguiente)
 * formatTimeMVD('2026-06-09T02:59:53Z') // → '23:59:53'
 */
export function formatTimeMVD(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: MONTEVIDEO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Formatea un timestamp a hora MVD en formato HH:mm (sin segundos).
 * Seguro para SSR y CSR.
 *
 * @param value - string ISO, Date, o timestamp numérico.
 * @returns string "HH:mm" en hora Montevideo.
 */
export function formatTimeShortMVD(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: MONTEVIDEO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Formatea un timestamp a fecha MVD en formato dd/MM/yyyy.
 * Seguro para SSR y CSR.
 *
 * @param value - string ISO, Date, o timestamp numérico.
 * @returns string "dd/MM/yyyy" en hora Montevideo.
 */
export function formatDateMVD(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: MONTEVIDEO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Formatea un timestamp a fecha+hora MVD en formato dd/MM/yyyy HH:mm.
 * Seguro para SSR y CSR.
 *
 * @param value - string ISO, Date, o timestamp numérico.
 * @returns string "dd/MM/yyyy HH:mm" en hora Montevideo.
 */
export function formatDateTimeMVD(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: MONTEVIDEO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Formatea un timestamp a fecha+hora+segundos MVD en formato dd/MM/yyyy HH:mm:ss.
 * Seguro para SSR y CSR.
 *
 * @param value - string ISO, Date, o timestamp numérico.
 * @returns string "dd/MM/yyyy HH:mm:ss" en hora Montevideo.
 */
export function formatDateTimeSecsMVD(value: string | Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: MONTEVIDEO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}
