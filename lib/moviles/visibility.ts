/**
 * Helpers para decidir qué móviles son visibles en la UI.
 *
 * Reglas del negocio:
 *  - Un móvil es "activo para UI" cuando su estadoNro es null/undefined o
 *    está en [0, 1, 2]. Todo otro estado (3, 4, 5, 15, …) cuenta como no-activo.
 *  - Un móvil NO-activo pero que igual tiene pedidos o services asignados del
 *    día debe quedar "oculto-pero-operativo": no se muestra en colapsables de
 *    móviles ni entra en indicadores/estadísticas de móviles, pero sus pedidos
 *    y services SÍ se siguen viendo en sus colapsables y vistas extendidas.
 *
 * Este archivo es stateless y no importa React.
 */

/** True si estadoNro corresponde a un móvil "activo" desde el punto de vista de la UI. */
export function isMovilActiveForUI(estadoNro: number | null | undefined): boolean {
  if (estadoNro === null || estadoNro === undefined) return true;
  return estadoNro === 0 || estadoNro === 1 || estadoNro === 2;
}

interface MovilLike {
  id: number;
  estadoNro?: number | null;
}

interface WithMovilRef {
  movil?: number | string | null;
}

/**
 * True si el móvil es no-activo (estado != 0/1/2) pero tiene al menos un pedido
 * o service cuyo campo `movil` coincide con su id.
 */
export function isMovilHidden(
  movil: MovilLike,
  pedidos: Array<WithMovilRef>,
  services?: Array<WithMovilRef>,
): boolean {
  if (isMovilActiveForUI(movil.estadoNro)) return false;
  const hasPedido = pedidos.some(p => p.movil != null && Number(p.movil) === movil.id);
  if (hasPedido) return true;
  if (services && services.length > 0) {
    return services.some(s => s.movil != null && Number(s.movil) === movil.id);
  }
  return false;
}

/**
 * Devuelve el set de IDs (numéricos) de los móviles ocultos-pero-operativos
 * dentro de una lista de móviles. Solo itera sobre los no-activos, para no
 * recorrer toda la lista innecesariamente.
 */
export function getHiddenMovilIds(
  moviles: MovilLike[],
  pedidos: Array<WithMovilRef>,
  services?: Array<WithMovilRef>,
): Set<number> {
  const hidden = new Set<number>();
  for (const m of moviles) {
    if (isMovilActiveForUI(m.estadoNro)) continue;
    if (isMovilHidden(m, pedidos, services)) hidden.add(m.id);
  }
  return hidden;
}

/**
 * Versión basada en el Map completo `allMovilEstados` (movil_id crudo → estadoNro).
 * Devuelve un Set<string> con el movil_id tal como se guarda en las tablas de
 * relaciones (p. ej. moviles_zonas.movil_id), para poder matchear sin casteos.
 */
export function getHiddenMovilIdsFromEstadosMap(
  estadosMap: Map<string, number>,
  pedidos: Array<WithMovilRef>,
  services?: Array<WithMovilRef>,
): Set<string> {
  const hidden = new Set<string>();
  if (!estadosMap || estadosMap.size === 0) return hidden;
  for (const [key, estadoNro] of estadosMap.entries()) {
    if (isMovilActiveForUI(estadoNro)) continue;
    const hasPedido = pedidos.some(p => p.movil != null && String(p.movil) === key);
    if (hasPedido) {
      hidden.add(key);
      continue;
    }
    if (services && services.length > 0) {
      const hasService = services.some(s => s.movil != null && String(s.movil) === key);
      if (hasService) hidden.add(key);
    }
  }
  return hidden;
}
