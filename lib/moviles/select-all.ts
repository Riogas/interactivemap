/**
 * Lógica pura del botón "Seleccionar todos" del colapsable de móviles.
 * Extraída de handleSelectAll (app/dashboard/page.tsx) para poder testearla.
 */

interface MovilSelectAllLike {
  id: number;
  activo?: boolean;
  inactivoDelDia?: boolean;
}

/**
 * IDs que debe dejar seleccionados "Seleccionar todos".
 *
 * USE_NEW (moviles_dia): universo visible del colapsable = activos + inactivos
 * del día. NO se excluye hiddenMovilIds: en moviles_dia un inactivo del día
 * con operativa queda también con oculto_operativo=true (los flags se solapan
 * por definición de la vista), así que excluir hidden sacaba exactamente los
 * inactivos del día y el botón nunca reconstruía la selección inicial
 * (bug reportado 2026-08-12). La auto-selección inicial §4.1 tampoco excluye
 * hidden — ambos caminos deben devolver el mismo universo.
 *
 * Camino viejo (flag OFF): todos los móviles del universo menos los
 * ocultos-pero-operativos, igual que siempre.
 */
export function computeSelectAllIds(
  moviles: MovilSelectAllLike[],
  hiddenMovilIds: Set<number>,
  useMovilesDia: boolean,
): number[] {
  if (useMovilesDia) {
    return moviles
      .filter(m => m.activo === true || m.inactivoDelDia === true)
      .map(m => m.id);
  }
  return moviles.filter(m => !hiddenMovilIds.has(m.id)).map(m => m.id);
}
