/**
 * Funciones puras de filtrado para DashboardIndicators.
 * Extraídas para permitir tests unitarios sin depender de React.
 */

import { PedidoSupabase } from '@/types';

/**
 * Filtra pedidos finalizados según los móviles seleccionados.
 *
 * Semántica ESTRICTA (opción b elegida por el usuario):
 * - Si selectedMoviles está vacío → sin filtro por móvil.
 * - Si hay móviles seleccionados → solo pasan pedidos cuyo `movil` está en selectedMoviles.
 *   Pedidos huérfanos (sin móvil o movil===0) y pedidos de móviles ocultos-pero-operativos
 *   NO pasan — el indicador refleja exactamente lo que el usuario filtró.
 *
 * Nota: `movil` en PedidoSupabase es `number | null`. Se convierte a Number() para
 * tolerar futuros cambios de tipo sin romper el filtro.
 */
export function filterFinalizadosByMovil(
  finalizados: PedidoSupabase[],
  selectedMoviles: number[]
): PedidoSupabase[] {
  if (selectedMoviles.length === 0) return finalizados;

  // Filtro estricto: SOLO los pedidos asignados a los móviles seleccionados.
  // Pedidos sin móvil (huérfanos) y de móviles ocultos-pero-operativos NO pasan.
  return finalizados.filter(
    p =>
      p.movil != null &&
      Number(p.movil) !== 0 &&
      selectedMoviles.some(id => Number(id) === Number(p.movil))
  );
}

/**
 * Filtra pedidos por empresa fletera.
 *
 * Si selectedEmpresas está vacío → sin filtro por empresa.
 * Si hay empresas seleccionadas:
 *   - Pedidos con `empresa_fletera_id` ∈ selectedEmpresas → pasan.
 *   - Pedidos sin empresa "real" (null, undefined o 0) → PASAN. Son los
 *     sin-asignar todavía no vinculados a una empresa específica, no deben
 *     quedar "huérfanos" del indicador cuando el usuario tiene "Empresas: Todas".
 *     Se trata `0` como ausencia porque algunos imports del SecuritySuite
 *     mandan 0 en lugar de null para indicar "sin empresa fletera".
 *
 * Para finalizados los huérfanos sin empresa_fletera_id son raros y los maneja
 * `isPedidoInScope` upstream, así que este pass-through no introduce
 * ruido adicional.
 */
export function filterPedidosByEmpresa(
  pedidos: PedidoSupabase[],
  selectedEmpresas: number[]
): PedidoSupabase[] {
  if (selectedEmpresas.length === 0) return pedidos;

  return pedidos.filter(p => {
    const efid = p.empresa_fletera_id;
    if (efid == null || Number(efid) === 0) return true;
    return selectedEmpresas.includes(Number(efid));
  });
}
