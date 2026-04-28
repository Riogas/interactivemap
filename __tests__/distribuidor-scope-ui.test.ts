/**
 * Tests de cobertura para los AC de scope de distribuidor en la UI.
 *
 * No podemos instanciar componentes React sin infraestructura de jsdom/renderizado,
 * pero sí podemos testear las funciones puras y la lógica de cómputo que los
 * componentes ejecutan internamente.
 *
 * Cobertura:
 *  - AC1: sinAsignar siempre 0 para distribuidor (isPedidoInScope devuelve false sin movil)
 *  - AC2: PedidosTableModal/ServicesTableModal — isPedidoInScope / isServiceInScope nunca
 *         devuelve true para un item sin movil bajo scope restringido.
 *  - AC3: Lógica de normalización del filtro persistido sin_asignar→pendientes.
 *         Replicamos el bloque del useEffect de page.tsx como función pura.
 *  - AC4: Cómputo de pendientes con hideSinAsignar — excluye los sin-movil.
 *  - AC5: Helper isPedidoInScope / isServiceInScope — sin movil = false sin importar opts/zona.
 *  - Edge case: distribuidor con scopedZonaIds vacío → todo en 0 sin error.
 */

import { describe, it, expect } from 'vitest';
import {
  isPedidoInScope,
  isServiceInScope,
  type ScopeFilter,
  type ScopeFilterOpts,
} from '../lib/scope-filter';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const normalScope: ScopeFilter = {
  scopedZonaIds: new Set<number>([10, 20]),
  allowedMovilIds: new Set<number>([100, 200]),
  isRestricted: true,
};

const emptyScope: ScopeFilter = {
  scopedZonaIds: new Set<number>(),
  allowedMovilIds: new Set<number>(),
  isRestricted: true,
};

const rootScope: ScopeFilter = {
  scopedZonaIds: null,
  allowedMovilIds: new Set(),
  isRestricted: false,
};

const optsHide: ScopeFilterOpts = { hideEntregadosSinMovil: true };
const optsKeep: ScopeFilterOpts = { hideEntregadosSinMovil: false };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers que replican la lógica de cómputo de los componentes (pure functions)
// ─────────────────────────────────────────────────────────────────────────────

/** Replica el cómputo de sinAsignar de DashboardIndicators */
function computeSinAsignar(
  pedidos: Array<{ movil?: number | null; zona_nro?: number | null; estado_nro?: number | null }>,
  scope: ScopeFilter
): number {
  let sinAsignar = pedidos.filter(
    (p) => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0)
  );
  if (scope.isRestricted) {
    sinAsignar = sinAsignar.filter((p) =>
      isPedidoInScope(p, scope, { hideEntregadosSinMovil: false })
    );
  }
  return sinAsignar.length;
}

/** Replica el cómputo de pendientes con hideSinAsignar de ZonaEstadisticasModal */
function computePendientesConHide(
  pedidosZona: Array<{ movil?: number | null; estado_nro?: number | null }>,
  hideSinAsignar: boolean
): number {
  return pedidosZona.filter((p) => {
    if (Number(p.estado_nro) !== 1) return false;
    if (hideSinAsignar && (!p.movil || Number(p.movil) === 0)) return false;
    return true;
  }).length;
}

/** Replica la normalización del filtro sin_asignar→pendientes de page.tsx useEffect */
function normalizePedidosZonaFilter(
  isScopeRestricted: boolean,
  currentFilter: 'pendientes' | 'sin_asignar' | 'atrasados'
): 'pendientes' | 'sin_asignar' | 'atrasados' {
  if (isScopeRestricted && currentFilter === 'sin_asignar') {
    return 'pendientes';
  }
  return currentFilter;
}

/** Replica el filtrado de pedidosZonaData de page.tsx */
function computePedidosZonaData(
  pedidos: Array<{ movil?: number | null; zona_nro?: number | null; estado_nro?: number | null; fch_hora_max_ent_comp?: string | null }>,
  filter: 'pendientes' | 'sin_asignar' | 'atrasados',
  scopedZonaIds: Set<number> | null,
  isScopeRestricted: boolean
): Map<number, number> {
  const map = new Map<number, number>();
  pedidos.forEach((p) => {
    const estado = Number(p.estado_nro);
    const tieneMovil = p.movil != null && Number(p.movil) !== 0;
    // Distribuidor: nunca contar pedidos sin móvil
    if (isScopeRestricted && !tieneMovil) return;
    if (filter === 'pendientes' && estado !== 1) return;
    if (filter === 'sin_asignar' && !(estado === 1 && !tieneMovil)) return;
    if (filter === 'atrasados') {
      if (estado !== 1) return;
      // simplificado: si no tiene fch_hora_max, no es atrasado
      if (!p.fch_hora_max_ent_comp) return;
    }
    const zona = p.zona_nro != null ? Number(p.zona_nro) : null;
    if (!zona || zona === 0) return;
    if (scopedZonaIds && !scopedZonaIds.has(zona)) return;
    map.set(zona, (map.get(zona) ?? 0) + 1);
  });
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1: chip "Sin Asignar" — conteo siempre 0 para distribuidor
// ─────────────────────────────────────────────────────────────────────────────
describe('AC1 - DashboardIndicators: sinAsignar siempre 0 para distribuidor', () => {
  it('distribuidor: pedidos sin movil con zona en scope NO se cuentan', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },
      { movil: null, zona_nro: 20, estado_nro: 1 },
    ];
    expect(computeSinAsignar(pedidos, normalScope)).toBe(0);
  });

  it('distribuidor: sinAsignar=0 aunque haya muchos pedidos sin movil', () => {
    const pedidos = Array.from({ length: 10 }, (_, i) => ({
      movil: 0,
      zona_nro: (i % 2 === 0) ? 10 : 20,
      estado_nro: 1,
    }));
    expect(computeSinAsignar(pedidos, normalScope)).toBe(0);
  });

  it('root/despacho: sinAsignar cuenta normalmente los pendientes sin movil', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },
      { movil: null, zona_nro: 5, estado_nro: 1 },
      { movil: 100, zona_nro: 10, estado_nro: 1 }, // este NO es sin asignar
    ];
    expect(computeSinAsignar(pedidos, rootScope)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: PedidosTableModal / ServicesTableModal — sin movil NUNCA pasa
// ─────────────────────────────────────────────────────────────────────────────
describe('AC2 - Vista extendida: distribuidor nunca ve items sin movil', () => {
  it('pedido pendiente sin movil (movil=0) → rechazado bajo scope restringido', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('pedido pendiente sin movil (movil=null) → rechazado bajo scope restringido', () => {
    expect(isPedidoInScope({ movil: null, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('pedido finalizado sin movil → rechazado bajo scope restringido (hideEntregadosSinMovil=false)', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 2 }, normalScope, optsKeep)).toBe(false);
  });

  it('pedido finalizado sin movil → rechazado bajo scope restringido (hideEntregadosSinMovil=true)', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 2 }, normalScope, optsHide)).toBe(false);
  });

  it('service sin movil → rechazado bajo scope restringido', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('service finalizado sin movil → rechazado bajo scope restringido', () => {
    expect(isServiceInScope({ movil: null, zona_nro: 20, estado_nro: 2 }, normalScope, optsKeep)).toBe(false);
  });

  it('pedido con movil válido en scope → pasa (no debe quedar oculto incorrectamente)', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: Filtro persistido normalizado — sin_asignar → pendientes para distribuidor
// ─────────────────────────────────────────────────────────────────────────────
describe('AC3 - Normalización de filtro persistido para distribuidor', () => {
  it('distribuidor + filtro=sin_asignar → normaliza a pendientes', () => {
    expect(normalizePedidosZonaFilter(true, 'sin_asignar')).toBe('pendientes');
  });

  it('distribuidor + filtro=pendientes → no cambia', () => {
    expect(normalizePedidosZonaFilter(true, 'pendientes')).toBe('pendientes');
  });

  it('distribuidor + filtro=atrasados → no cambia', () => {
    expect(normalizePedidosZonaFilter(true, 'atrasados')).toBe('atrasados');
  });

  it('root/despacho + filtro=sin_asignar → no cambia (root puede ver sin asignar)', () => {
    expect(normalizePedidosZonaFilter(false, 'sin_asignar')).toBe('sin_asignar');
  });

  it('distribuidor: pedidosZonaData con filter=sin_asignar devuelve mapa vacío (sin movil excluido antes)', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },
      { movil: null, zona_nro: 20, estado_nro: 1 },
    ];
    const result = computePedidosZonaData(pedidos, 'sin_asignar', new Set([10, 20]), true);
    // Todos los sin-movil son filtrados antes de chequear el filtro sin_asignar
    expect(result.size).toBe(0);
  });

  it('distribuidor: pedidosZonaData con filter=pendientes cuenta solo pedidos con movil', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },   // sin movil → excluido
      { movil: 100, zona_nro: 10, estado_nro: 1 },  // con movil → incluido
      { movil: 200, zona_nro: 20, estado_nro: 1 },  // con movil → incluido
    ];
    const result = computePedidosZonaData(pedidos, 'pendientes', new Set([10, 20]), true);
    expect(result.get(10)).toBe(1);
    expect(result.get(20)).toBe(1);
  });

  it('root/despacho: pedidosZonaData con filter=sin_asignar cuenta pedidos sin movil', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },
      { movil: null, zona_nro: 10, estado_nro: 1 },
      { movil: 100, zona_nro: 10, estado_nro: 1 }, // con movil, NO cuenta en sin_asignar
    ];
    const result = computePedidosZonaData(pedidos, 'sin_asignar', null, false);
    expect(result.get(10)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: ZonaEstadisticasModal — pendientes sin-movil excluidos, columna oculta
// ─────────────────────────────────────────────────────────────────────────────
describe('AC4 - ZonaEstadisticasModal: pendientes con hideSinAsignar', () => {
  it('hideSinAsignar=true: pedidos sin movil NO cuentan como pendientes', () => {
    const pedidosZona = [
      { movil: 0, estado_nro: 1 },    // sin movil → no cuenta
      { movil: null, estado_nro: 1 }, // sin movil → no cuenta
      { movil: 100, estado_nro: 1 },  // con movil → cuenta
      { movil: 200, estado_nro: 1 },  // con movil → cuenta
      { movil: 100, estado_nro: 2 },  // finalizado → no cuenta como pendiente
    ];
    expect(computePendientesConHide(pedidosZona, true)).toBe(2);
  });

  it('hideSinAsignar=false (root): todos los pendientes cuentan incluyendo sin movil', () => {
    const pedidosZona = [
      { movil: 0, estado_nro: 1 },
      { movil: null, estado_nro: 1 },
      { movil: 100, estado_nro: 1 },
    ];
    expect(computePendientesConHide(pedidosZona, false)).toBe(3);
  });

  it('hideSinAsignar=true con todos sin movil → pendientes=0', () => {
    const pedidosZona = [
      { movil: 0, estado_nro: 1 },
      { movil: null, estado_nro: 1 },
    ];
    expect(computePendientesConHide(pedidosZona, true)).toBe(0);
  });

  it('hideSinAsignar=true: finalizados no afectan el conteo de pendientes', () => {
    const pedidosZona = [
      { movil: 100, estado_nro: 2 }, // finalizado con movil
      { movil: 0,   estado_nro: 2 }, // finalizado sin movil
    ];
    expect(computePendientesConHide(pedidosZona, true)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5: Helper — sin movil = false sin importar opts/zona
// ─────────────────────────────────────────────────────────────────────────────
describe('AC5 - Helper: sin movil siempre false para distribuidor', () => {
  it('isPedidoInScope: movil=0, zona en scope, opts=keep → false', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('isPedidoInScope: movil=null, zona en scope, opts=keep → false', () => {
    expect(isPedidoInScope({ movil: null, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('isPedidoInScope: movil=0, zona fuera de scope, opts=keep → false', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 99, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('isPedidoInScope: movil=0, zona null, opts=keep → false', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: null, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('isServiceInScope: movil=0, zona en scope, opts=keep → false', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, normalScope, optsKeep)).toBe(false);
  });

  it('isServiceInScope: movil=null, zona en scope, opts=hide → false', () => {
    expect(isServiceInScope({ movil: null, zona_nro: 20, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge case: distribuidor con scopedZonaIds vacío → todo en 0 sin error
// ─────────────────────────────────────────────────────────────────────────────
describe('Edge case: distribuidor con scopedZonaIds vacío', () => {
  it('isPedidoInScope con scope vacío → false para cualquier pedido', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 10, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
    expect(isPedidoInScope({ movil: 100, zona_nro: null, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });

  it('isServiceInScope con scope vacío → false para cualquier service', () => {
    expect(isServiceInScope({ movil: 200, zona_nro: 20, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
    expect(isServiceInScope({ movil: 0, zona_nro: 20, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });

  it('computePedidosZonaData con scopedZonaIds vacío → mapa vacío sin error', () => {
    const pedidos = [
      { movil: 100, zona_nro: 10, estado_nro: 1 },
      { movil: 200, zona_nro: 20, estado_nro: 1 },
    ];
    const result = computePedidosZonaData(pedidos, 'pendientes', new Set<number>(), true);
    expect(result.size).toBe(0);
  });

  it('computeSinAsignar con scope vacío → 0 (fail-closed)', () => {
    const pedidos = [
      { movil: 0, zona_nro: 10, estado_nro: 1 },
    ];
    expect(computeSinAsignar(pedidos, emptyScope)).toBe(0);
  });
});
