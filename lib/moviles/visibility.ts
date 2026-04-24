/**
 * Helpers para decidir qué móviles son visibles en la UI.
 *
 * Reglas del negocio:
 *  - Un móvil es "activo para UI" cuando su estadoNro es null/undefined o
 *    está en [0, 1, 2, 4]. El estado 4 (BAJA MOMENTÁNEA) cuenta como activo
 *    pero se renderiza con un estilo visual distinto (violeta / ícono de
 *    pausa) — esa distinción la manejan los componentes individualmente.
 *    Los estados 3, 5, 15, … cuentan como no-activos.
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
  return estadoNro === 0 || estadoNro === 1 || estadoNro === 2 || estadoNro === 4;
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
 * Devuelve el set de IDs (numéricos) de los móviles ocultos-pero-operativos.
 *
 * Incluye dos grupos:
 *  1. Móviles presentes en `moviles` cuyo estadoNro es no-activo pero tienen
 *     al menos un pedido/service asignado.
 *  2. Móviles *referenciados* por pedidos/services pero ausentes de `moviles`
 *     (p. ej. no logueados a GPS, dados de baja en la tabla de móviles pero
 *     con pedidos pendientes en backend). Sin esto, sus pedidos quedarían
 *     descartados en las vistas que cruzan contra `moviles + hiddenMovilIds`.
 */
export function getHiddenMovilIds(
  moviles: MovilLike[],
  pedidos: Array<WithMovilRef>,
  services?: Array<WithMovilRef>,
): Set<number> {
  const hidden = new Set<number>();
  const known = new Set<number>();
  for (const m of moviles) {
    known.add(m.id);
    if (isMovilActiveForUI(m.estadoNro)) continue;
    if (isMovilHidden(m, pedidos, services)) hidden.add(m.id);
  }
  const addOrphan = (raw: number | string | null | undefined) => {
    if (raw == null) return;
    const id = Number(raw);
    if (!Number.isFinite(id) || id === 0) return;
    if (known.has(id)) return;
    hidden.add(id);
  };
  for (const p of pedidos) addOrphan(p.movil);
  if (services) for (const s of services) addOrphan(s.movil);
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
  if (!estadosMap || estadosMap.size === 0) {
    // Aun sin estados conocidos, los móviles referenciados por pedidos/services
    // se tratan como operativos (ver getHiddenMovilIds).
    const addOrphan = (raw: number | string | null | undefined) => {
      if (raw == null) return;
      const key = String(raw);
      if (key === '' || key === '0') return;
      hidden.add(key);
    };
    for (const p of pedidos) addOrphan(p.movil);
    if (services) for (const s of services) addOrphan(s.movil);
    return hidden;
  }
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
  // Móviles referenciados por pedidos/services pero ausentes del Map de estados
  // (no registrados en backend, sin GPS logueado, etc.).
  const addOrphan = (raw: number | string | null | undefined) => {
    if (raw == null) return;
    const key = String(raw);
    if (key === '' || key === '0') return;
    if (estadosMap.has(key)) return;
    hidden.add(key);
  };
  for (const p of pedidos) addOrphan(p.movil);
  if (services) for (const s of services) addOrphan(s.movil);
  return hidden;
}
