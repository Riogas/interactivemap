/**
 * Wrapper de almacenamiento para datos de sesión/auth (token, user, permisos,
 * escenarios y empresas permitidas).
 *
 * Comportamiento (modo `'session'`, DEFAULT — todo usuario NO-kiosko):
 *   - PRIMARIO: sessionStorage. Persiste mientras la pestaña está viva +
 *     soporta F5/refresh. Se borra al cerrar la pestaña, el navegador, o al
 *     reiniciar la PC. Eso resuelve el bug reportado: la sesión NO debe
 *     persistir más allá de la vida de la pestaña.
 *   - FALLBACK al leer: localStorage. Sirve solo para migración suave —
 *     usuarios que tenían sesión activa antes del deploy no quedan
 *     deslogueados de inmediato. La próxima vez que `setItem` se ejecuta,
 *     migramos el valor a sessionStorage y limpiamos localStorage.
 *   - Después de cerrar pestaña/navegador la sessionStorage se borra y el
 *     localStorage ya está limpio (porque el último setItem lo limpió),
 *     entonces el siguiente login será forzado.
 *
 * Modo `'local'` (Modo Kiosko — ver `lib/kiosk.ts`):
 *   - `setItem` escribe en localStorage (sobrevive reinicio de navegador/PC,
 *     requisito de Modo Kiosko) Y espeja en sessionStorage (evita que `getItem`,
 *     que prioriza sessionStorage, devuelva un valor viejo tras el flip de modo).
 *
 * El modo es un estado a nivel de MÓDULO (`persistMode`), default `'session'`.
 * Solo `contexts/AuthContext.tsx` lo flipea a `'local'`, y SIEMPRE guardado por
 * `resolveModoKiosko(...) === true` resuelto desde los atributos del usuario
 * recién autenticado — nunca antes de conocer el atributo. Esto garantiza que
 * NINGÚN usuario no-kiosko persiste su sesión en localStorage: el modo vuelve a
 * `'session'` al inicio de cada login y en el logout.
 *
 * Las keys de auth son las que empiezan con `trackmovil_` (token, user,
 * allowed_empresas, allowed_escenarios, escenario_id, permisos). Las
 * preferencias de UI (`userPreferences`, etc.) NO usan este wrapper —
 * siguen en localStorage para que persistan entre sesiones.
 */

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export type AuthPersistMode = 'session' | 'local';

let persistMode: AuthPersistMode = 'session';

export const authStorage = {
  getItem(key: string): string | null {
    if (!isBrowser()) return null;
    // Prioridad: sessionStorage. Fallback a localStorage solo para migración.
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  },

  setItem(key: string, value: string): void {
    if (!isBrowser()) return;
    if (persistMode === 'local') {
      // Modo Kiosko: persistir en localStorage (sobrevive reinicio) + espejar
      // en sessionStorage para que getItem no quede leyendo un valor viejo.
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // no-op
      }
      window.sessionStorage.setItem(key, value);
      return;
    }
    window.sessionStorage.setItem(key, value);
    // Limpiar la copia vieja de localStorage para que cuando la pestaña se
    // cierre, no quede nada persistente. Corre SIEMPRE en modo 'session', sin
    // excepciones — incluso si hubo basura de una migración previa o de un
    // usuario kiosko anterior en la misma PC compartida.
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  },

  removeItem(key: string): void {
    if (!isBrowser()) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // no-op
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  },

  /**
   * Cambia el modo de persistencia. Llamado EXCLUSIVAMENTE desde
   * `contexts/AuthContext.tsx`: reset a `'session'` al inicio de cada login y
   * en logout; flip a `'local'` solo tras resolver `ModoKiosko === true` desde
   * los atributos del usuario recién autenticado/rehidratado.
   */
  setPersistMode(mode: AuthPersistMode): void {
    persistMode = mode;
  },

  /** Solo para tests: expone el modo de persistencia actual. */
  getPersistMode(): AuthPersistMode {
    return persistMode;
  },
};
