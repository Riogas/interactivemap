'use client';

import React, { createContext, useContext, ReactNode, useCallback, useMemo } from 'react';
import { useGPSTracking, useMoviles } from '@/lib/hooks/useRealtimeSubscriptions';
import { useAuth } from '@/contexts/AuthContext';
import type { GPSTrackingSupabase, MovilSupabase } from '@/types';

// Guard para console.log en hot path de GPS/móviles.
// Activar con: NEXT_PUBLIC_DEBUG_REALTIME=true en .env.local
const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true';

interface RealtimeContextType {
  positions: Map<string, GPSTrackingSupabase>;
  isConnected: boolean;
  error: string | null;
  latestPosition: GPSTrackingSupabase | null;
  latestMovil: MovilSupabase | null;
  /**
   * Ref al ms epoch del último evento Realtime recibido (gps_latest_positions o moviles).
   * Es un RefObject — no causa re-renders al cambiar. Leer via getLastEventAt().
   */
  lastEventAtRef: React.RefObject<number>;
  /**
   * Lectura on-demand del último evento Realtime (ms epoch).
   * El dashboard lo usa en setInterval de silencio — cero re-renders.
   */
  getLastEventAt: () => number;
  /**
   * @deprecated Usar getLastEventAt() o lastEventAtRef.current.
   * Mantenido para retrocompatibilidad — devuelve el mismo valor que getLastEventAt()
   * pero no es reactivo (no causa re-renders en consumidores de useRealtime).
   */
  lastEventAt: number;
  /**
   * Callback que el dashboard inyecta para que el provider lo llame
   * cuando GPS o Móviles reconectan tras una caída.
   * El dashboard lo usa para hacer fetchPositions() y recuperar eventos perdidos.
   */
  onReconnect: (() => void) | null;
  setOnReconnect: (fn: (() => void) | null) => void;
  /**
   * Callback que el dashboard inyecta para que el provider lo llame
   * cuando llega cualquier evento UPDATE/INSERT/DELETE en la tabla `moviles`.
   * El dashboard usa esto para disparar un refetch debounced y reflejar cambios
   * de estado/activo sin necesidad de F5 ni esperar el polling de 60s.
   */
  onMovilEvent: (() => void) | null;
  setOnMovilEvent: (fn: (() => void) | null) => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

interface RealtimeProviderProps {
  children: ReactNode;
  escenarioId?: number;
}

/**
 * Provider público: gate por usuario.
 *
 * Si no hay user logueado (ej. /login), NO se monta el provider activo
 * (RealtimeProviderActive), entonces no se llaman useGPSTracking ni useMoviles
 * y NO se abren los WebSockets de Supabase Realtime. Esto bajó el consumo de
 * RAM/CPU de la pestaña de login de ~250MB / 50% a niveles normales.
 *
 * Si los consumidores de useRealtime() llegan a renderearse sin user (no
 * deberían — el dashboard ya tiene su propio gate), reciben un contexto noop.
 */
export function RealtimeProvider({ children, escenarioId = 1000 }: RealtimeProviderProps) {
  const { user } = useAuth();
  if (!user) {
    return (
      <RealtimeContext.Provider value={NOOP_CONTEXT}>
        {children}
      </RealtimeContext.Provider>
    );
  }
  return <RealtimeProviderActive escenarioId={escenarioId}>{children}</RealtimeProviderActive>;
}

// Ref estable para el contexto noop — evitar crear nuevo objeto en cada render del noop path
const _noopLastEventAtRef = { current: 0 } as React.RefObject<number>;
const NOOP_CONTEXT: RealtimeContextType = {
  positions: new Map(),
  isConnected: false,
  error: null,
  latestPosition: null,
  latestMovil: null,
  lastEventAtRef: _noopLastEventAtRef,
  getLastEventAt: () => 0,
  lastEventAt: 0,
  onReconnect: null,
  setOnReconnect: () => undefined,
  onMovilEvent: null,
  setOnMovilEvent: () => undefined,
};

function RealtimeProviderActive({
  children,
  escenarioId = 1000,
}: RealtimeProviderProps) {
  // Fix 3 perf-round-2: leer allowedEmpresas del user para pasarlas al useMoviles
  // null = root/sin restricción (no aplica filtro); array = empresas permitidas del distribuidor
  const { user: activeUser } = useAuth();
  const allowedEmpresaIds = activeUser?.allowedEmpresas ?? undefined;
  const [latestPosition, setLatestPosition] = React.useState<GPSTrackingSupabase | null>(null);
  const [latestMovil, setLatestMovil] = React.useState<MovilSupabase | null>(null);

  // lastEventAt como useRef — NO useState.
  // Razón: este valor se lee en un setInterval de silencio (polling), NO necesita
  // disparar re-renders. Cambiarlo de useState a useRef elimina re-renders en cascada
  // en TODOS los consumidores de useRealtime() en cada ping GPS/móvil.
  const lastEventAtRef = React.useRef<number>(Date.now());

  // Callback estable de lectura on-demand — no causa re-render al llamarse
  const getLastEventAt = useCallback(() => lastEventAtRef.current, []);

  // Callback inyectado por el dashboard para fetchPositions al reconectar.
  const [onReconnect, setOnReconnect] = React.useState<(() => void) | null>(null);
  // Callback inyectado por el dashboard para refetch debounced al recibir eventos de moviles.
  const [onMovilEvent, setOnMovilEvent] = React.useState<(() => void) | null>(null);

  // Callbacks estables — sin useCallback aquí se recrean en cada render y hacen
  // que useGPSTracking/useMoviles rehagan la suscripción a Supabase innecesariamente.
  const onNewPosition = useCallback((newPosition: GPSTrackingSupabase) => {
    setLatestPosition(newPosition);
    lastEventAtRef.current = Date.now(); // Ref: sin setState, sin re-render
  }, []);

  // onMovilEventRef permite que onMovilChange vea siempre la versión actual del callback
  // sin recrear onMovilChange (que causaría re-suscripción a Supabase).
  const onMovilEventRef = React.useRef<(() => void) | null>(null);
  onMovilEventRef.current = onMovilEvent;

  const onMovilChange = useCallback((movil: MovilSupabase) => {
    setLatestMovil(movil);
    lastEventAtRef.current = Date.now(); // Ref: sin setState, sin re-render
    // Notificar al dashboard de que hubo un cambio en la tabla moviles.
    // El debounce vive en el consumidor (dashboard) — aquí solo disparamos el callback.
    if (DEBUG_REALTIME) console.log('🚗 Cambio en tabla moviles detectado — refetch debounced');
    if (onMovilEventRef.current) onMovilEventRef.current();
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
  // Fix 3 perf-round-2: pasar allowedEmpresaIds para filtrar server-side en Supabase Realtime
  // Si allowedEmpresaIds es undefined (root), useMoviles recibe undefined → sin filtro server-side
  const { isConnected: movilesConnected } = useMoviles(
    escenarioId,
    allowedEmpresaIds,
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

  // setOnMovilEvent estable — mismo patrón que setOnReconnect
  const setOnMovilEventStable = useCallback((fn: (() => void) | null) => {
    setOnMovilEvent(fn ? () => fn : null);
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
  // NOTA: lastEventAtRef y getLastEventAt son referencias estables — no se incluyen
  // en las dependencias porque nunca cambian. lastEventAt se expone como alias
  // legacy que lee lastEventAtRef.current (sin reactividad, solo para retrocompat).
  const contextValue = useMemo<RealtimeContextType>(
    () => ({
      positions,
      isConnected,
      error,
      latestPosition,
      latestMovil,
      lastEventAtRef,
      getLastEventAt,
      lastEventAt: lastEventAtRef.current, // alias no-reactivo para retrocompat
      onReconnect,
      setOnReconnect: setOnReconnectStable,
      onMovilEvent,
      setOnMovilEvent: setOnMovilEventStable,
    }),
    [positions, isConnected, error, latestPosition, latestMovil, getLastEventAt, onReconnect, setOnReconnectStable, onMovilEvent, setOnMovilEventStable],
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
