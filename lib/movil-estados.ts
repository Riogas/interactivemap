/**
 * Estados de móvil considerados INACTIVOS (tachados visualmente, excluidos
 * del cálculo de capacidad, etc.). estado_nro = 3, 5, 15.
 *
 * Mantener sincronizado con la regla visual del modal "Móviles por Zona"
 * (ZonaMovilesViewModal usa esto para tachar el nombre).
 *
 * Fuente única de verdad para lógica de inactividad de móvil en TypeScript.
 */
export const MOVIL_ESTADOS_INACTIVOS = new Set<number>([3, 5, 15]);
export const MOVIL_ESTADOS_INACTIVOS_ARRAY: number[] = [3, 5, 15];

/**
 * Devuelve true si el móvil con el estado_nro dado debe considerarse inactivo.
 * null/undefined → false (asumir activo si no hay dato).
 */
export function esMovilInactivo(estado_nro: number | null | undefined): boolean {
  return estado_nro != null && MOVIL_ESTADOS_INACTIVOS.has(estado_nro);
}
