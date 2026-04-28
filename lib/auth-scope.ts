/**
 * Helpers de scoping por rol/empresa para limitar lo que ve el usuario en el dashboard.
 *
 * Reglas de negocio:
 *   - Root (isRoot === 'S'): ve todo, sin restricción.
 *   - Despacho (RolId === '49'): ve todo, despacho wins por sobre allowedEmpresas.
 *   - Otros usuarios (típicamente "distribuidor"): se limitan al set de zonas
 *     que cubre el conjunto allowedEmpresas configurado en sus preferencias
 *     (fail-closed si allowedEmpresas es null o vacío).
 */

interface UserRole {
  RolId: string;
  RolNombre: string;
  RolTipo: string;
}

interface ScopedUser {
  isRoot?: string;
  roles?: UserRole[];
  allowedEmpresas?: number[] | null;
}

/** True si el usuario es root (sin restricción). */
export function isRoot(user: ScopedUser | null | undefined): boolean {
  return user?.isRoot === 'S';
}

/** True si el usuario tiene rol Despacho (RolId === '49'). */
export function isDespacho(user: ScopedUser | null | undefined): boolean {
  return user?.roles?.some((r) => String(r.RolId) === '49') ?? false;
}

/** True si hay que aplicar scoping por empresa: ni root ni despacho. */
export function shouldScopeByEmpresa(user: ScopedUser | null | undefined): boolean {
  return !isRoot(user) && !isDespacho(user);
}

/**
 * Devuelve las empresas a usar para scoping, o null si no hay restricción.
 *   - null  → sin scope (root o despacho).
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
