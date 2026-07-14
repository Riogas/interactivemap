/**
 * Lógica pura de "Modo Kiosko" (espejo del patrón de `lib/session-expiry.ts`).
 *
 * Un usuario marcado con el atributo de rol `ModoKiosko` está pensado para operar
 * una PC de pared que muestra `/dashboard/stats` indefinidamente, sin intervención
 * humana: la sesión nunca expira por inactividad, sobrevive reinicios de
 * navegador/PC (persistencia condicional en `localStorage`, ver `lib/auth-storage.ts`)
 * y la pantalla rueda sola a la fecha de hoy poco después de medianoche.
 *
 * Estas funciones son puras (sin acceso a storage ni DOM, salvo `setTimeout`/
 * `clearTimeout` globales) para poder testearlas. El wiring vive en
 * `contexts/AuthContext.tsx` (bypass de expiración + storage) y en
 * `app/dashboard/stats/page.tsx` (scheduler de rollover + fullscreen best-effort).
 */

/** Nombre del atributo de rol (SecuritySuite) que activa el Modo Kiosko. */
export const KIOSK_ATTR = 'ModoKiosko';

/** Offset tras la medianoche de Montevideo antes de disparar el rollover (AC5). */
export const ROLLOVER_OFFSET_MS = 30_000;

const MONTEVIDEO_TZ = 'America/Montevideo';

/**
 * ¿El valor crudo de un atributo activa Modo Kiosko?
 *
 * Solo valores truthy explícitos activan el modo (fail-safe): `true`, `S`, `1`
 * (trim + case-insensitive), o un JSON literal cuyo valor parseado sea el
 * boolean `true`. Cualquier otra cosa (`false`, `0`, `N`, cadena vacía, JSON no
 * booleano, valores ambiguos) se trata como `false`.
 */
function isTruthyKioskoValue(raw: string): boolean {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'true' || lower === 's' || lower === '1') return true;
  try {
    if (JSON.parse(trimmed) === true) return true;
  } catch {
    // No era JSON válido → ya se evaluó como no-truthy arriba.
  }
  return false;
}

/**
 * Resuelve si el usuario tiene Modo Kiosko activo, a partir de la lista PLANA
 * de atributos de todos sus roles (mismo shape que `readIdleTimeoutOverrideMin`).
 *
 * Semántica OR / más permisiva: si ALGÚN rol tiene `ModoKiosko` con valor truthy,
 * el resultado es `true` (espeja el `Math.max` de `resolveIdleTimeoutMin` — acá
 * el "máximo" entre booleanos es simplemente el OR).
 *
 * @param atributos - lista plana de { atributo, valor } de todos los roles.
 * @returns `true` si algún rol activa Modo Kiosko; `false` por defecto (incluye
 *          atributo ausente, lista vacía/`null`/`undefined`, y valores inválidos).
 */
export function resolveModoKiosko(
  atributos: Array<{ atributo: string; valor: string }> | null | undefined,
): boolean {
  if (!Array.isArray(atributos) || atributos.length === 0) return false;
  for (const a of atributos) {
    if (!a || String(a.atributo).trim() !== KIOSK_ATTR) continue;
    if (isTruthyKioskoValue(String(a.valor))) return true;
  }
  return false;
}

/** Componentes de hora locales de Montevideo (h23, sin ambigüedad de medianoche="24"). */
function montevideoTimeOfDayMs(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MONTEVIDEO_TZ,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const h = get('hour');
  const m = get('minute');
  const s = get('second');
  return h * 3_600_000 + m * 60_000 + s * 1000 + date.getMilliseconds();
}

/**
 * Milisegundos hasta el próximo rollover: la próxima medianoche de
 * America/Montevideo + `offsetMs`.
 *
 * Calculado con reloj de pared vía `Intl.formatToParts` (no offset UTC fijo),
 * por lo que es robusto ante cualquier timezone configurada en la PC que corre
 * el código — el resultado siempre corresponde a la hora de Montevideo.
 *
 * @param now - Ahora (inyectable para tests). Default `new Date()`.
 * @param offsetMs - Offset tras medianoche. Default `ROLLOVER_OFFSET_MS`.
 */
export function msUntilNextRollover(
  now: Date = new Date(),
  offsetMs: number = ROLLOVER_OFFSET_MS,
): number {
  const elapsedTodayMs = montevideoTimeOfDayMs(now);
  const msToMidnight = 24 * 3_600_000 - elapsedTodayMs;
  return msToMidnight + offsetMs;
}

/**
 * Programa el rollover de medianoche: llama a `onRollover` una vez, al llegar
 * el próximo rollover Montevideo (+ offset). Devuelve un cancelador
 * (`clearTimeout` interno) para poder abortarlo desde el caller.
 *
 * DOM-free → testable con `vi.useFakeTimers()`. El consumidor (página de stats)
 * guarda además el id del timer en un `useRef` propio para poder reprogramar sin
 * duplicar timers (lección settimeout-id-persistence).
 *
 * @param onRollover - Callback a ejecutar al llegar el rollover.
 * @param now - Función que devuelve "ahora" (inyectable para tests). Default `() => new Date()`.
 * @param offsetMs - Offset tras medianoche. Default `ROLLOVER_OFFSET_MS`.
 * @returns función cancel() que limpia el timer pendiente.
 */
export function scheduleRollover(
  onRollover: () => void,
  now: () => Date = () => new Date(),
  offsetMs: number = ROLLOVER_OFFSET_MS,
): () => void {
  const delay = msUntilNextRollover(now(), offsetMs);
  const timerId = setTimeout(onRollover, delay);
  return () => clearTimeout(timerId);
}
