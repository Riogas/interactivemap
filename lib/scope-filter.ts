/**
 * Filtro de scope para pedidos/services en la UI del dashboard.
 *
 * Aplica las mismas reglas que ya cubren el mapa: un usuario distribuidor
 * (no root, no despacho) sólo puede ver pedidos/services cuyo móvil pertenece
 * a su empresa permitida (allowedEmpresas) Y cuya zona está dentro de su scope
 * (las zonas que cubre fleteras_zonas para esa empresa).
 *
 * Este helper se usa en la Vista Extendida (PedidosTableModal / ServicesTableModal),
 * en los indicadores del topbar (DashboardIndicators) y en las estadísticas por
 * zona (ZonaEstadisticasModal). NO toca pedidosCompletos ni servicesCompletos
 * en el dashboard — esos siguen filtrando solo por allowedMovilIds (legacy);
 * acá agregamos el segundo eje (zona) y la regla de "entregados sin móvil".
 *
 * Reglas:
 *   - Sin scope (root/despacho) → todo pasa.
 *   - Pedido con móvil: el móvil debe estar en allowedMovilIds Y la zona en scopedZonaIds.
 *   - Pedido pendiente sin móvil: la zona debe estar en scopedZonaIds.
 *   - Pedido finalizado sin móvil: NUNCA pasa cuando hideEntregadosSinMovil = true
 *     (caso típico en la Vista Extendida e indicadores).
 *   - Pedido sin zona: NO pasa bajo scope (no podemos decidir).
 *   - scopedZonaIds === null bajo isRestricted true es un caso defensivo: tratado
 *     como "todo pasa" para no romper si el caller no propaga el set; el dashboard
 *     siempre pasa un set concreto (eventualmente vacío) cuando isRestricted = true.
 */

interface ScopeCheckable {
  movil?: number | string | null;
  zona_nro?: number | string | null;
  estado_nro?: number | string | null;
}

export interface ScopeFilter {
  /** null = sin scope (root/despacho); Set vacío = fail-closed. */
  scopedZonaIds: Set<number> | null;
  /** IDs de móviles permitidos. Ignorado si scopedZonaIds es null. */
  allowedMovilIds: Set<number>;
  /** True si shouldScopeByEmpresa(user) && allowedEmpresas.length > 0. */
  isRestricted: boolean;
}

export interface ScopeFilterOpts {
  /** Si true: pedidos finalizados sin móvil quedan SIEMPRE fuera. */
  hideEntregadosSinMovil: boolean;
}

function isInScope(item: ScopeCheckable, scope: ScopeFilter, opts: ScopeFilterOpts): boolean {
  if (!scope.isRestricted) return true;
  // Defensa: si caller dice isRestricted pero no nos pasó scopedZonaIds,
  // no podemos decidir — dejamos pasar para no esconder datos por error.
  if (scope.scopedZonaIds === null) return true;

  const movilId = item.movil != null ? Number(item.movil) : 0;
  const zonaId = item.zona_nro != null ? Number(item.zona_nro) : null;
  const sinMovil = !movilId;
  const finalizado = Number(item.estado_nro) === 2;

  if (sinMovil) {
    if (finalizado && opts.hideEntregadosSinMovil) return false;
    if (zonaId === null) return false;
    return scope.scopedZonaIds.has(zonaId);
  }

  if (!scope.allowedMovilIds.has(movilId)) return false;
  if (zonaId === null) return false;
  return scope.scopedZonaIds.has(zonaId);
}

export function isPedidoInScope(p: ScopeCheckable, scope: ScopeFilter, opts: ScopeFilterOpts): boolean {
  return isInScope(p, scope, opts);
}

export function isServiceInScope(s: ScopeCheckable, scope: ScopeFilter, opts: ScopeFilterOpts): boolean {
  return isInScope(s, scope, opts);
}
