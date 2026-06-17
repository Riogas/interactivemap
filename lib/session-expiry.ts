/**
 * Lógica pura de expiración de sesión por INACTIVIDAD (sliding / rolling window).
 *
 * Antes: la sesión expiraba 8h después del LOGIN (corte absoluto). Eso echaba a
 * los despachadores a mitad de turno — si entraban ~14h, a las ~22h se les vencía
 * la sesión a todos casi a la vez y los mandaba a la pantalla de login.
 *
 * Ahora: la sesión expira tras 8h de INACTIVIDAD. Cada interacción del usuario
 * renueva la marca de actividad, así que un usuario activo nunca es expulsado;
 * una sesión abandonada igual se cierra a las 8h (se preserva la propiedad de
 * seguridad del logout por inactividad).
 *
 * Estas funciones son puras (sin acceso a storage ni a `Date.now()` salvo default
 * inyectable) para poder testearlas. El wiring con storage + listeners de
 * actividad vive en `contexts/AuthContext.tsx`.
 */

/** Duración máxima de INACTIVIDAD antes de expirar la sesión: 8 horas (en ms). */
export const SESSION_MAX_IDLE_MS = 8 * 60 * 60 * 1000;

/** No persistir la marca de actividad más de una vez por minuto (evita spam a storage). */
export const ACTIVITY_PERSIST_THROTTLE_MS = 60 * 1000;

/** Cada cuánto se chequea la expiración mientras la app está abierta. */
export const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;

/** Key de storage para la última actividad del usuario (epoch ms como string). */
export const LAST_ACTIVITY_KEY = 'trackmovil_last_activity';

/**
 * ¿La sesión expiró por inactividad?
 *
 * @param lastActivityMs - epoch ms de la última actividad (o del login si aún no hubo).
 * @param nowMs - ahora (inyectable para tests). Default `Date.now()`.
 * @param maxIdleMs - ventana máxima de inactividad. Default `SESSION_MAX_IDLE_MS`.
 * @returns true si pasó más de `maxIdleMs` desde la última actividad. Un valor
 *          ausente/inválido/<=0 se trata como expirado (fail-closed).
 */
export function isIdleExpired(
  lastActivityMs: number | null | undefined,
  nowMs: number = Date.now(),
  maxIdleMs: number = SESSION_MAX_IDLE_MS,
): boolean {
  if (lastActivityMs == null || isNaN(lastActivityMs) || lastActivityMs <= 0) return true;
  return nowMs - lastActivityMs > maxIdleMs;
}

/**
 * Resuelve la marca de actividad efectiva en epoch ms.
 *
 * Prioridad:
 *   1. La última actividad persistida (`storedActivity`), si es un número válido.
 *   2. El `loginTime` (ISO string), como semilla en el primer arranque sin
 *      actividad registrada (ej. sesión migrada de antes de esta feature).
 *   3. `0` si no hay ninguno → `isIdleExpired` lo tratará como expirado.
 *
 * @param storedActivity - valor crudo leído de storage (string epoch ms) o null.
 * @param loginTime - ISO string del momento de login, o null/undefined.
 */
export function resolveLastActivityMs(
  storedActivity: string | null,
  loginTime: string | null | undefined,
): number {
  if (storedActivity) {
    const t = parseInt(storedActivity, 10);
    if (!isNaN(t) && t > 0) return t;
  }
  if (loginTime) {
    const t = new Date(loginTime).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}
