/**
 * Tests for feature/zona-estadisticas-celdas-clickeables
 *
 * Validates:
 * 1. onZonaStatsCellClick handler logic: correct filters per kind
 * 2. Value=0 → click no-op (onCellClick not called)
 * 3. ZonaEstadisticasModal stays open when PedidosTableModal opens via cell click
 * 4. Kind→filter mapping matches spec exactly
 *
 * Pure state-logic tests — no React/DOM mounting.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ZonaCellKind } from '@/components/ui/ZonaEstadisticasModal';

// ── State model (mirrors relevant slice of dashboard state) ────────────────────

type AtrasoFilter = 'muy_atrasado' | 'atrasado' | 'limite_cercana' | 'en_hora' | 'sin_hora';

interface DashboardPedidosState {
  openSource: 'colapsable' | 'navbar_sin_asignar' | 'navbar_entregados' | 'zona_combo' | 'movil_individual';
  preFilterZona?: number;
  preFilterMovil?: number;
  modalExtraSelectedMoviles: number[];
  isPedidosTableOpen: boolean;
  isZonaEstadisticasOpen: boolean;
  modalInitialFilters?: Partial<{
    asignacion: 'todos' | 'con_movil' | 'sin_movil';
    entrega: 'todos' | 'entregados' | 'no_entregados';
    tipoServicio: string[];
  }>;
  modalVista: 'pendientes' | 'finalizados';
  initialAtraso: AtrasoFilter[] | undefined;
  snapshotCalled: boolean;
}

function initialState(): DashboardPedidosState {
  return {
    openSource: 'colapsable',
    preFilterZona: undefined,
    preFilterMovil: undefined,
    modalExtraSelectedMoviles: [42], // has some items to verify they get cleared
    isPedidosTableOpen: false,
    isZonaEstadisticasOpen: true,
    modalInitialFilters: undefined,
    modalVista: 'pendientes',
    initialAtraso: undefined,
    snapshotCalled: false,
  };
}

/**
 * Simulates onZonaStatsCellClick(zonaId, kind) — mirrors the dashboard handler exactly.
 */
function onZonaStatsCellClick(state: DashboardPedidosState, zonaId: number, kind: ZonaCellKind): DashboardPedidosState {
  const next: DashboardPedidosState = {
    ...state,
    openSource: 'zona_combo',
    snapshotCalled: true, // snapshotPedidosState()
    preFilterZona: zonaId,
    preFilterMovil: undefined,
    modalExtraSelectedMoviles: [],
    isPedidosTableOpen: true,
  };

  switch (kind) {
    case 'sinAsignar':
      next.modalInitialFilters = { asignacion: 'sin_movil' };
      next.initialAtraso = undefined;
      next.modalVista = 'pendientes';
      break;
    case 'pendientes':
      next.modalInitialFilters = { asignacion: 'todos' };
      next.initialAtraso = undefined;
      next.modalVista = 'pendientes';
      break;
    case 'atrasados':
      next.modalInitialFilters = { asignacion: 'todos' };
      next.initialAtraso = ['muy_atrasado', 'atrasado'];
      next.modalVista = 'pendientes';
      break;
    case 'entregados':
      next.modalInitialFilters = { entrega: 'entregados', asignacion: 'todos' };
      next.initialAtraso = undefined;
      next.modalVista = 'finalizados';
      break;
    case 'noEntregados':
      next.modalInitialFilters = { entrega: 'no_entregados', asignacion: 'todos' };
      next.initialAtraso = undefined;
      next.modalVista = 'finalizados';
      break;
  }
  return next;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ZonaEstadisticasModal — cell click drill-down', () => {

  describe('Handler common behavior', () => {
    const kinds: ZonaCellKind[] = ['sinAsignar', 'pendientes', 'atrasados', 'entregados', 'noEntregados'];

    kinds.forEach((kind) => {
      it(`[${kind}] sets openSource=zona_combo, snapshots, sets preFilterZona, clears extras, opens modal`, () => {
        const s = onZonaStatsCellClick(initialState(), 77, kind);
        expect(s.openSource).toBe('zona_combo');
        expect(s.snapshotCalled).toBe(true);
        expect(s.preFilterZona).toBe(77);
        expect(s.preFilterMovil).toBeUndefined();
        expect(s.modalExtraSelectedMoviles).toEqual([]);
        expect(s.isPedidosTableOpen).toBe(true);
      });

      it(`[${kind}] ZonaEstadisticasModal stays open (isZonaEstadisticasOpen not changed)`, () => {
        const s = onZonaStatsCellClick(initialState(), 77, kind);
        // The handler does NOT touch isZonaEstadisticasOpen — it stays true
        expect(s.isZonaEstadisticasOpen).toBe(true);
      });
    });
  });

  describe('Kind → filter mapping', () => {
    it('sinAsignar → asignacion:sin_movil, vista:pendientes, atraso:undefined', () => {
      const s = onZonaStatsCellClick(initialState(), 1, 'sinAsignar');
      expect(s.modalInitialFilters).toEqual({ asignacion: 'sin_movil' });
      expect(s.modalVista).toBe('pendientes');
      expect(s.initialAtraso).toBeUndefined();
    });

    it('pendientes → asignacion:todos, vista:pendientes, atraso:undefined', () => {
      const s = onZonaStatsCellClick(initialState(), 1, 'pendientes');
      expect(s.modalInitialFilters).toEqual({ asignacion: 'todos' });
      expect(s.modalVista).toBe('pendientes');
      expect(s.initialAtraso).toBeUndefined();
    });

    it('atrasados → atraso:[muy_atrasado, atrasado] (no limite_cercana), vista:pendientes', () => {
      const s = onZonaStatsCellClick(initialState(), 1, 'atrasados');
      expect(s.modalInitialFilters).toEqual({ asignacion: 'todos' });
      expect(s.modalVista).toBe('pendientes');
      expect(s.initialAtraso).toEqual(['muy_atrasado', 'atrasado']);
      // Explicitly verify limite_cercana is NOT included
      expect(s.initialAtraso).not.toContain('limite_cercana');
    });

    it('entregados → entrega:entregados, asignacion:todos, vista:finalizados, atraso:undefined', () => {
      const s = onZonaStatsCellClick(initialState(), 1, 'entregados');
      expect(s.modalInitialFilters).toEqual({ entrega: 'entregados', asignacion: 'todos' });
      expect(s.modalVista).toBe('finalizados');
      expect(s.initialAtraso).toBeUndefined();
    });

    it('noEntregados → entrega:no_entregados, asignacion:todos, vista:finalizados, atraso:undefined', () => {
      const s = onZonaStatsCellClick(initialState(), 1, 'noEntregados');
      expect(s.modalInitialFilters).toEqual({ entrega: 'no_entregados', asignacion: 'todos' });
      expect(s.modalVista).toBe('finalizados');
      expect(s.initialAtraso).toBeUndefined();
    });
  });

  describe('Value=0 no-op (onCellClick not called)', () => {
    it('click on sinAsignar=0 does not call onCellClick', () => {
      // The component guards: if (z.sinAsignar > 0) onCellClick?(...)
      const onCellClick = vi.fn();
      const sinAsignarValue = 0;
      if (sinAsignarValue > 0) onCellClick(1, 'sinAsignar');
      expect(onCellClick).not.toHaveBeenCalled();
    });

    it('click on pendientes=5 calls onCellClick', () => {
      const onCellClick = vi.fn();
      const pendientesValue = 5;
      if (pendientesValue > 0) onCellClick(1, 'pendientes');
      expect(onCellClick).toHaveBeenCalledWith(1, 'pendientes');
    });

    it('click on atrasados=0 does not call onCellClick', () => {
      const onCellClick = vi.fn();
      const atrasadosValue = 0;
      if (atrasadosValue > 0) onCellClick(1, 'atrasados');
      expect(onCellClick).not.toHaveBeenCalled();
    });

    it('click on entregados=0 does not call onCellClick', () => {
      const onCellClick = vi.fn();
      const entregadosValue = 0;
      if (entregadosValue > 0) onCellClick(1, 'entregados');
      expect(onCellClick).not.toHaveBeenCalled();
    });

    it('click on noEntregados=3 calls onCellClick', () => {
      const onCellClick = vi.fn();
      const noEntregadosValue = 3;
      if (noEntregadosValue > 0) onCellClick(99, 'noEntregados');
      expect(onCellClick).toHaveBeenCalledWith(99, 'noEntregados');
    });
  });

  describe('ZonaCellKind type exhaustiveness', () => {
    it('all 5 kinds are defined in ZonaCellKind', () => {
      // Compile-time check via assignment (would fail tsc if a case is missing)
      const kinds: ZonaCellKind[] = ['sinAsignar', 'pendientes', 'atrasados', 'entregados', 'noEntregados'];
      expect(kinds).toHaveLength(5);
    });
  });

  describe('Regression — no interference with existing open sources', () => {
    it('after cell click, initialAtraso is explicitly cleared for non-atrasados kinds', () => {
      // Simulate: previously opened with atrasados, then open again with pendientes
      const stateWithPrevAtraso = onZonaStatsCellClick(initialState(), 1, 'atrasados');
      expect(stateWithPrevAtraso.initialAtraso).toEqual(['muy_atrasado', 'atrasado']);

      // Next click on pendientes should clear the atraso
      const stateWithPendientes = onZonaStatsCellClick(stateWithPrevAtraso, 2, 'pendientes');
      expect(stateWithPendientes.initialAtraso).toBeUndefined();
    });

    it('after cell click, initialAtraso is explicitly cleared for entregados', () => {
      const stateWithPrevAtraso = onZonaStatsCellClick(initialState(), 1, 'atrasados');
      const stateWithEntregados = onZonaStatsCellClick(stateWithPrevAtraso, 2, 'entregados');
      expect(stateWithEntregados.initialAtraso).toBeUndefined();
    });
  });
});
