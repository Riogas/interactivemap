/**
 * Scoping de puntos de interés para distribuidor.
 *
 * Reglas:
 *   - Root o despacho: ven todos los POIs (sin filtrar).
 *   - Distribuidor (otros roles, con allowedEmpresas):
 *       - tipo === 'publico'  → siempre visible.
 *       - tipo === 'osm'      → siempre visible (POIs importados de OpenStreetMap).
 *       - tipo === 'privado'  → solo si empresa_fletera_id ∈ allowedEmpresas.
 *       - cualquier otro tipo → NO visible (fail-closed).
 *   - Si no hay user (null), fail-closed → false.
 *
 * Defensa en profundidad: el endpoint server-side ya aplica un OR equivalente,
 * pero este helper se usa también en el cliente para no exponer datos si la
 * respuesta del server llegase con scope incorrecto.
 */

import {
  isRoot,
  isDespacho,
  shouldScopeByEmpresa,
  getScopedEmpresas,
} from './auth-scope';

export interface PuntoInteresScopeable {
  tipo?: 'publico' | 'privado' | 'osm' | string | null;
  empresa_fletera_id?: number | null;
}

interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string }>;
  allowedEmpresas?: number[] | null;
}

export function isPuntoInteresInScope(
  pi: PuntoInteresScopeable,
  user: ScopedUser | null | undefined
): boolean {
  if (!user) return false;
  if (isRoot(user) || isDespacho(user)) return true;
  if (!shouldScopeByEmpresa(user)) return true;

  const tipo = String(pi.tipo || '').toLowerCase();
  if (tipo === 'publico' || tipo === 'osm') return true;
  if (tipo !== 'privado') return false;

  const allowed = getScopedEmpresas(user) || [];
  if (allowed.length === 0) return false;
  if (pi.empresa_fletera_id == null) return false;
  return allowed.includes(Number(pi.empresa_fletera_id));
}

export function filterPuntosInteresByScope<T extends PuntoInteresScopeable>(
  items: T[],
  user: ScopedUser | null | undefined
): T[] {
  return items.filter((p) => isPuntoInteresInScope(p, user));
}
