/**
 * Helpers de scoping por rol/empresa para limitar lo que ve el usuario en el dashboard.
 *
 * Reglas de negocio (post-refactor funcionalidades):
 *   - Root (isRoot === 'S' o rol RolNombre === 'Root'): ve todo, sin restricción.
 *   - Usuarios con funcionalidad 'Ver todas las empresas': ven todas las empresas/zonas.
 *   - Otros usuarios (típicamente "distribuidor"): se limitan al set de zonas
 *     que cubre el conjunto allowedEmpresas configurado en sus preferencias
 *     (fail-closed si allowedEmpresas es null o vacío).
 */

import { type RoleWithFuncionalidades } from './role-funcionalidades';

interface UserRole extends RoleWithFuncionalidades {
  RolId: string;
  RolNombre: string;
  RolTipo: string;
}

interface ScopedUser {
  isRoot?: string;
  roles?: UserRole[];
  allowedEmpresas?: number[] | null;
  /** True si el usuario tiene EmpFletera {"TODAS":"*"} → ve todas las empresas. */
  verTodasEmpresas?: boolean;
}

/**
 * True si el usuario es root (sin restricción).
 * - Modo legacy: atributo user.isRoot === 'S' (preservado por compat).
 * - Modo nuevo: alguno de sus roles tiene RolNombre === 'Root'.
 */
export function isRoot(user: ScopedUser | null | undefined): boolean {
  if (user?.isRoot === 'S') return true;
  return user?.roles?.some((r) => String(r.RolNombre ?? '').trim() === 'Root') ?? false;
}

/**
 * True si el usuario puede ver todas las empresas/zonas sin restricción de scope.
 *
 * Modelo data-driven (sin hardcodeo de roles): el privilegio "ver todas las
 * empresas" proviene del atributo de usuario `EmpFletera` con valor {"TODAS":"*"},
 * que AuthContext resuelve en el flag `verTodasEmpresas` al hacer login.
 *
 * Root mantiene el bypass legacy (su eliminación se trata como tarea aparte).
 */
export function canSeeAllEmpresas(user: ScopedUser | null | undefined): boolean {
  if (isRoot(user)) return true;
  return user?.verTodasEmpresas === true;
}

/** True si hay que aplicar scoping por empresa: el usuario NO puede ver todas las empresas. */
export function shouldScopeByEmpresa(user: ScopedUser | null | undefined): boolean {
  return !canSeeAllEmpresas(user);
}

/**
 * True si el usuario tiene privilegios para el scope de zonas visibles en el mapa.
 * Delega a canSeeAllEmpresas — mantenido por compatibilidad con llamadores existentes.
 */
export function isPrivilegedForZonaScope(user: ScopedUser | null | undefined): boolean {
  return canSeeAllEmpresas(user);
}

/**
 * Devuelve las empresas a usar para scoping, o null si no hay restricción.
 *   - null  → sin scope (tiene 'Ver todas las empresas' o es root).
 *   - []    → fail-closed (allowedEmpresas null/undefined o vacío).
 *   - [...] → IDs de empresas permitidas.
 */
export function getScopedEmpresas(user: ScopedUser | null | undefined): number[] | null {
  if (!shouldScopeByEmpresa(user)) return null;
  const allowed = user?.allowedEmpresas;
  if (!Array.isArray(allowed)) return [];
  return allowed;
}

/**
 * Parsea el campo JSONB `zonas` de fleteras_zonas, que puede venir como array
 * de números, strings o mixto (incluyendo nulls). Filtra NaN y duplicados.
 */
export function parseZonasJsonb(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
