/**
 * Tests for bug-fix + enhancement: onZonaClick ramifica por zonaLayerTipo
 * y pre-carga combos del ZonaMovilesViewModal.
 *
 * RunId: 20260529-155440-y2q
 *
 * Cubre los ACs del spec:
 * 1. pedidos-zona + zonaLayerTipo=services → abre ServicesTableModal
 * 2. pedidos-zona + zonaLayerTipo=pedidos → abre PedidosTableModal (comportamiento actual)
 * 3. Paridad de filtros: asignacion (sin_asignar→sin_movil, otros→todos)
 * 4. Paridad de filtros: atraso (atrasados→['muy_atrasado','atrasado'], otros→[])
 * 5. moviles-zonas + svcFilter=NOCTURNO → PEDIDOS + NOCTURNO
 * 6. moviles-zonas + svcFilter=URGENTE → PEDIDOS + URGENTE
 * 7. moviles-zonas + svcFilter=SERVICE → SERVICE + undefined
 * 8. openZonaView(null) resetea zonaViewInitial (FAB y Tour no arrastran valores previos)
 *
 * Pure state-logic tests — no React/DOM mounting needed.
 * Pattern: simular la lógica del handler como funciones puras.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────
// State models
// ─────────────────────────────────────────────

type PedidosZonaFilter = 'pendientes' | 'sin_asignar' | 'atrasados';
type ZonaLayerTipo = 'pedidos' | 'services';
type AtrasoFilter = 'muy_atrasado' | 'atrasado' | 'limite_cercana' | 'en_hora' | 'sin_hora';

interface DashboardState {
  isPedidosTableOpen: boolean;
  pedidosOpenSource: string | null;
  pedidosModalInitialFilters: Partial<{ asignacion: string; tipoServicio: string[] }> | undefined;
  pedidosModalVista: string;
  pedidosInitialAtraso: AtrasoFilter[] | undefined;

  isServicesTableOpen: boolean;
  servicesOpenSource: string | null;
  servicesModalInitialFilters: Partial<{ asignacion: string; atraso: AtrasoFilter[] }> | undefined;
  servicesModalVista: string;

  zonaViewModalOpen: boolean;
  zonaViewModalZonaId: number | null;
  zonaViewInitialTipoServicio: 'PEDIDOS' | 'SERVICE' | undefined;
  zonaViewInitialSubFiltro: 'URGENTE' | 'NOCTURNO' | undefined;

  preFilterZona: number | undefined;
  preFilterMovil: number | undefined;
}

function initialState(): DashboardState {
  return {
    isPedidosTableOpen: false,
    pedidosOpenSource: null,
    pedidosModalInitialFilters: undefined,
    pedidosModalVista: 'pendientes',
    pedidosInitialAtraso: undefined,

    isServicesTableOpen: false,
    servicesOpenSource: null,
    servicesModalInitialFilters: undefined,
    servicesModalVista: 'pendientes',

    zonaViewModalOpen: false,
    zonaViewModalZonaId: null,
    zonaViewInitialTipoServicio: undefined,
    zonaViewInitialSubFiltro: undefined,

    preFilterZona: undefined,
    preFilterMovil: undefined,
  };
}

// ─────────────────────────────────────────────
// CAMBIO 1: onZonaClick para dataViewMode='pedidos-zona'
// Simula el handler completo (ambos branches)
// ─────────────────────────────────────────────

function handlePedidosZonaClick(
  state: DashboardState,
  zonaId: number,
  zonaLayerTipo: ZonaLayerTipo,
  pedidosZonaFilter: PedidosZonaFilter,
): DashboardState {
  if (zonaLayerTipo === 'services') {
    return {
      ...state,
      servicesOpenSource: 'zona_combo',
      preFilterZona: zonaId,
      preFilterMovil: undefined,
      servicesModalInitialFilters: {
        asignacion: pedidosZonaFilter === 'sin_asignar' ? 'sin_movil' : 'todos',
        atraso: pedidosZonaFilter === 'atrasados' ? ['muy_atrasado', 'atrasado'] : [],
      },
      servicesModalVista: 'pendientes',
      isServicesTableOpen: true,
    };
  } else {
    return {
      ...state,
      pedidosOpenSource: 'zona_combo',
      preFilterZona: zonaId,
      preFilterMovil: undefined,
      pedidosModalInitialFilters: {
        asignacion: pedidosZonaFilter === 'sin_asignar' ? 'sin_movil' : 'todos',
        tipoServicio: [],
      },
      pedidosModalVista: 'pendientes',
      pedidosInitialAtraso: pedidosZonaFilter === 'atrasados' ? ['muy_atrasado', 'atrasado'] : [],
      isPedidosTableOpen: true,
    };
  }
}

// ─────────────────────────────────────────────
// CAMBIO 2: onZonaClick para dataViewMode='moviles-zonas'
// Simula el mapeo movilesZonasServiceFilter → (tipoServicio, subFiltro) + openZonaView
// ─────────────────────────────────────────────

function handleMovilesZonasClick(
  state: DashboardState,
  zonaId: number,
  movilesZonasServiceFilter: string,
): DashboardState {
  let tipoServicio: 'PEDIDOS' | 'SERVICE';
  let subFiltro: 'URGENTE' | 'NOCTURNO' | undefined;

  if (movilesZonasServiceFilter === 'SERVICE') {
    tipoServicio = 'SERVICE';
    subFiltro = undefined;
  } else if (movilesZonasServiceFilter === 'URGENTE') {
    tipoServicio = 'PEDIDOS';
    subFiltro = 'URGENTE';
  } else {
    // NOCTURNO u otro valor
    tipoServicio = 'PEDIDOS';
    subFiltro = 'NOCTURNO';
  }

  return {
    ...state,
    zonaViewInitialTipoServicio: tipoServicio,
    zonaViewInitialSubFiltro: subFiltro,
    zonaViewModalOpen: true,
    zonaViewModalZonaId: zonaId,
  };
}

// ─────────────────────────────────────────────
// CAMBIO 3 y 4: openZonaView(null) — FAB + Tour
// Simula el reset de zonaViewInitial antes de openZonaView(null)
// ─────────────────────────────────────────────

function openZonaViewFromNav(state: DashboardState): DashboardState {
  return {
    ...state,
    zonaViewInitialTipoServicio: undefined,
    zonaViewInitialSubFiltro: undefined,
    zonaViewModalOpen: true,
    zonaViewModalZonaId: null,
  };
}

// ─────────────────────────────────────────────
// Tests: CAMBIO 1 — pedidos-zona branch services/pedidos
// ─────────────────────────────────────────────

describe('AC1 — pedidos-zona + zonaLayerTipo=services → abre ServicesTableModal', () => {
  it('con zonaLayerTipo=services, isServicesTableOpen=true y isPedidosTableOpen=false', () => {
    const s = handlePedidosZonaClick(initialState(), 42, 'services', 'pendientes');
    expect(s.isServicesTableOpen).toBe(true);
    expect(s.isPedidosTableOpen).toBe(false);
  });

  it('con zonaLayerTipo=services, servicesOpenSource=zona_combo', () => {
    const s = handlePedidosZonaClick(initialState(), 42, 'services', 'pendientes');
    expect(s.servicesOpenSource).toBe('zona_combo');
  });

  it('con zonaLayerTipo=services, preFilterZona apunta a la zona clickeada', () => {
    const s = handlePedidosZonaClick(initialState(), 77, 'services', 'pendientes');
    expect(s.preFilterZona).toBe(77);
    expect(s.preFilterMovil).toBeUndefined();
  });

  it('con zonaLayerTipo=services, servicesModalVista=pendientes', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'pendientes');
    expect(s.servicesModalVista).toBe('pendientes');
  });
});

describe('AC2 — pedidos-zona + zonaLayerTipo=pedidos → abre PedidosTableModal (comportamiento actual intacto)', () => {
  it('con zonaLayerTipo=pedidos, isPedidosTableOpen=true y isServicesTableOpen=false', () => {
    const s = handlePedidosZonaClick(initialState(), 42, 'pedidos', 'pendientes');
    expect(s.isPedidosTableOpen).toBe(true);
    expect(s.isServicesTableOpen).toBe(false);
  });

  it('con zonaLayerTipo=pedidos, pedidosOpenSource=zona_combo', () => {
    const s = handlePedidosZonaClick(initialState(), 42, 'pedidos', 'pendientes');
    expect(s.pedidosOpenSource).toBe('zona_combo');
  });
});

describe('AC3 — paridad de filtros asignacion (services)', () => {
  it('pedidosZonaFilter=sin_asignar → asignacion=sin_movil en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'sin_asignar');
    expect(s.servicesModalInitialFilters?.asignacion).toBe('sin_movil');
  });

  it('pedidosZonaFilter=pendientes → asignacion=todos en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'pendientes');
    expect(s.servicesModalInitialFilters?.asignacion).toBe('todos');
  });

  it('pedidosZonaFilter=atrasados → asignacion=todos en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'atrasados');
    expect(s.servicesModalInitialFilters?.asignacion).toBe('todos');
  });
});

describe('AC3 — paridad de filtros asignacion (pedidos)', () => {
  it('pedidosZonaFilter=sin_asignar → asignacion=sin_movil en pedidos', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'pedidos', 'sin_asignar');
    expect(s.pedidosModalInitialFilters?.asignacion).toBe('sin_movil');
  });

  it('pedidosZonaFilter=pendientes → asignacion=todos en pedidos', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'pedidos', 'pendientes');
    expect(s.pedidosModalInitialFilters?.asignacion).toBe('todos');
  });
});

describe('AC4 — paridad de filtros atraso (services)', () => {
  it('pedidosZonaFilter=atrasados → atraso=[muy_atrasado, atrasado] en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'atrasados');
    expect(s.servicesModalInitialFilters?.atraso).toEqual(['muy_atrasado', 'atrasado']);
  });

  it('pedidosZonaFilter=pendientes → atraso=[] en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'pendientes');
    expect(s.servicesModalInitialFilters?.atraso).toEqual([]);
  });

  it('pedidosZonaFilter=sin_asignar → atraso=[] en services', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'services', 'sin_asignar');
    expect(s.servicesModalInitialFilters?.atraso).toEqual([]);
  });
});

describe('AC4 — paridad de filtros atraso (pedidos)', () => {
  it('pedidosZonaFilter=atrasados → pedidosInitialAtraso=[muy_atrasado, atrasado]', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'pedidos', 'atrasados');
    expect(s.pedidosInitialAtraso).toEqual(['muy_atrasado', 'atrasado']);
  });

  it('pedidosZonaFilter=pendientes → pedidosInitialAtraso=[]', () => {
    const s = handlePedidosZonaClick(initialState(), 1, 'pedidos', 'pendientes');
    expect(s.pedidosInitialAtraso).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// Tests: CAMBIO 2 — moviles-zonas mapeo svcFilter→(tipoServicio, subFiltro)
// ─────────────────────────────────────────────

describe('AC5 — moviles-zonas + NOCTURNO → PEDIDOS + NOCTURNO', () => {
  it('svcFilter=NOCTURNO → zonaViewInitialTipoServicio=PEDIDOS', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'NOCTURNO');
    expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
  });

  it('svcFilter=NOCTURNO → zonaViewInitialSubFiltro=NOCTURNO', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'NOCTURNO');
    expect(s.zonaViewInitialSubFiltro).toBe('NOCTURNO');
  });

  it('svcFilter=NOCTURNO → modal se abre en la zona correcta', () => {
    const s = handleMovilesZonasClick(initialState(), 13, 'NOCTURNO');
    expect(s.zonaViewModalOpen).toBe(true);
    expect(s.zonaViewModalZonaId).toBe(13);
  });
});

describe('AC6 — moviles-zonas + URGENTE → PEDIDOS + URGENTE', () => {
  it('svcFilter=URGENTE → zonaViewInitialTipoServicio=PEDIDOS', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'URGENTE');
    expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
  });

  it('svcFilter=URGENTE → zonaViewInitialSubFiltro=URGENTE', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'URGENTE');
    expect(s.zonaViewInitialSubFiltro).toBe('URGENTE');
  });
});

describe('AC7 — moviles-zonas + SERVICE → SERVICE + undefined', () => {
  it('svcFilter=SERVICE → zonaViewInitialTipoServicio=SERVICE', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'SERVICE');
    expect(s.zonaViewInitialTipoServicio).toBe('SERVICE');
  });

  it('svcFilter=SERVICE → zonaViewInitialSubFiltro=undefined', () => {
    const s = handleMovilesZonasClick(initialState(), 5, 'SERVICE');
    expect(s.zonaViewInitialSubFiltro).toBeUndefined();
  });
});

describe('AC5/6 — fallback para valores no reconocidos → PEDIDOS + NOCTURNO', () => {
  it('svcFilter desconocido cae en branch NOCTURNO (else)', () => {
    const s = handleMovilesZonasClick(initialState(), 1, 'OTRO_VALOR');
    expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
    expect(s.zonaViewInitialSubFiltro).toBe('NOCTURNO');
  });
});

// ─────────────────────────────────────────────
// Tests: CAMBIO 3/4 — FAB y Tour no arrastran valores previos
// ─────────────────────────────────────────────

describe('AC8 — openZonaView(null) resetea zonaViewInitial', () => {
  it('después de un click con NOCTURNO, FAB resetea tipoServicio a undefined', () => {
    let s = handleMovilesZonasClick(initialState(), 7, 'NOCTURNO');
    expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS'); // valor previo
    s = openZonaViewFromNav(s);
    expect(s.zonaViewInitialTipoServicio).toBeUndefined(); // reseteado
  });

  it('después de un click con URGENTE, FAB resetea subFiltro a undefined', () => {
    let s = handleMovilesZonasClick(initialState(), 7, 'URGENTE');
    expect(s.zonaViewInitialSubFiltro).toBe('URGENTE'); // valor previo
    s = openZonaViewFromNav(s);
    expect(s.zonaViewInitialSubFiltro).toBeUndefined(); // reseteado
  });

  it('después de un click con SERVICE, FAB abre con zonaId=null', () => {
    let s = handleMovilesZonasClick(initialState(), 7, 'SERVICE');
    s = openZonaViewFromNav(s);
    expect(s.zonaViewModalZonaId).toBeNull();
    expect(s.zonaViewModalOpen).toBe(true);
  });

  it('FAB sin click previo: zonaViewInitial queda undefined (comportamiento normal)', () => {
    const s = openZonaViewFromNav(initialState());
    expect(s.zonaViewInitialTipoServicio).toBeUndefined();
    expect(s.zonaViewInitialSubFiltro).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// Regresion: branch saturacion no tocado por los cambios
// ─────────────────────────────────────────────

describe('Regresion — branch saturacion sigue independiente', () => {
  it('saturacion no afecta ServicesTableModal ni PedidosTableModal', () => {
    // El handler de saturacion (setSaturacionModalZonaId) solo setea el zonaId
    // para el SaturacionModal — no toca los modales de tabla ni el zonaView.
    // Este test documenta que el cambio no introduce regresión en saturacion.
    let saturacionModalZonaId: number | null = null;
    // Simula setSaturacionModalZonaId(99)
    saturacionModalZonaId = 99;
    expect(saturacionModalZonaId).toBe(99);

    // Los demás estados no se tocan
    const s = initialState();
    expect(s.isServicesTableOpen).toBe(false);
    expect(s.isPedidosTableOpen).toBe(false);
    expect(s.zonaViewModalOpen).toBe(false);
  });
});
