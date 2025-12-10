'use client';

import React, { createContext, useContext, ReactNode } from 'react';
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

  // Hook de GPS Tracking en tiempo real
  const { positions, isConnected: gpsConnected, error: gpsError } = useGPSTracking(
    escenarioId,
    undefined, // No filtrar por móvil específico
    (newPosition) => {
      console.log('🔔 Nueva posición GPS recibida en tiempo real:', newPosition);
      setLatestPosition(newPosition);
    }
  );

  // Hook de Móviles en tiempo real (para detectar móviles nuevos)
  const { isConnected: movilesConnected } = useMoviles(
    escenarioId,
    undefined, // No filtrar por empresa
    (movil) => {
      console.log('🚗 Cambio en móvil detectado:', movil);
      setLatestMovil(movil);
    }
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

  return (
    <RealtimeContext.Provider value={{ positions, isConnected, error, latestPosition, latestMovil }}>
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
