/**
 * tableSearch.ts — pure search helpers for PedidosTableModal and ServicesTableModal.
 *
 * Extracted as standalone module so they can be unit-tested without a React render.
 * Both functions match the user search string (already lowercased and trimmed)
 * against every visible text/number column in the respective table.
 */

import { PedidoSupabase, ServiceSupabase } from '@/types';
import { getEstadoDescripcion } from '@/utils/estadoPedido';

// ---------------------------------------------------------------------------
// PedidosTableModal — visible columns covered by search:
//   id, movil, zona_nro, cliente_tel, cliente_nombre, cliente_ciudad,
//   cliente_direccion, producto_nom, producto_cant, servicio_nombre,
//   imp_bruto, pedido_obs, cliente_obs, estado (label legible via getEstadoDescripcion).
// ---------------------------------------------------------------------------

/**
 * Returns true when the pedido matches the given search string.
 * @param p - PedidoSupabase row
 * @param search - lowercased, trimmed search string
 */
export function matchesSearchPedido(p: PedidoSupabase, search: string): boolean {
  if (!search) return true;

  const isPendiente = Number(p.estado_nro) === 1;
  const sinMovil = !p.movil || Number(p.movil) === 0;
  const estadoLabel = (isPendiente && sinMovil)
    ? 'sin asignar'
    : getEstadoDescripcion(p.sub_estado_nro, p.sub_estado_desc, p.estado_nro).toLowerCase();

  return (
    p.id.toString().includes(search) ||
    (p.movil?.toString().includes(search) ?? false) ||
    (p.zona_nro != null && p.zona_nro.toString().includes(search)) ||
    (p.cliente_tel?.includes(search) ?? false) ||
    (p.cliente_nombre?.toLowerCase().includes(search) ?? false) ||
    (p.cliente_ciudad?.toLowerCase().includes(search) ?? false) ||
    (p.cliente_direccion?.toLowerCase().includes(search) ?? false) ||
    (p.producto_nom?.toLowerCase().includes(search) ?? false) ||
    (p.producto_cant != null && p.producto_cant.toString().includes(search)) ||
    (p.servicio_nombre?.toLowerCase().includes(search) ?? false) ||
    (p.imp_bruto != null && p.imp_bruto.toString().includes(search)) ||
    (p.pedido_obs?.toLowerCase().includes(search) ?? false) ||
    (p.cliente_obs?.toLowerCase().includes(search) ?? false) ||
    estadoLabel.includes(search)
  );
}

// ---------------------------------------------------------------------------
// ServicesTableModal — visible columns covered by search:
//   id, movil, zona_nro, cliente_tel, cliente_nombre, cliente_ciudad,
//   cliente_direccion, defecto, servicio_nombre, pedido_obs, cliente_obs,
//   estado (label legible via getEstadoDescripcion — for consistency).
// ---------------------------------------------------------------------------

/**
 * Returns true when the service matches the given search string.
 * @param s - ServiceSupabase row
 * @param search - lowercased, trimmed search string
 */
export function matchesSearchService(s: ServiceSupabase, search: string): boolean {
  if (!search) return true;

  const estadoLabel = getEstadoDescripcion(s.sub_estado_nro, s.sub_estado_desc, s.estado_nro).toLowerCase();

  return (
    s.id.toString().includes(search) ||
    (s.movil?.toString().includes(search) ?? false) ||
    (s.zona_nro != null && s.zona_nro.toString().includes(search)) ||
    (s.cliente_tel?.includes(search) ?? false) ||
    (s.cliente_nombre?.toLowerCase().includes(search) ?? false) ||
    (s.cliente_ciudad?.toLowerCase().includes(search) ?? false) ||
    (s.cliente_direccion?.toLowerCase().includes(search) ?? false) ||
    (s.defecto?.toLowerCase().includes(search) ?? false) ||
    (s.servicio_nombre?.toLowerCase().includes(search) ?? false) ||
    (s.pedido_obs?.toLowerCase().includes(search) ?? false) ||
    (s.cliente_obs?.toLowerCase().includes(search) ?? false) ||
    estadoLabel.includes(search)
  );
}
