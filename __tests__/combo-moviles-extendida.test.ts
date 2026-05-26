/**
 * Tests para el refactor del combo de moviles del modal extendido
 * cuando se abre desde el colapsable.
 *
 * RunId: 20260526-100652-4qv
 *
 * Spec: combo debe incluir:
 *   - TODOS los moviles activos del colapsable (incluso sin pedidos del dia)
 *   - Moviles inactivos con AL MENOS 1 pedido que matchea la vista+subfiltros actuales
 *
 * Cubre:
 *   1. vista=pendientes + inactivos con estado_nro=1
 *   2. vista=finalizados + entrega=todos + inactivos con estado_nro=2
 *   3. vista=finalizados + entrega=entregado + inactivos con sub_estado_nro IN (3,19)
 *   4. vista=finalizados + entrega=no_entregado + inactivos NOT IN (3,19)
 *   5. Activo sin pedidos del dia aparece en combo (porque esta en el colapsable)
 *   6. Inactivo sin pedidos del tipo actual NO aparece
 *   7. Predicate cambia dinamicamente con la vista
 *   8. Espejo services (sub_estado_nro===3 para entregado, no 19)
 *   9. Regresion: getMovilesConFinalizadosEnFecha sigue funcionando
 */

import { describe, it, expect } from 'vitest';
import { getMovilesConPedidosMatching, getMovilesConFinalizadosEnFecha, isMovilActiveForUI } from '@/lib/moviles/visibility';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makePedido(overrides: {
  movil?: number;
  estado_nro?: number;
  sub_estado_nro?: number | null;
  empresa_fletera_id?: number | null;
}) {
  return {
    movil: overrides.movil ?? 1,
    estado_nro: overrides.estado_nro ?? 1,
    sub_estado_nro: overrides.sub_estado_nro ?? null,
    empresa_fletera_id: overrides.empresa_fletera_id ?? 100,
  };
}

// Predicate para pendientes (espeja la logica del dashboard)
const pendientesPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 1;

// Predicate para finalizados+todos (espeja la logica del dashboard)
const finalizadosTodosPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 2;

// Predicate para finalizados+entregado (pedidos: sub_estado_nro IN 3,19)
const finalizadosEntregadoPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 2 && item.sub_estado_nro != null && [3, 19].includes(Number(item.sub_estado_nro));

// Predicate para finalizados+no_entregado (pedidos: NOT IN 3,19)
const finalizadosNoEntregadoPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 2 && (item.sub_estado_nro == null || ![3, 19].includes(Number(item.sub_estado_nro)));

// Predicate para finalizados+entregado (services: sub_estado_nro === 3 solamente)
const servicesFinalizadosEntregadoPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 2 && item.sub_estado_nro != null && Number(item.sub_estado_nro) === 3;

// Predicate para finalizados+no_entregado (services: NOT 3)
const servicesFinalizadosNoEntregadoPredicate = (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) =>
  Number(item.estado_nro) === 2 && (item.sub_estado_nro == null || Number(item.sub_estado_nro) !== 3);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: vista=pendientes — inactivos con estado_nro=1
// ─────────────────────────────────────────────────────────────────────────────

describe('AC1 — vista=pendientes: inactivos con estado_nro=1', () => {
  it('incluye movil inactivo con pedido pendiente (estado_nro=1)', () => {
    const pedidos = [
      makePedido({ movil: 99, estado_nro: 1, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], pendientesPredicate);
    expect(result).toContain(99);
  });

  it('NO incluye movil inactivo con pedido finalizado (estado_nro=2) en vista=pendientes', () => {
    const pedidos = [
      makePedido({ movil: 88, estado_nro: 2, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], pendientesPredicate);
    expect(result).not.toContain(88);
  });

  it('incluye moviles de services con estado_nro=1 en vista=pendientes', () => {
    const services = [
      makePedido({ movil: 77, estado_nro: 1, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], [], services, pendientesPredicate);
    expect(result).toContain(77);
  });

  it('respeta empresa scope en vista=pendientes', () => {
    const pedidos = [
      makePedido({ movil: 50, estado_nro: 1, empresa_fletera_id: 3 }), // fuera de scope
    ];
    const result = getMovilesConPedidosMatching([1, 2], pedidos, [], pendientesPredicate);
    expect(result).not.toContain(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: vista=finalizados, entrega=todos — inactivos con estado_nro=2
// ─────────────────────────────────────────────────────────────────────────────

describe('AC2 — vista=finalizados+todos: inactivos con estado_nro=2', () => {
  it('incluye movil inactivo con pedido finalizado (estado_nro=2)', () => {
    const pedidos = [
      makePedido({ movil: 99, estado_nro: 2, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosTodosPredicate);
    expect(result).toContain(99);
  });

  it('NO incluye movil inactivo con pedido pendiente (estado_nro=1) en vista=finalizados', () => {
    const pedidos = [
      makePedido({ movil: 88, estado_nro: 1, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosTodosPredicate);
    expect(result).not.toContain(88);
  });

  it('incluye movil con sub_estado_nro=3 (entregado) en finalizados+todos', () => {
    const pedidos = [
      makePedido({ movil: 55, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosTodosPredicate);
    expect(result).toContain(55);
  });

  it('incluye movil con sub_estado_nro=7 (no entregado) en finalizados+todos', () => {
    const pedidos = [
      makePedido({ movil: 56, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosTodosPredicate);
    expect(result).toContain(56);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: vista=finalizados, entrega=entregado — sub_estado IN (3,19) para pedidos
// ─────────────────────────────────────────────────────────────────────────────

describe('AC3 — vista=finalizados+entregado: sub_estado_nro IN (3,19)', () => {
  it('incluye movil con sub_estado_nro=3 (ENTREGADO)', () => {
    const pedidos = [
      makePedido({ movil: 10, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).toContain(10);
  });

  it('incluye movil con sub_estado_nro=19 (ENTR. SIN 1710)', () => {
    const pedidos = [
      makePedido({ movil: 11, estado_nro: 2, sub_estado_nro: 19, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).toContain(11);
  });

  it('NO incluye movil con sub_estado_nro=7 (no entregado) en vista=entregado', () => {
    const pedidos = [
      makePedido({ movil: 12, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).not.toContain(12);
  });

  it('NO incluye movil con sub_estado_nro=null en vista=entregado', () => {
    const pedidos = [
      makePedido({ movil: 13, estado_nro: 2, sub_estado_nro: null, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).not.toContain(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: vista=finalizados, entrega=no_entregado
// ─────────────────────────────────────────────────────────────────────────────

describe('AC4 — vista=finalizados+no_entregado: sub_estado_nro NOT IN (3,19)', () => {
  it('incluye movil con sub_estado_nro=7 (no entregado)', () => {
    const pedidos = [
      makePedido({ movil: 20, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosNoEntregadoPredicate);
    expect(result).toContain(20);
  });

  it('incluye movil con sub_estado_nro=null (sin sub-estado) en no_entregado', () => {
    const pedidos = [
      makePedido({ movil: 21, estado_nro: 2, sub_estado_nro: null, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosNoEntregadoPredicate);
    expect(result).toContain(21);
  });

  it('NO incluye movil con sub_estado_nro=3 (entregado) en vista=no_entregado', () => {
    const pedidos = [
      makePedido({ movil: 22, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosNoEntregadoPredicate);
    expect(result).not.toContain(22);
  });

  it('NO incluye movil con sub_estado_nro=19 en vista=no_entregado', () => {
    const pedidos = [
      makePedido({ movil: 23, estado_nro: 2, sub_estado_nro: 19, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosNoEntregadoPredicate);
    expect(result).not.toContain(23);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Activo sin pedidos del dia aparece en combo (activeMovilesForCombo)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC5 — activo sin pedidos aparece en combo (desde moviles prop)', () => {
  it('isMovilActiveForUI retorna true para estadoNro 0,1,2,4 y null', () => {
    expect(isMovilActiveForUI(0)).toBe(true);
    expect(isMovilActiveForUI(1)).toBe(true);
    expect(isMovilActiveForUI(2)).toBe(true);
    expect(isMovilActiveForUI(4)).toBe(true);
    expect(isMovilActiveForUI(null)).toBe(true);
    expect(isMovilActiveForUI(undefined)).toBe(true);
  });

  it('isMovilActiveForUI retorna false para estados 3,5,15', () => {
    expect(isMovilActiveForUI(3)).toBe(false);
    expect(isMovilActiveForUI(5)).toBe(false);
    expect(isMovilActiveForUI(15)).toBe(false);
  });

  it('activeMovilesForCombo logica: moviles activos se incluyen aunque sin pedidos del dia', () => {
    // Esta logica esta en el componente PedidosTableModal (activeMovilesForCombo useMemo).
    // Se testea aqui la regla de negocio con la funcion helper isMovilActiveForUI.
    const moviles = [
      { id: 1, estadoNro: 1 },  // activo con pedidos
      { id: 2, estadoNro: 1 },  // activo SIN pedidos del dia
      { id: 3, estadoNro: 3 },  // inactivo
    ];
    const activeMovilesForCombo = moviles
      .filter(m => isMovilActiveForUI(m.estadoNro))
      .map(m => m.id);

    expect(activeMovilesForCombo).toContain(1);
    expect(activeMovilesForCombo).toContain(2); // activo sin pedidos igual aparece
    expect(activeMovilesForCombo).not.toContain(3); // inactivo no aparece en la parte activa
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Inactivo sin pedidos del tipo actual NO aparece
// ─────────────────────────────────────────────────────────────────────────────

describe('AC6 — inactivo sin pedidos relevantes NO aparece', () => {
  it('vista=pendientes: inactivo con solo pedidos finalizados NO aparece', () => {
    const pedidos = [
      makePedido({ movil: 99, estado_nro: 2, empresa_fletera_id: 1 }), // finalizado, no pendiente
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], pendientesPredicate);
    expect(result).not.toContain(99);
  });

  it('vista=finalizados+entregado: inactivo con solo pendientes NO aparece', () => {
    const pedidos = [
      makePedido({ movil: 88, estado_nro: 1, empresa_fletera_id: 1 }), // pendiente
    ];
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).not.toContain(88);
  });

  it('inactivo sin pedidos del dia NO aparece en ningun predicate', () => {
    const result1 = getMovilesConPedidosMatching([1], [], [], pendientesPredicate);
    const result2 = getMovilesConPedidosMatching([1], [], [], finalizadosTodosPredicate);
    expect(result1).toHaveLength(0);
    expect(result2).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Predicate cambia dinamicamente con la vista
// ─────────────────────────────────────────────────────────────────────────────

describe('AC7 — predicate dinamico por vista', () => {
  const pedidos = [
    makePedido({ movil: 10, estado_nro: 1, sub_estado_nro: null, empresa_fletera_id: 1 }), // pendiente
    makePedido({ movil: 11, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),    // finalizado entregado
    makePedido({ movil: 12, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),    // finalizado no entregado
  ];

  it('pendientes: solo movil 10', () => {
    const result = getMovilesConPedidosMatching([1], pedidos, [], pendientesPredicate);
    expect(result).toContain(10);
    expect(result).not.toContain(11);
    expect(result).not.toContain(12);
  });

  it('finalizados+todos: moviles 11 y 12', () => {
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosTodosPredicate);
    expect(result).not.toContain(10);
    expect(result).toContain(11);
    expect(result).toContain(12);
  });

  it('finalizados+entregado: solo movil 11', () => {
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosEntregadoPredicate);
    expect(result).not.toContain(10);
    expect(result).toContain(11);
    expect(result).not.toContain(12);
  });

  it('finalizados+no_entregado: solo movil 12', () => {
    const result = getMovilesConPedidosMatching([1], pedidos, [], finalizadosNoEntregadoPredicate);
    expect(result).not.toContain(10);
    expect(result).not.toContain(11);
    expect(result).toContain(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: Espejo services — sub_estado_nro === 3 para entregado (no 19)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC8 — espejo services: entregado = sub_estado_nro === 3 (no 19)', () => {
  it('services: sub_estado_nro=3 aparece en finalizados+entregado', () => {
    const services = [
      makePedido({ movil: 30, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], [], services, servicesFinalizadosEntregadoPredicate);
    expect(result).toContain(30);
  });

  it('services: sub_estado_nro=19 NO aparece en finalizados+entregado (solo es para pedidos)', () => {
    const services = [
      makePedido({ movil: 31, estado_nro: 2, sub_estado_nro: 19, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], [], services, servicesFinalizadosEntregadoPredicate);
    expect(result).not.toContain(31);
  });

  it('services: sub_estado_nro=7 aparece en finalizados+no_entregado', () => {
    const services = [
      makePedido({ movil: 32, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], [], services, servicesFinalizadosNoEntregadoPredicate);
    expect(result).toContain(32);
  });

  it('services: sub_estado_nro=3 NO aparece en finalizados+no_entregado', () => {
    const services = [
      makePedido({ movil: 33, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConPedidosMatching([1], [], services, servicesFinalizadosNoEntregadoPredicate);
    expect(result).not.toContain(33);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: Regresion — getMovilesConFinalizadosEnFecha sigue funcionando
// ─────────────────────────────────────────────────────────────────────────────

describe('AC9 — regresion: getMovilesConFinalizadosEnFecha', () => {
  it('devuelve IDs de moviles con estado_nro=2 en empresas indicadas', () => {
    const pedidos = [
      makePedido({ movil: 10, estado_nro: 2, empresa_fletera_id: 1 }),
      makePedido({ movil: 11, estado_nro: 1, empresa_fletera_id: 1 }), // pendiente
    ];
    const result = getMovilesConFinalizadosEnFecha([1], pedidos);
    expect(result).toContain(10);
    expect(result).not.toContain(11);
  });

  it('incluye moviles de services con estado_nro=2', () => {
    const services = [
      makePedido({ movil: 50, estado_nro: 2, empresa_fletera_id: 1 }),
    ];
    const result = getMovilesConFinalizadosEnFecha([1], [], services);
    expect(result).toContain(50);
  });

  it('scope permisivo cuando empresaIds esta vacio', () => {
    const pedidos = [
      makePedido({ movil: 20, estado_nro: 2, empresa_fletera_id: 5 }),
    ];
    const result = getMovilesConFinalizadosEnFecha([], pedidos);
    expect(result).toContain(20);
  });

  it('no incluye movil de empresa fuera del scope', () => {
    const pedidos = [
      makePedido({ movil: 99, estado_nro: 2, empresa_fletera_id: 99 }),
    ];
    const result = getMovilesConFinalizadosEnFecha([1, 2], pedidos);
    expect(result).not.toContain(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test combinado: inactiveMovilesAvailable logica completa
// ─────────────────────────────────────────────────────────────────────────────

describe('inactiveMovilesAvailable logica completa', () => {
  const moviles = [
    { id: 1, estadoNro: 1 }, // activo
    { id: 2, estadoNro: 1 }, // activo
    { id: 10, estadoNro: 3 }, // inactivo con pendiente
    { id: 11, estadoNro: 3 }, // inactivo con finalizado entregado
    { id: 12, estadoNro: 3 }, // inactivo con finalizado no entregado
    { id: 13, estadoNro: 3 }, // inactivo sin pedidos del dia
  ];

  const pedidos = [
    makePedido({ movil: 1, estado_nro: 1, empresa_fletera_id: 1 }),
    makePedido({ movil: 10, estado_nro: 1, empresa_fletera_id: 1 }),
    makePedido({ movil: 11, estado_nro: 2, sub_estado_nro: 3, empresa_fletera_id: 1 }),
    makePedido({ movil: 12, estado_nro: 2, sub_estado_nro: 7, empresa_fletera_id: 1 }),
  ];

  function buildInactiveMovilesAvailable(predicate: (item: { estado_nro?: number | string | null; sub_estado_nro?: number | null }) => boolean) {
    const inactiveIds = new Set(
      getMovilesConPedidosMatching([1], pedidos, [], predicate)
    );
    return moviles
      .filter(m => !isMovilActiveForUI(m.estadoNro) && inactiveIds.has(m.id))
      .map(m => m.id);
  }

  it('vista=pendientes: solo movil 10 en inactivos', () => {
    const result = buildInactiveMovilesAvailable(pendientesPredicate);
    expect(result).toContain(10);
    expect(result).not.toContain(11);
    expect(result).not.toContain(12);
    expect(result).not.toContain(13);
  });

  it('vista=finalizados+todos: moviles 11 y 12 en inactivos', () => {
    const result = buildInactiveMovilesAvailable(finalizadosTodosPredicate);
    expect(result).not.toContain(10);
    expect(result).toContain(11);
    expect(result).toContain(12);
    expect(result).not.toContain(13);
  });

  it('vista=finalizados+entregado: solo movil 11', () => {
    const result = buildInactiveMovilesAvailable(finalizadosEntregadoPredicate);
    expect(result).not.toContain(10);
    expect(result).toContain(11);
    expect(result).not.toContain(12);
    expect(result).not.toContain(13);
  });

  it('vista=finalizados+no_entregado: solo movil 12', () => {
    const result = buildInactiveMovilesAvailable(finalizadosNoEntregadoPredicate);
    expect(result).not.toContain(10);
    expect(result).not.toContain(11);
    expect(result).toContain(12);
    expect(result).not.toContain(13);
  });

  it('activos 1 y 2 NO aparecen en inactivos (son activos)', () => {
    const result = buildInactiveMovilesAvailable(pendientesPredicate);
    expect(result).not.toContain(1);
    expect(result).not.toContain(2);
  });
});
