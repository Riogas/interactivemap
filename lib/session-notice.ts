/**
 * Aviso de sesión: el motivo por el que la sesión se cerró SIN que el usuario
 * haya apretado "Salir" (vencimiento por inactividad, token rechazado por el
 * SecuritySuite, usuario dado de baja).
 *
 * Por qué existe: cerrar la sesión implica navegar a /login (ProtectedRoute
 * redirige cuando `isAuthenticated` pasa a false). Sin este puente el usuario
 * aterriza en el login sin ninguna explicación y lee el deslogueo como un bug
 * de la app. Es el mismo patrón que `trackmovil:user_eq_pass_warning`
 * (login → dashboard), en la dirección inversa.
 *
 * Va en `sessionStorage` crudo a propósito, NO en `authStorage`: no es un dato
 * de sesión (no debe espejarse a localStorage en Modo Kiosko) y tiene que
 * sobrevivir exactamente una navegación.
 */

export const SESSION_NOTICE_KEY = 'trackmovil:session_notice';

/** Cierre por inactividad (lib/session-expiry.ts). */
export const AVISO_SESION_INACTIVIDAD =
  'Tu sesión se cerró por inactividad. Volvé a iniciar sesión.';

/**
 * El SecuritySuite rechazó el token (TOKEN_INVALIDO / TOKEN_VENCIDO /
 * SIN_TOKEN / USUARIO_NO_ENCONTRADO). Pasa, entre otras cosas, cuando rota el
 * secreto de firma: todos los tokens emitidos antes dejan de valer de golpe.
 */
export const AVISO_SESION_RECHAZADA =
  'Tu sesión venció o dejó de ser válida. Volvé a iniciar sesión.';

/** Deja el aviso para que lo levante la pantalla de login. */
export function setSessionNotice(motivo: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_NOTICE_KEY, motivo);
  } catch {
    // Sin sessionStorage perdemos el cartel, pero el deslogueo igual ocurre.
  }
}

/**
 * Lee y BORRA el aviso. Es one-shot a propósito: si quedara guardado, el
 * próximo login mostraría un "tu sesión venció" que ya no corresponde.
 */
export function takeSessionNotice(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const motivo = window.sessionStorage.getItem(SESSION_NOTICE_KEY);
    if (motivo) window.sessionStorage.removeItem(SESSION_NOTICE_KEY);
    return motivo && motivo.trim() !== '' ? motivo : null;
  } catch {
    return null;
  }
}
