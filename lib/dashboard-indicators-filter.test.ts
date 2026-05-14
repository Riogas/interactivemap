/**
 * Tests unitarios para lib/dashboard-indicators-filter.ts
 *
 * Cubre la lógica pura de filtrado de pedidos para DashboardIndicators:
 * - filterFinalizadosByMovil: filtro estricto por móvil (sin escape hatches)
 * - filterPedidosByEmpresa: filtro por empresa fletera
 */

import { describe, it, expect } from 'vitest';
import { filterFinalizadosByMovil, filterPedidosByEmpresa } from './dashboard-indicators-filter';
import type { PedidoSupabase } from '@/types';

// ---------------------------------------------------------------------------
// Helper para construir pedidos mínimos de prueba
// PedidoSupabase es Database['public']['Tables']['pedidos']['Row']:
//   id: number, movil: number|null, empresa_fletera_id: number|null, etc.
// ---------------------------------------------------------------------------
function makePedido(id: number, overrides: Partial<PedidoSupabase> = {}): PedidoSupabase {
  const base: PedidoSupabase = {
    id,
    escenario: 1,
    estado_nro: 2,
    sub_estado_nro: null,
    sub_estado_desc: null,
    movil: null,
    empresa_fletera_id: null,
    empresa_fletera_nom: null,
    pedido_hijo: null,
    fch_hora_para: null,
    fch_hora_mov: null,
    fch_hora_finalizacion: null,
    fch_hora_max_ent_comp: null,
    fch_hora_upd_firestore: null,
    fch_para: null,
    zona_nro: null,
    ubicacion: null,
    latitud: null,
    longitud: null,
    cliente_ciudad: null,
    cliente_direccion: null,
    cliente_direccion_esq1: null,
    cliente_direccion_obs: null,
    cliente_nombre: null,
    cliente_nro: null,
    cliente_obs: null,
    cliente_tel: null,
    demora_informada: null,
    detalle_html: null,
    fpago_obs1: null,
    google_maps_url: null,
    imp_bruto: null,
    imp_flete: null,
    orden_cancelacion: null,
    otros_productos: null,
    pedido_obs: null,
    precio: null,
    prioridad: null,
    prodsadicionales: null,
    campana: null,
    obsfletero: null,
    fletero: null,
    producto_cant: null,
    producto_cod: null,
    producto_nom: null,
    servicio_nombre: null,
    tipo: null,
    visible_en_app: null,
    waze_url: null,
    created_at: null,
    updated_at: null,
    atraso_cump_mins: null,
    demora_movil_desde_asignacion_mins: null,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// filterFinalizadosByMovil
// ---------------------------------------------------------------------------
describe('filterFinalizadosByMovil', () => {
  it('sin selectedMoviles → devuelve todos (sin filtro)', () => {
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: null }),
      makePedido(3, { movil: 0 }),
    ];
    expect(filterFinalizadosByMovil(pedidos, [])).toHaveLength(3);
  });

  it('con selectedMoviles=[10] → solo pasan pedidos con movil=10', () => {
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: 20 }),
    ];
    const result = filterFinalizadosByMovil(pedidos, [10]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('huérfanos (movil=null) NO pasan cuando hay selección de móvil', () => {
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: null }),
    ];
    const result = filterFinalizadosByMovil(pedidos, [10]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('pedidos con movil=0 (huérfanos numéricos) NO pasan cuando hay selección', () => {
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: 0 }),
    ];
    const result = filterFinalizadosByMovil(pedidos, [10]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('pedidos de móviles ocultos-pero-operativos NO pasan (filtro estricto)', () => {
    // Móvil 99 es "oculto" pero en el nuevo filtro eso no importa — solo cuenta si está en selectedMoviles
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: 99 }),
    ];
    const result = filterFinalizadosByMovil(pedidos, [10]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('múltiples móviles seleccionados → pasan pedidos de cualquiera de ellos', () => {
    const pedidos = [
      makePedido(1, { movil: 10 }),
      makePedido(2, { movil: 20 }),
      makePedido(3, { movil: 30 }),
    ];
    const result = filterFinalizadosByMovil(pedidos, [10, 20]);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id)).toContain(1);
    expect(result.map(p => p.id)).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// filterPedidosByEmpresa
// ---------------------------------------------------------------------------
describe('filterPedidosByEmpresa', () => {
  it('sin selectedEmpresas → devuelve todos (sin filtro)', () => {
    const pedidos = [
      makePedido(1, { empresa_fletera_id: 5 }),
      makePedido(2, { empresa_fletera_id: null }),
    ];
    expect(filterPedidosByEmpresa(pedidos, [])).toHaveLength(2);
  });

  it('con selectedEmpresas=[5] → solo pasan pedidos con empresa_fletera_id=5', () => {
    const pedidos = [
      makePedido(1, { empresa_fletera_id: 5 }),
      makePedido(2, { empresa_fletera_id: 7 }),
    ];
    const result = filterPedidosByEmpresa(pedidos, [5]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('pedidos con empresa_fletera_id=null NO pasan cuando hay selección activa', () => {
    const pedidos = [
      makePedido(1, { empresa_fletera_id: 5 }),
      makePedido(2, { empresa_fletera_id: null }),
    ];
    const result = filterPedidosByEmpresa(pedidos, [5]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('múltiples empresas seleccionadas → pasan pedidos de cualquiera', () => {
    const pedidos = [
      makePedido(1, { empresa_fletera_id: 5 }),
      makePedido(2, { empresa_fletera_id: 7 }),
      makePedido(3, { empresa_fletera_id: 9 }),
    ];
    const result = filterPedidosByEmpresa(pedidos, [5, 7]);
    expect(result).toHaveLength(2);
  });

  it('caso combinado: filtrar por movil y por empresa da intersección correcta', () => {
    // Simulamos lo que hace el componente: primero filtra por móvil, luego por empresa
    const pedidos = [
      makePedido(1, { movil: 10, empresa_fletera_id: 5 }),
      makePedido(2, { movil: 10, empresa_fletera_id: 7 }),
      makePedido(3, { movil: 20, empresa_fletera_id: 5 }),
    ];
    const afterMovil = filterFinalizadosByMovil(pedidos, [10]);
    const afterEmpresa = filterPedidosByEmpresa(afterMovil, [5]);
    expect(afterEmpresa).toHaveLength(1);
    expect(afterEmpresa[0].id).toBe(1);
  });
});
