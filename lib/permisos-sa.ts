/**
 * Helper centralizado para los 3 permisos granulares de "pedidos sin asignar".
 *
 * Fuente de verdad:
 *   1. Si user.permisos_sa no es null: sus valores overridean la derivación por rol.
 *   2. Si es null: derivar por rol (preserva comportamiento anterior).
 *
 * Permisos:
 *   - acumulados: indicador navbar + KPIs globales en stats page.
 *   - x_zona:    Cap. Entrega del mapa + modales de zona + combo de zona.
 *   - unitarios: marcadores individuales en mapa + sidebar + combos de tabla.
 */

interface UserLike {
  isRoot?: string;
  roles?: Array<{ RolId: string | number }>;
  permisos_sa?: {
    acumulados?: boolean;
    x_zona?: boolean;
    unitarios?: boolean;
  } | null;
}

interface ScopeLike {
  isRestricted?: boolean;
}

export type PermisosSA = {
  acumulados: boolean;
  x_zona: boolean;
  unitarios: boolean;
};

const TODOS_TRUE: PermisosSA  = { acumulados: true,  x_zona: true,  unitarios: true  };
const TODOS_FALSE: PermisosSA = { acumulados: false, x_zona: false, unitarios: false };

const PRIVILEGED_ROL_IDS = new Set(['48', '49', '50']);

/**
 * Resuelve los 3 permisos SA para un usuario dado su contexto.
 *
 * Reglas (en orden de precedencia):
 *  1. user.permisos_sa !== null  → override explícito (cada campo con fallback a false).
 *  2. user.isRoot === 'S'        → todos true.
 *  3. roles incluye 48/49/50     → todos true.
 *  4. scope.isRestricted === true → todos false.
 *  5. Cualquier otro caso        → todos false (conservador).
 */
export function getPermisosSA(
  user: UserLike | null | undefined,
  scope?: ScopeLike,
): PermisosSA {
  if (!user) return TODOS_FALSE;

  // Override explícito: permisos_sa no es null ni undefined
  if (user.permisos_sa != null) {
    return {
      acumulados: user.permisos_sa.acumulados ?? false,
      x_zona:     user.permisos_sa.x_zona     ?? false,
      unitarios:  user.permisos_sa.unitarios   ?? false,
    };
  }

  // Derivación por rol (permisos_sa === null)

  // Root: acceso total
  if (user.isRoot === 'S') return TODOS_TRUE;

  // Roles privilegiados (Dashboard 48, Despacho 49, Supervisor 50)
  if (user.roles?.some(r => PRIVILEGED_ROL_IDS.has(String(r.RolId)))) {
    return TODOS_TRUE;
  }

  // Distribuidor con restricción de scope
  if (scope?.isRestricted === true) return TODOS_FALSE;

  // Cualquier otro rol: conservador
  return TODOS_FALSE;
}
