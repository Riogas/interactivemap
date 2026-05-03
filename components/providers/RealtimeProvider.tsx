'use client';

import React, { createContext, useContext, ReactNode, useCallback, useMemo } from 'react';
import { useGPSTracking, useMoviles } from '@/lib/hooks/useRealtimeSubscriptions';
import type { GPSTrackingSupabase, MovilSupabase } from '@/types';

interface RealtimeContextType {
  positions: Map<string, GPSTrackingSupabase>;
  isConnected: boolean;
  error: string | null;
  latestPosition: GPSTrackingSupabase | null;
  latestMovil: MovilSupabase | null;
  /**
   * ms epoch del último evento Realtime recibido (gps_latest_positions o moviles).
   * El dashboard lo usa para detectar silencio del WS y forzar refetch.
   */
  lastEventAt: number;
  /**
   * Callback que el dashboard inyecta para que el provider lo llame
   * cuando GPS o Móviles reconectan tras una caída.
   * El dashboard lo usa para hacer fetchPositions() y recuperar eventos perdidos.
   */
  onReconnect: (() => void) | null;
  setOnReconnect: (fn: (() => void) | null) => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

interface RealtimeProviderProps {
  children: ReactNode;
  escenarioId?: number;
}

export function RealtimeProvider({
  children,
  escenarioId = 1000,
}: RealtimeProviderProps) {
  const [latestPosition, setLatestPosition] = React.useState<GPSTrackingSupabase | null>(null);
  const [latestMovil, setLatestMovil] = React.useState<MovilSupabase | null>(null);
  // ms epoch del último evento Realtime recibido — sirve al dashboard para detectar
  // silencio del WS de móviles/GPS y forzar refetch (paralelo al de pedidos/services).
  const [lastEventAt, setLastEventAt] = React.useState<number>(() => Date.now());
  // Callback inyectado por el dashboard para fetchPositions al reconectar.
  const [onReconnect, setOnReconnect] = React.useState<(() => void) | null>(null);

  // Callbacks estables — sin useCallback aquí se recrean en cada render y hacen
  // que useGPSTracking/useMoviles rehagan la suscripción a Supabase innecesariamente.
  const onNewPosition = useCallback((newPosition: GPSTrackingSupabase) => {
    setLatestPosition(newPosition);
    setLastEventAt(Date.now());
  }, []);

  const onMovilChange = useCallback((movil: MovilSupabase) => {
    setLatestMovil(movil);
    setLastEventAt(Date.now());
  }, []);

  // onReconnectRef permite que los hooks vean siempre la versión actual del callback
  // sin que tengamos que recrear onReconnectGps/onReconnectMoviles cuando cambia.
  const onReconnectRef = React.useRef<(() => void) | null>(null);
  onReconnectRef.current = onReconnect;

  const onReconnectGps = useCallback(() => {
    console.log('🔄 RealtimeProvider: GPS reconectado — notificando al dashboard');
    if (onReconnectRef.current) onReconnectRef.current();
  }, []);

  const onReconnectMoviles = useCallback(() => {
    console.log('🔄 RealtimeProvider: Móviles reconectado — notificando al dashboard');
    if (onReconnectRef.current) onReconnectRef.current();
  }, []);

  // Hook de GPS Tracking en tiempo real
  const { positions, isConnected: gpsConnected, error: gpsError } = useGPSTracking(
    escenarioId,
    undefined,
    onNewPosition,
    onReconnectGps,
  );

  // Hook de Móviles en tiempo real (para detectar móviles nuevos)
  const { isConnected: movilesConnected } = useMoviles(
    escenarioId,
    undefined,
    onMovilChange,
    onReconnectMoviles,
  );

  const isConnected = gpsConnected && movilesConnected;
  const error = gpsError;

  // setOnReconnect estable — no recrear en cada render
  const setOnReconnectStable = useCallback((fn: (() => void) | null) => {
    // useState con función: envolver en () => fn para que React no la invoque
    setOnReconnect(fn ? () => fn : null);
  }, []);

  React.useEffect(() => {
    if (isConnected) {
      console.log('✅ Conexión Realtime establecida para escenario_id =', escenarioId);
    } else {
      console.log('⏳ Esperando conexión Realtime...');
    }
  }, [isConnected, escenarioId]);

  React.useEffect(() => {
    if (error) {
      console.error('❌ Error en Realtime:', error);
    }
  }, [error]);

  // Memoizar el valor del contexto: sin esto, cada render del provider crea un nuevo
  // objeto y fuerza re-render de todos los consumidores de useRealtime(), aunque los
  // valores no hayan cambiado.
  const contextValue = useMemo<RealtimeContextType>(
    () => ({
      positions,
      isConnected,
      error,
      latestPosition,
      latestMovil,
      lastEventAt,
      onReconnect,
      setOnReconnect: setOnReconnectStable,
    }),
    [positions, isConnected, error, latestPosition, latestMovil, lastEventAt, onReconnect, setOnReconnectStable],
  );

  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (context === undefined) {
    throw new Error('useRealtime debe ser usado dentro de un RealtimeProvider');
  }
  return context;
}
