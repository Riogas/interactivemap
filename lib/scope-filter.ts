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
 * Reglas (actualizadas tras refactor de gates por funcionalidad — commits
 * e44763f, 6937e0a):
 *   - Sin scope (root/despacho) → todo pasa.
 *   - Pedido CON móvil: el móvil debe estar en allowedMovilIds Y la zona
 *     en scopedZonaIds.
 *   - Pedido SIN móvil (sin-asignar):
 *       · Si NO tiene zona → no pasa (no scopeable).
 *       · Si tiene zona → pasa si la zona está en scopedZonaIds.
 *       · Adicional: si el caller pidió hideEntregadosSinMovil=true Y el
 *         pedido es finalizado (estado=2) → no pasa.
 *     ANTES: regla legacy hardcodeaba "sin móvil → false" para todo
 *     distribuidor. Eso contradecía los gates por funcionalidad
 *     (Ped s/asignar acumulados/x zona/unitarios) que ahora controlan
 *     visibilidad de sin-asignar en la UI. La decisión de mostrar/ocultar
 *     sin-asignar a un distribuidor ahora pertenece al caller vía permisos,
 *     no al scope filter.
 *   - Pedido con móvil sin zona: NO pasa.
 *   - scopedZonaIds === null bajo isRestricted true es defensivo: tratado
 *     como "todo pasa".
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

  // Sin móvil (sin-asignar): scope solo por zona.
  // La decisión de mostrar/ocultar sin-asignar al distribuidor se delegó a
  // los gates de funcionalidad (Ped s/asignar acumulados/x zona/unitarios)
  // en los call-sites — este helper ya no la bloquea. Ver commit e44763f.
  if (sinMovil) {
    if (zonaId === null) return false; // sin zona: no scopeable
    // Finalizados huérfanos siguen filtrándose si el caller lo pide explícito.
    const estadoNro = item.estado_nro != null ? Number(item.estado_nro) : null;
    if (opts.hideEntregadosSinMovil && estadoNro === 2) return false;
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
