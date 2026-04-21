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

  // Callbacks estables — sin useCallback aquí se recrean en cada render y hacen
  // que useGPSTracking/useMoviles rehagan la suscripción a Supabase innecesariamente.
  const onNewPosition = useCallback((newPosition: GPSTrackingSupabase) => {
    setLatestPosition(newPosition);
  }, []);

  const onMovilChange = useCallback((movil: MovilSupabase) => {
    setLatestMovil(movil);
  }, []);

  // Hook de GPS Tracking en tiempo real
  const { positions, isConnected: gpsConnected, error: gpsError } = useGPSTracking(
    escenarioId,
    undefined,
    onNewPosition,
  );

  // Hook de Móviles en tiempo real (para detectar móviles nuevos)
  const { isConnected: movilesConnected } = useMoviles(
    escenarioId,
    undefined,
    onMovilChange,
  );

  const isConnected = gpsConnected && movilesConnected;
  const error = gpsError;

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
    () => ({ positions, isConnected, error, latestPosition, latestMovil }),
    [positions, isConnected, error, latestPosition, latestMovil],
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
