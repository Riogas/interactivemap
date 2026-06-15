/**
 * Tests unitarios para utils/estadoPedido.ts
 *
 * Cubre las funciones de clasificacion y filtrado de estados de pedidos:
 *   - isPedidoExcluido: detecta REG. HISTORICO (estado_nro=2, sub_estado_nro=17)
 *   - filterPedidosVisibles: filtra arrays descartando pedidos excluidos
 *   - isPedidoEntregado: no debe ser afectado por los cambios de exclusion
 *
 * Criterios de aceptacion del request:
 *   AC3 - isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 17 }) -> true
 *   AC3 - isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 3 }) -> false
 *   AC3 - isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 19 }) -> false
 *   AC3 - isPedidoExcluido({ estado_nro: 1, sub_estado_nro: 17 }) -> false
 *   AC3 - filterPedidosVisibles filtra solo los excluidos
 *   AC6 - isPedidoEntregado sigue contando sub_estado_nro=3 y 19 (no regresion)
 */

import { describe, it, expect } from 'vitest';
import {
  isPedidoExcluido,
  filterPedidosVisibles,
  isPedidoEntregado,
  isServiceEntregado,
} from '@/utils/estadoPedido';

// ---------------------------------------------------------------------------
// isPedidoExcluido
// ---------------------------------------------------------------------------

describe('isPedidoExcluido', () => {
  it('devuelve true para estado_nro=2 y sub_estado_nro=17 (REG. HISTORICO)', () => {
    expect(isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 17 })).toBe(true);
  });

  it('devuelve true cuando los valores son string numericos', () => {
    expect(isPedidoExcluido({ estado_nro: '2', sub_estado_nro: '17' })).toBe(true);
  });

  it('devuelve false para estado_nro=2 y sub_estado_nro=3 (ENTREGADO)', () => {
    expect(isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 3 })).toBe(false);
  });

  it('devuelve false para estado_nro=2 y sub_estado_nro=19 (ENTR. SIN 1710)', () => {
    expect(isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 19 })).toBe(false);
  });

  it('devuelve false para estado_nro=1 y sub_estado_nro=17 (estado principal diferente)', () => {
    expect(isPedidoExcluido({ estado_nro: 1, sub_estado_nro: 17 })).toBe(false);
  });

  it('devuelve false para estado_nro=2 y sub_estado_nro=1', () => {
    expect(isPedidoExcluido({ estado_nro: 2, sub_estado_nro: 1 })).toBe(false);
  });

  it('devuelve false cuando estado_nro es null', () => {
    expect(isPedidoExcluido({ estado_nro: null, sub_estado_nro: 17 })).toBe(false);
  });

  it('devuelve false cuando sub_estado_nro es null', () => {
    expect(isPedidoExcluido({ estado_nro: 2, sub_estado_nro: null })).toBe(false);
  });

  it('devuelve false cuando ambos son undefined', () => {
    expect(isPedidoExcluido({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterPedidosVisibles
// ---------------------------------------------------------------------------

describe('filterPedidosVisibles', () => {
  const p1 = { id: 1, estado_nro: 1, sub_estado_nro: 5 };   // pendiente activo
  const p2 = { id: 2, estado_nro: 2, sub_estado_nro: 17 };  // REG. HISTORICO - excluido
  const p3 = { id: 3, estado_nro: 2, sub_estado_nro: 3 };   // ENTREGADO - visible
  const p4 = { id: 4, estado_nro: 2, sub_estado_nro: 19 };  // ENTR. SIN 1710 - visible
  const p5 = { id: 5, estado_nro: 2, sub_estado_nro: 17 };  // REG. HISTORICO - excluido

  it('filtra pedidos con sub_estado_nro=17 y estado_nro=2', () => {
    const result = filterPedidosVisibles([p1, p2, p3]);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id)).toEqual([1, 3]);
  });

  it('filtra multiples pedidos historicos del array', () => {
    const result = filterPedidosVisibles([p1, p2, p3, p4, p5]);
    expect(result).toHaveLength(3);
    expect(result.map(p => p.id)).toEqual([1, 3, 4]);
  });

  it('devuelve array vacio si todos son excluidos', () => {
    const result = filterPedidosVisibles([p2, p5]);
    expect(result).toHaveLength(0);
  });

  it('devuelve el array completo si ninguno es excluido', () => {
    const result = filterPedidosVisibles([p1, p3, p4]);
    expect(result).toHaveLength(3);
  });

  it('maneja array vacio sin error', () => {
    const result = filterPedidosVisibles([]);
    expect(result).toHaveLength(0);
  });

  it('preserva el tipo original del array (generics)', () => {
    type ExtendedPedido = { id: number; estado_nro: number; sub_estado_nro: number; extra: string };
    const arr: ExtendedPedido[] = [
      { id: 10, estado_nro: 2, sub_estado_nro: 17, extra: 'historico' },
      { id: 11, estado_nro: 2, sub_estado_nro: 3, extra: 'entregado' },
    ];
    const result = filterPedidosVisibles(arr);
    expect(result).toHaveLength(1);
    expect(result[0].extra).toBe('entregado');
  });
});

// ---------------------------------------------------------------------------
// No regresion: isPedidoEntregado no se ve afectado
// ---------------------------------------------------------------------------

describe('isPedidoEntregado (no regresion)', () => {
  it('sigue devolviendo true para sub_estado_nro=3', () => {
    expect(isPedidoEntregado({ estado_nro: 2, sub_estado_nro: 3 })).toBe(true);
  });

  it('sigue devolviendo true para sub_estado_nro=19', () => {
    expect(isPedidoEntregado({ estado_nro: 2, sub_estado_nro: 19 })).toBe(true);
  });

  it('devuelve false para sub_estado_nro=17', () => {
    expect(isPedidoEntregado({ estado_nro: 2, sub_estado_nro: 17 })).toBe(false);
  });

  it('devuelve false para estado_nro=1', () => {
    expect(isPedidoEntregado({ estado_nro: 1, sub_estado_nro: 3 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No regresion: isServiceEntregado no se ve afectado
// ---------------------------------------------------------------------------

describe('isServiceEntregado (mismo criterio que pedidos)', () => {
  it('devuelve true para sub_estado_nro=3 (ENTREGADO)', () => {
    expect(isServiceEntregado({ estado_nro: 2, sub_estado_nro: 3 })).toBe(true);
  });

  it('devuelve true para sub_estado_nro=19 (ENTR. SIN 1710, igual que pedidos)', () => {
    expect(isServiceEntregado({ estado_nro: 2, sub_estado_nro: 19 })).toBe(true);
  });

  it('devuelve false para sub_estado_nro=17', () => {
    expect(isServiceEntregado({ estado_nro: 2, sub_estado_nro: 17 })).toBe(false);
  });

  it('devuelve false para estado_nro=1', () => {
    expect(isServiceEntregado({ estado_nro: 1, sub_estado_nro: 3 })).toBe(false);
  });
});
