/**
 * Tests unitarios para lib/view-state.ts
 *
 * vitest.config.ts usa environment: 'node' — sessionStorage no existe en Node.
 * Lo mockeamos con un Map simple antes de importar el módulo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de sessionStorage (environment: node no lo tiene)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};

const sessionStorageMock: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};

// Instalar el mock ANTES de importar el módulo (el módulo lee typeof sessionStorage en runtime)
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

// Importar DESPUÉS del mock
import {
  VIEW_STATE_KEY,
  VIEW_STATE_VERSION,
  RELOAD_FLAG_KEY,
  saveViewState,
  loadViewState,
  clearViewState,
  setReloadFlag,
  isRealtimeReload,
  consumeReloadFlag,
  type ViewState,
} from './view-state';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<ViewState>): ViewState {
  return {
    version: VIEW_STATE_VERSION,
    savedAt: Date.now(),
    map: { center: [-34.9, -56.2], zoom: 13 },
    selectedMoviles: [1, 2, 3],
    selectedEmpresas: [10, 20],
    showPendientes: true,
    showCompletados: false,
    pedidosZonaFilter: 'pendientes',
    movilesZonasServiceFilter: 'URGENTE',
    modal: null,
    panelScrolls: { pedidos: 0, moviles: 150, empresas: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('view-state — serialización roundtrip', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('guarda y recupera el estado correctamente', () => {
    const state = makeState();
    saveViewState(state);
    const loaded = loadViewState();
    expect(loaded).not.toBeNull();
    expect(loaded!.selectedMoviles).toEqual([1, 2, 3]);
    expect(loaded!.selectedEmpresas).toEqual([10, 20]);
    expect(loaded!.map?.zoom).toBe(13);
    expect(loaded!.map?.center).toEqual([-34.9, -56.2]);
    expect(loaded!.showPendientes).toBe(true);
    expect(loaded!.pedidosZonaFilter).toBe('pendientes');
    expect(loaded!.movilesZonasServiceFilter).toBe('URGENTE');
    expect(loaded!.panelScrolls.moviles).toBe(150);
  });

  it('preserva modal con entityId', () => {
    const state = makeState({ modal: { type: 'saturacion', entityId: 7 } });
    saveViewState(state);
    const loaded = loadViewState();
    expect(loaded!.modal).toEqual({ type: 'saturacion', entityId: 7 });
  });

  it('preserva modal pedidoPopup', () => {
    const state = makeState({ modal: { type: 'pedidoPopup', entityId: 42 } });
    saveViewState(state);
    const loaded = loadViewState();
    expect(loaded!.modal).toEqual({ type: 'pedidoPopup', entityId: 42 });
  });

  it('preserva modal sin entityId (pedidosTable)', () => {
    const state = makeState({ modal: { type: 'pedidosTable' } });
    saveViewState(state);
    const loaded = loadViewState();
    expect(loaded!.modal).toEqual({ type: 'pedidosTable' });
  });

  it('preserva bounds del mapa', () => {
    const state = makeState({ map: { center: [-34.9, -56.2], zoom: 13, bounds: [[-35, -57], [-34, -55]] } });
    saveViewState(state);
    const loaded = loadViewState();
    expect(loaded!.map?.bounds).toEqual([[-35, -57], [-34, -55]]);
  });
});

describe('view-state — TTL expirado', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('descarta snapshot más viejo que 10 minutos', () => {
    const expired = makeState({ savedAt: Date.now() - 11 * 60 * 1000 });
    saveViewState(expired);
    expect(loadViewState()).toBeNull();
  });

  it('acepta snapshot reciente', () => {
    const fresh = makeState({ savedAt: Date.now() - 5 * 60 * 1000 });
    saveViewState(fresh);
    expect(loadViewState()).not.toBeNull();
  });
});

describe('view-state — version mismatch', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('descarta snapshot con versión diferente', () => {
    const state = makeState({ version: 'v0' });
    saveViewState(state);
    expect(loadViewState()).toBeNull();
  });

  it('descarta snapshot con versión v2 futura', () => {
    const state = makeState({ version: 'v2' });
    saveViewState(state);
    expect(loadViewState()).toBeNull();
  });
});

describe('view-state — snapshot parcial (forward-compat)', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('tolera campos faltantes y usa defaults', () => {
    // Simular snapshot parcial almacenado directamente (sin selectedMoviles ni modal)
    const partial = {
      version: VIEW_STATE_VERSION,
      savedAt: Date.now(),
      map: { center: [-34.9, -56.2], zoom: 12 },
      selectedEmpresas: [5],
      showPendientes: false,
      showCompletados: true,
      pedidosZonaFilter: 'atrasados',
      movilesZonasServiceFilter: 'SERVICE',
      // selectedMoviles, modal, panelScrolls AUSENTES
    };
    store[VIEW_STATE_KEY] = JSON.stringify(partial);
    const loaded = loadViewState();
    expect(loaded).not.toBeNull();
    expect(loaded!.selectedMoviles).toEqual([]); // default
    expect(loaded!.modal).toBeNull(); // default
    expect(loaded!.panelScrolls).toEqual({ pedidos: 0, moviles: 0, empresas: 0 }); // default
    expect(loaded!.selectedEmpresas).toEqual([5]);
    expect(loaded!.pedidosZonaFilter).toBe('atrasados');
  });

  it('descarta payload no parseable', () => {
    store[VIEW_STATE_KEY] = 'not-json{{{';
    expect(loadViewState()).toBeNull();
  });

  it('descarta cuando no hay entrada en storage', () => {
    expect(loadViewState()).toBeNull();
  });
});

describe('view-state — clearViewState', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('elimina el snapshot', () => {
    saveViewState(makeState());
    clearViewState();
    expect(loadViewState()).toBeNull();
    expect(store[VIEW_STATE_KEY]).toBeUndefined();
  });
});

describe('view-state — flag guard (causedByRealtimeReload)', () => {
  beforeEach(() => sessionStorageMock.clear());

  it('isRealtimeReload() es false sin el flag', () => {
    expect(isRealtimeReload()).toBe(false);
  });

  it('setReloadFlag() → isRealtimeReload() = true', () => {
    setReloadFlag();
    expect(isRealtimeReload()).toBe(true);
  });

  it('consumeReloadFlag() borra el flag', () => {
    setReloadFlag();
    consumeReloadFlag();
    expect(isRealtimeReload()).toBe(false);
    expect(store[RELOAD_FLAG_KEY]).toBeUndefined();
  });

  it('consumeReloadFlag() es safe si el flag ya no existe', () => {
    expect(() => consumeReloadFlag()).not.toThrow();
  });

  it('F5 simulado — sin setReloadFlag → no se activa', () => {
    // El flag solo se pone si pasa por triggerAutoReload.
    // Un F5 normal no llama a triggerAutoReload → flag ausente.
    saveViewState(makeState());
    // Verificamos que sin el flag, el llamador no debería hidratar
    expect(isRealtimeReload()).toBe(false);
  });
});
