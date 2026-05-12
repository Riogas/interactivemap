'use client';

/**
 * useViewStateSync — Hook que gestiona la persistencia y restauración del view-state
 * del dashboard a través de auto-reloads de realtime-health.
 *
 * Responsabilidades:
 * 1. Al montar (una sola vez): si isRealtimeReload() === true, leer el snapshot
 *    y devolverlo como `hydration`. Consume el flag.
 * 2. En cada cambio de los 8 campos observados: escribir el snapshot debounced (250ms).
 * 3. Exponer `mapStateRef` para que el dashboard alimente el estado del mapa.
 * 4. Exponer `panelRefs` para acceder a los scrollTop de los 3 paneles.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  saveViewState,
  loadViewState,
  consumeReloadFlag,
  isRealtimeReload,
  VIEW_STATE_VERSION,
  type MapState,
  type ModalSnapshot,
  type PanelScrolls,
  type ViewState,
} from '@/lib/view-state';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export interface HydrationResult {
  map: MapState | null;
  selectedMoviles: number[] | null;
  selectedEmpresas: number[] | null;
  showPendientes: boolean | null;
  showCompletados: boolean | null;
  pedidosZonaFilter: 'pendientes' | 'sin_asignar' | 'atrasados' | null;
  movilesZonasServiceFilter: string | null;
  modal: ModalSnapshot;
  panelScrolls: PanelScrolls | null;
}

export interface SyncArgs {
  selectedMoviles: number[];
  selectedEmpresas: number[];
  showPendientes: boolean;
  showCompletados: boolean;
  pedidosZonaFilter: 'pendientes' | 'sin_asignar' | 'atrasados';
  movilesZonasServiceFilter: string;
  modal: ModalSnapshot;
}

// ---------------------------------------------------------------------------
// Computar hydration una sola vez (fuera del cuerpo del hook para evitar re-ejecución)
// Se usa un módulo-level cache keyed por identidad de render — en realidad
// usamos un ref inicializado en la primera invocación del hook.
// ---------------------------------------------------------------------------

function computeHydration(): HydrationResult | null {
  if (typeof window === 'undefined') return null;
  if (!isRealtimeReload()) return null;
  const snapshot = loadViewState();
  consumeReloadFlag();
  if (!snapshot) return null;
  return {
    map: snapshot.map,
    selectedMoviles: snapshot.selectedMoviles,
    selectedEmpresas: snapshot.selectedEmpresas,
    showPendientes: snapshot.showPendientes,
    showCompletados: snapshot.showCompletados,
    pedidosZonaFilter: snapshot.pedidosZonaFilter,
    movilesZonasServiceFilter: snapshot.movilesZonasServiceFilter,
    modal: snapshot.modal,
    panelScrolls: snapshot.panelScrolls,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useViewStateSync(args: SyncArgs): {
  /** null = no hay hydration (F5 normal, no fue auto-reload de realtime) */
  hydration: HydrationResult | null;
  /** Ref que el componente alimenta con el estado actual del mapa */
  mapStateRef: React.MutableRefObject<MapState | null>;
  /** Refs a los contenedores scrolleables de los paneles laterales */
  panelRefs: {
    pedidos: React.RefObject<HTMLDivElement | null>;
    moviles: React.RefObject<HTMLDivElement | null>;
    empresas: React.RefObject<HTMLDivElement | null>;
  };
} {
  // Hydration se calcula una sola vez al montar.
  // Usamos un ref para que la referencia sea estable entre renders.
  const hydrationRef = useRef<HydrationResult | null | undefined>(undefined);
  if (hydrationRef.current === undefined) {
    hydrationRef.current = computeHydration();
  }
  const hydration = hydrationRef.current;

  // Ref que el componente alimenta con el estado del mapa (no es state para evitar re-renders)
  const mapStateRef = useRef<MapState | null>(
    hydration?.map ?? null,
  );

  // Refs para los scrollTop de los 3 paneles
  const pedidosPanelRef = useRef<HTMLDivElement | null>(null);
  const movilesPanelRef = useRef<HTMLDivElement | null>(null);
  const empresasPanelRef = useRef<HTMLDivElement | null>(null);

  // Ref a los args actuales para evitar stale closures en el debounce
  const argsRef = useRef<SyncArgs>(args);
  argsRef.current = args;

  // Timer del debounce
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Función que escribe el snapshot
  const flushSnapshot = useCallback(() => {
    const current = argsRef.current;
    const panelScrolls: PanelScrolls = {
      pedidos: pedidosPanelRef.current?.scrollTop ?? 0,
      moviles: movilesPanelRef.current?.scrollTop ?? 0,
      empresas: empresasPanelRef.current?.scrollTop ?? 0,
    };
    const state: ViewState = {
      version: VIEW_STATE_VERSION,
      savedAt: Date.now(),
      map: mapStateRef.current,
      selectedMoviles: current.selectedMoviles,
      selectedEmpresas: current.selectedEmpresas,
      showPendientes: current.showPendientes,
      showCompletados: current.showCompletados,
      pedidosZonaFilter: current.pedidosZonaFilter,
      movilesZonasServiceFilter: current.movilesZonasServiceFilter,
      modal: current.modal,
      panelScrolls,
    };
    saveViewState(state);
  }, []);

  // Debounce: dispara flushSnapshot 250ms después de cada cambio relevante
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(flushSnapshot, 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.selectedMoviles,
    args.selectedEmpresas,
    args.showPendientes,
    args.showCompletados,
    args.pedidosZonaFilter,
    args.movilesZonasServiceFilter,
    args.modal,
    flushSnapshot,
  ]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return {
    hydration,
    mapStateRef,
    panelRefs: {
      pedidos: pedidosPanelRef,
      moviles: movilesPanelRef,
      empresas: empresasPanelRef,
    },
  };
}
