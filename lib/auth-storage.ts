/**
 * Wrapper de almacenamiento para datos de sesión/auth (token, user, permisos,
 * escenarios y empresas permitidas).
 *
 * Comportamiento:
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
 * Las keys de auth son las que empiezan con `trackmovil_` (token, user,
 * allowed_empresas, allowed_escenarios, escenario_id, permisos). Las
 * preferencias de UI (`userPreferences`, etc.) NO usan este wrapper —
 * siguen en localStorage para que persistan entre sesiones.
 */

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export const authStorage = {
  getItem(key: string): string | null {
    if (!isBrowser()) return null;
    // Prioridad: sessionStorage. Fallback a localStorage solo para migración.
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  },

  setItem(key: string, value: string): void {
    if (!isBrowser()) return;
    window.sessionStorage.setItem(key, value);
    // Limpiar la copia vieja de localStorage para que cuando la pestaña se
    // cierre, no quede nada persistente.
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
};
