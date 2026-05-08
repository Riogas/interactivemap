/**
 * Helpers de scoping por rol/empresa para limitar lo que ve el usuario en el dashboard.
 *
 * Reglas de negocio:
 *   - Root (isRoot === 'S'): ve todo, sin restricción.
 *   - Despacho (RolId === '49'): ve todo, despacho wins por sobre allowedEmpresas.
 *   - Otros usuarios (típicamente "distribuidor"): se limitan al set de zonas
 *     que cubre el conjunto allowedEmpresas configurado en sus preferencias
 *     (fail-closed si allowedEmpresas es null o vacío).
 *
 * RolId conocidos del Security Suite:
 *   48 = Dashboard
 *   49 = Despacho
 *   50 = Supervisor
 */

import { getPermisosSA } from './permisos-sa';

interface UserRole {
  RolId: string;
  RolNombre: string;
  RolTipo: string;
}

interface ScopedUser {
  isRoot?: string;
  roles?: UserRole[];
  allowedEmpresas?: number[] | null;
  permisos_sa?: {
    acumulados?: boolean;
    x_zona?: boolean;
    unitarios?: boolean;
  } | null;
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
 * True si el usuario tiene privilegios para el scope de zonas visibles en el mapa.
 * Estos roles ven TODAS las zonas sin importar la selección de empresas en el header.
 *
 * Roles privilegiados:
 *   - Root        (isRoot === 'S')
 *   - Despacho    (RolId === '49')
 *   - Dashboard   (RolId === '48')
 *   - Supervisor  (RolId === '50')
 *
 * Para todos los demás roles (distribuidores, etc.), las zonas visibles se
 * restringen a las empresas actualmente seleccionadas en el selector del header.
 */
export function isPrivilegedForZonaScope(user: ScopedUser | null | undefined): boolean {
  if (isRoot(user)) return true;
  const PRIVILEGED_ROL_IDS = new Set(['48', '49', '50']);
  return user?.roles?.some((r) => PRIVILEGED_ROL_IDS.has(String(r.RolId))) ?? false;
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
 * True si el usuario tiene privilegios para ver y contar "pedidos sin asignar"
 * en la capa Cap. Entrega del mapa (permiso x_zona).
 *
 * Wrapper sobre getPermisosSA — usa el permiso `x_zona`.
 * El comportamiento backward-compatible se preserva: cuando permisos_sa es null,
 * la derivación por rol replica la lógica anterior (root/48/49/50 → true, resto → false).
 */
export function isPrivilegedForCapEntrega(user: ScopedUser | null | undefined): boolean {
  return getPermisosSA(user).x_zona;
}

/**
 * True si el usuario tiene privilegios para ver métricas de "sin asignar"
 * (pedidos/services sin móvil asignado) en la pantalla de estadísticas (permiso acumulados).
 *
 * Wrapper sobre getPermisosSA — usa el permiso `acumulados`.
 * El comportamiento backward-compatible se preserva: cuando permisos_sa es null,
 * la derivación por rol replica la lógica anterior (root/48/49/50 → true, resto → false).
 */
export function isPrivilegedForUnassignedVisibility(user: ScopedUser | null | undefined): boolean {
  return getPermisosSA(user).acumulados;
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
