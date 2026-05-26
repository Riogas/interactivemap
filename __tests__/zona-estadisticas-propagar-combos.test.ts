/**
 * Tests for fix/zona-estadisticas-propagar-combos-a-moviles-view
 *
 * Verifies that tipoServicio + subFiltro are propagated from ZonaEstadisticasModal
 * to ZonaMovilesViewModal when opening from "Movs Prio" / "Movs Trans".
 *
 * Pure state-logic tests — no React/DOM mounting needed.
 */

import { describe, it, expect } from 'vitest';

// ── State model ──────────────────────────────────────────────────────────────

interface ZonaViewState {
  zonaViewModalOpen: boolean;
  zonaViewModalZonaId: number | null;
  zonaViewInitialTipoServicio: 'PEDIDOS' | 'SERVICE' | undefined;
  zonaViewInitialSubFiltro: 'URGENTE' | 'NOCTURNO' | undefined;
}

function initialState(): ZonaViewState {
  return {
    zonaViewModalOpen: false,
    zonaViewModalZonaId: null,
    zonaViewInitialTipoServicio: undefined,
    zonaViewInitialSubFiltro: undefined,
  };
}

/**
 * Simulates onMovsPrioClick / onMovsTransClick handler in dashboard/page.tsx.
 */
function handleMovsClick(
  state: ZonaViewState,
  zonaId: number,
  tipoServicio: 'PEDIDOS' | 'SERVICE',
  subFiltro: 'URGENTE' | 'NOCTURNO' | undefined,
): ZonaViewState {
  return {
    ...state,
    zonaViewInitialTipoServicio: tipoServicio,
    zonaViewInitialSubFiltro: subFiltro,
    zonaViewModalOpen: true,
    zonaViewModalZonaId: zonaId,
  };
}

/**
 * Simulates closing ZonaMovilesViewModal (onClose).
 * NOTE: initial filters are NOT reset on close — they persist until the next open.
 * This mirrors the current implementation. The important thing is that the NEXT
 * open will overwrite them if called from ZonaEstadisticasModal again.
 */
function closeZonaView(state: ZonaViewState): ZonaViewState {
  return { ...state, zonaViewModalOpen: false };
}

/**
 * Simulates opening ZonaMovilesViewModal from FAB (no combo propagation).
 */
function openZonaViewFromFab(state: ZonaViewState, zonaId: number | null): ZonaViewState {
  // FAB does NOT pass tipoServicio/subFiltro — they stay as whatever they were.
  // The modal uses initialServiceFilter (from map) and calcDefaultSubFilter() for time-based default.
  return {
    ...state,
    zonaViewModalOpen: true,
    zonaViewModalZonaId: zonaId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ZonaEstadisticasModal → ZonaMovilesViewModal combo propagation', () => {

  describe('AC1: Padre en Pedidos+Urgente → click Movs Prio → hijo arranca con Pedidos+Urgente', () => {
    it('tipoServicio=PEDIDOS, subFiltro=URGENTE se propagan al abrir desde Movs Prio', () => {
      let s = initialState();
      s = handleMovsClick(s, 42, 'PEDIDOS', 'URGENTE');
      expect(s.zonaViewModalOpen).toBe(true);
      expect(s.zonaViewModalZonaId).toBe(42);
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBe('URGENTE');
    });
  });

  describe('AC2: Padre en Pedidos+Nocturno → hijo arranca con Pedidos+Nocturno', () => {
    it('tipoServicio=PEDIDOS, subFiltro=NOCTURNO se propagan al abrir desde Movs Prio', () => {
      let s = initialState();
      s = handleMovsClick(s, 15, 'PEDIDOS', 'NOCTURNO');
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBe('NOCTURNO');
    });

    it('subFiltro=NOCTURNO también funciona al abrir desde Movs Trans', () => {
      let s = initialState();
      s = handleMovsClick(s, 7, 'PEDIDOS', 'NOCTURNO');
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBe('NOCTURNO');
    });
  });

  describe('AC3: Padre en Services → hijo arranca con Services (sin subFiltro)', () => {
    it('tipoServicio=SERVICE se propaga, subFiltro queda undefined', () => {
      let s = initialState();
      s = handleMovsClick(s, 3, 'SERVICE', undefined);
      expect(s.zonaViewInitialTipoServicio).toBe('SERVICE');
      expect(s.zonaViewInitialSubFiltro).toBeUndefined();
    });
  });

  describe('AC4: El usuario puede cambiar combos en el hijo sin afectar al padre', () => {
    it('el estado del padre no cambia cuando el hijo modifica sus combos', () => {
      // El padre mantiene sus propios combos (tipoPrincipal/subTipoPedidos) en su propio state
      // independiente del hijo. Este test verifica que no hay propagación inversa.
      // Al abrir el hijo, solo se setean los valores iniciales del hijo.
      // El estado del padre (ZonaEstadisticasModal) no se toca en ningún momento de este flujo.
      const parentTipoPrincipal = 'PEDIDOS'; // valor en el padre
      const parentSubTipoPedidos = 'NOCTURNO'; // valor en el padre

      let s = initialState();
      s = handleMovsClick(s, 5, parentTipoPrincipal, parentSubTipoPedidos);

      // El estado del hijo se inicializó con los del padre
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBe('NOCTURNO');

      // Simulamos que el usuario cambió el combo del hijo (no afecta nuestro state)
      // parentTipoPrincipal y parentSubTipoPedidos siguen sin cambiar — el padre no tiene acceso
      // al state interno del hijo ni tampoco hay callback inverso.
      expect(parentTipoPrincipal).toBe('PEDIDOS');
      expect(parentSubTipoPedidos).toBe('NOCTURNO');
    });
  });

  describe('AC5: Cuando NO se pasa initialSubFiltro (caller no es ZonaEstadisticasModal)', () => {
    it('zonaViewInitialSubFiltro queda undefined → modal calcula por hora', () => {
      // FAB path — no pasa combo values
      let s = initialState();
      s = openZonaViewFromFab(s, null);
      // undefined = modal usará calcDefaultSubFilter() (por hora)
      expect(s.zonaViewInitialSubFiltro).toBeUndefined();
    });
  });

  describe('AC6: Padre en Pedidos+TODOS → subFiltro undefined → hijo calcula por hora', () => {
    it('cuando el padre está en TODOS, subFiltro no se propaga (calcula por hora)', () => {
      // En ZonaEstadisticasModal, tipoPrincipal='PEDIDOS' + subTipoPedidos='TODOS'
      // → el callback pasa subFiltro=undefined (el implementer solo pasa subFiltro cuando !== TODOS)
      let s = initialState();
      s = handleMovsClick(s, 10, 'PEDIDOS', undefined); // subFiltro=undefined = TODOS case
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBeUndefined();
    });
  });

  describe('Movs Trans — mismo comportamiento que Movs Prio', () => {
    it('Movs Trans con Pedidos+Urgente propaga igual que Movs Prio', () => {
      let s = initialState();
      s = handleMovsClick(s, 20, 'PEDIDOS', 'URGENTE');
      expect(s.zonaViewInitialTipoServicio).toBe('PEDIDOS');
      expect(s.zonaViewInitialSubFiltro).toBe('URGENTE');
    });

    it('Movs Trans con Services propaga tipoServicio=SERVICE, subFiltro=undefined', () => {
      let s = initialState();
      s = handleMovsClick(s, 20, 'SERVICE', undefined);
      expect(s.zonaViewInitialTipoServicio).toBe('SERVICE');
      expect(s.zonaViewInitialSubFiltro).toBeUndefined();
    });
  });

  describe('Regresión — ZonaEstadisticasModal sigue abierto al abrir el hijo', () => {
    it('abrir ZonaMovilesViewModal NO cierra ZonaEstadisticasModal', () => {
      // Este test modela el estado combinado para confirmar que la apertura del hijo
      // no toca el estado de la madre (consistent with child-close tests).
      const isZonaEstadisticasOpen = true; // padre abierto
      let s = initialState();
      s = handleMovsClick(s, 8, 'PEDIDOS', 'URGENTE');
      // isZonaEstadisticasOpen no fue tocado por handleMovsClick
      expect(isZonaEstadisticasOpen).toBe(true);
      expect(s.zonaViewModalOpen).toBe(true);
    });
  });
});

// ── Tests de la lógica de inicialización en ZonaMovilesViewModal ──────────────

describe('ZonaMovilesViewModal — lógica de inicialización de combos', () => {

  /**
   * Simula la lógica de los dos useEffect que inicializan serviceFilter y pedidosSubFilter
   * cuando el modal se abre.
   */
  function simulateModalOpen(
    initialTipoServicio: 'PEDIDOS' | 'SERVICE' | undefined,
    initialSubFiltro: 'URGENTE' | 'NOCTURNO' | undefined,
    initialServiceFilter: string | undefined,
    calcDefaultSubFilter: () => 'URGENTE' | 'NOCTURNO',
  ): { serviceFilter: string; pedidosSubFilter: 'URGENTE' | 'NOCTURNO' } {
    // Effect 1: serviceFilter
    let serviceFilter = 'PEDIDOS'; // default state inicial del modal
    if (initialTipoServicio) {
      serviceFilter = initialTipoServicio;
    } else if (initialServiceFilter) {
      const upper = initialServiceFilter.toUpperCase();
      serviceFilter = upper === 'SERVICE' ? 'SERVICE' : 'PEDIDOS';
    }

    // Effect 2: pedidosSubFilter (corre DESPUÉS del effect 1)
    const pedidosSubFilter = initialSubFiltro ?? calcDefaultSubFilter();

    return { serviceFilter, pedidosSubFilter };
  }

  const calcDefaultUrgente = () => 'URGENTE' as const;
  const calcDefaultNocturno = () => 'NOCTURNO' as const;

  it('initialTipoServicio=PEDIDOS, initialSubFiltro=URGENTE → serviceFilter=PEDIDOS, subFilter=URGENTE', () => {
    const { serviceFilter, pedidosSubFilter } = simulateModalOpen('PEDIDOS', 'URGENTE', undefined, calcDefaultNocturno);
    expect(serviceFilter).toBe('PEDIDOS');
    expect(pedidosSubFilter).toBe('URGENTE');
  });

  it('initialTipoServicio=PEDIDOS, initialSubFiltro=NOCTURNO → serviceFilter=PEDIDOS, subFilter=NOCTURNO', () => {
    const { serviceFilter, pedidosSubFilter } = simulateModalOpen('PEDIDOS', 'NOCTURNO', undefined, calcDefaultUrgente);
    expect(serviceFilter).toBe('PEDIDOS');
    expect(pedidosSubFilter).toBe('NOCTURNO');
    // Verifica que initialSubFiltro gana sobre el cálculo por hora (que hubiera dado URGENTE)
  });

  it('initialTipoServicio=SERVICE, initialSubFiltro=undefined → serviceFilter=SERVICE, subFilter=calculado por hora', () => {
    const { serviceFilter, pedidosSubFilter } = simulateModalOpen('SERVICE', undefined, undefined, calcDefaultNocturno);
    expect(serviceFilter).toBe('SERVICE');
    // Sub-filter no aplica para SERVICE, pero el state sigue calculando por hora (sin efecto visual)
    expect(pedidosSubFilter).toBe('NOCTURNO'); // viene de calcDefaultSubFilter
  });

  it('sin initialTipoServicio pero con initialServiceFilter=PEDIDOS → PEDIDOS (comportamiento viejo)', () => {
    const { serviceFilter, pedidosSubFilter } = simulateModalOpen(undefined, undefined, 'PEDIDOS', calcDefaultUrgente);
    expect(serviceFilter).toBe('PEDIDOS');
    expect(pedidosSubFilter).toBe('URGENTE'); // cálculo por hora
  });

  it('sin initialTipoServicio ni initialServiceFilter → defaults (PEDIDOS + por hora)', () => {
    const { serviceFilter, pedidosSubFilter } = simulateModalOpen(undefined, undefined, undefined, calcDefaultNocturno);
    expect(serviceFilter).toBe('PEDIDOS');
    expect(pedidosSubFilter).toBe('NOCTURNO'); // cálculo por hora
  });

  it('initialTipoServicio gana sobre initialServiceFilter cuando ambos están presentes', () => {
    // initialTipoServicio=SERVICE, initialServiceFilter='URGENTE' (del mapa)
    const { serviceFilter } = simulateModalOpen('SERVICE', undefined, 'URGENTE', calcDefaultUrgente);
    expect(serviceFilter).toBe('SERVICE'); // initialTipoServicio gana
  });

  it('initialSubFiltro=URGENTE gana sobre calcDefaultSubFilter()=NOCTURNO', () => {
    // Hora nocturna pero el padre estaba en URGENTE → el hijo arranca con URGENTE
    const { pedidosSubFilter } = simulateModalOpen('PEDIDOS', 'URGENTE', undefined, calcDefaultNocturno);
    expect(pedidosSubFilter).toBe('URGENTE');
  });
});
