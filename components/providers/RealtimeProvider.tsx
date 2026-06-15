'use client';

import React, { createContext, useContext, ReactNode, useCallback, useMemo, useRef } from 'react';
import { useGPSTracking, useMoviles } from '@/lib/hooks/useRealtimeSubscriptions';
import { useAuth } from '@/contexts/AuthContext';
import type { GPSTrackingSupabase, MovilSupabase } from '@/types';

// Guard para console.log en hot path de GPS/móviles.
// Activar con: NEXT_PUBLIC_DEBUG_REALTIME=true en .env.local
const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true';

// Tiempo de espera para coalescer eventos GPS consecutivos.
// Con flotas activas pueden llegar decenas de eventos por minuto; sin debounce
// cada uno dispara setLatestPosition → re-render del dashboard → map() de 200+ markers.
// 250ms es imperceptible para el usuario y reduce los re-renders ~10x en carga alta.
const GPS_DEBOUNCE_MS = 250;

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
   * Recibe el payload completo del evento para que el consumidor pueda hacer
   * bail-out si los campos relevantes no cambiaron (perf: evita fetchPositions innecesarios).
   */
  onMovilEvent: ((payload: MovilSupabase) => void) | null;
  setOnMovilEvent: (fn: ((payload: MovilSupabase) => void) | null) => void;
  /**
   * Habilita o deshabilita los canales GPS y Móviles del Realtime.
   * El dashboard lo llama con false cuando entra en modo histórico (fecha anterior a hoy)
   * y con true al volver a la fecha actual.
   * Cuando es false, todos los channels GPS/Móviles son eliminados (0 conexiones colgadas).
   */
  setRealtimeEnabled: (enabled: boolean) => void;
  /** Estado actual del flag enabled (para leer desde el dashboard si hace falta). */
  realtimeEnabled: boolean;
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
  setRealtimeEnabled: () => undefined,
  realtimeEnabled: true,
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
  // Firma actualizada a (payload: MovilSupabase) => void para que el consumidor pueda
  // evaluar el evento y hacer bail-out si no hay cambios relevantes (perf-round-4).
  const [onMovilEvent, setOnMovilEvent] = React.useState<((payload: MovilSupabase) => void) | null>(null);

  // Estado de habilitación del Realtime GPS/Móviles.
  // false = modo histórico activo → los hooks subyacentes no crean channels.
  const [realtimeEnabled, setRealtimeEnabledState] = React.useState<boolean>(true);

  // setRealtimeEnabled estable — no recrear en cada render
  const setRealtimeEnabled = useCallback((enabled: boolean) => {
    setRealtimeEnabledState(enabled);
    if (!enabled) {
      console.log('🔌 Realtime pausado (modo histórico)');
    } else {
      console.log('🔄 Realtime reanudado');
    }
  }, []);

  // perf-round-3 Fix 1: buffer de posiciones GPS para debounce.
  // En lugar de llamar setLatestPosition en cada evento (que dispara un re-render
  // completo del dashboard + map() de 200+ markers), acumulamos los eventos en un
  // buffer y solo aplicamos el último al state después de GPS_DEBOUNCE_MS de silencio.
  // Resultado: si llegan 10 eventos GPS en 250ms, solo hay 1 setLatestPosition → 1 re-render.
  const gpsPendingRef = useRef<GPSTrackingSupabase | null>(null);
  const gpsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callbacks estables — sin useCallback aquí se recrean en cada render y hacen
  // que useGPSTracking/useMoviles rehagan la suscripción a Supabase innecesariamente.
  const onNewPosition = useCallback((newPosition: GPSTrackingSupabase) => {
    // Actualizar lastEventAt inmediatamente (sin esperar el flush) para que el
    // detector de silencio no marque el canal como caído durante el debounce.
    lastEventAtRef.current = Date.now();

    // Coalescer: guardar la posición más reciente y armar un solo flush.
    // Si ya hay un timer pendiente, lo dejamos correr (solo se actualiza el buffer).
    // El timer existente flusheará con la posición más reciente al expirar.
    gpsPendingRef.current = newPosition;

    if (gpsFlushTimerRef.current == null) {
      gpsFlushTimerRef.current = setTimeout(() => {
        gpsFlushTimerRef.current = null;
        const latest = gpsPendingRef.current;
        gpsPendingRef.current = null;
        if (latest != null) {
          if (DEBUG_REALTIME) console.log('📍 GPS flush debounced:', latest.movil_id);
          setLatestPosition(latest);
        }
      }, GPS_DEBOUNCE_MS);
    }
  }, []);

  // Limpiar el timer de GPS al desmontar para evitar setState tras unmount
  React.useEffect(() => {
    return () => {
      if (gpsFlushTimerRef.current != null) {
        clearTimeout(gpsFlushTimerRef.current);
        gpsFlushTimerRef.current = null;
      }
    };
  }, []);

  // onMovilEventRef permite que onMovilChange vea siempre la versión actual del callback
  // sin recrear onMovilChange (que causaría re-suscripción a Supabase).
  // perf-round-4: tipo actualizado para pasar el payload al consumidor.
  const onMovilEventRef = React.useRef<((payload: MovilSupabase) => void) | null>(null);
  onMovilEventRef.current = onMovilEvent;

  const onMovilChange = useCallback((movil: MovilSupabase) => {
    setLatestMovil(movil);
    lastEventAtRef.current = Date.now(); // Ref: sin setState, sin re-render
    // Notificar al dashboard de que hubo un cambio en la tabla moviles.
    // Pasamos el payload completo para que el consumidor evalúe si requiere refetch.
    // El debounce y bail-out viven en el consumidor (dashboard) — aquí solo disparamos.
    if (DEBUG_REALTIME) console.log('🚗 Cambio en tabla moviles detectado — refetch debounced');
    if (onMovilEventRef.current) onMovilEventRef.current(movil);
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
  // server-scope GPS round: pasar allowedEmpresaIds como 5to param para filtrado
  // server-side en gps_latest_positions via empresa_fletera_id.
  // Si allowedEmpresaIds es undefined (root), useGPSTracking recibe undefined → sin filtro de empresa.
  // Requiere migration: docs/sqls/2026-05-18-gps-latest-empresa-fletera.sql
  // 6to param: enabled — false en modo histórico para pausar Realtime GPS.
  const { positions, isConnected: gpsConnected, error: gpsError } = useGPSTracking(
    escenarioId,
    undefined,
    onNewPosition,
    onReconnectGps,
    allowedEmpresaIds,
    realtimeEnabled,
  );

  // Hook de Móviles en tiempo real (para detectar móviles nuevos)
  // Fix 3 perf-round-2: pasar allowedEmpresaIds para filtrar server-side en Supabase Realtime
  // Si allowedEmpresaIds es undefined (root), useMoviles recibe undefined → sin filtro server-side
  // 5to param: enabled — false en modo histórico para pausar Realtime Móviles.
  const { isConnected: movilesConnected } = useMoviles(
    escenarioId,
    allowedEmpresaIds,
    onMovilChange,
    onReconnectMoviles,
    realtimeEnabled,
  );

  const isConnected = gpsConnected && movilesConnected;
  const error = gpsError;

  // setOnReconnect estable — no recrear en cada render
  const setOnReconnectStable = useCallback((fn: (() => void) | null) => {
    // useState con función: envolver en () => fn para que React no la invoque
    setOnReconnect(fn ? () => fn : null);
  }, []);

  // setOnMovilEvent estable — mismo patrón que setOnReconnect
  // perf-round-4: tipo actualizado para (payload: MovilSupabase) => void
  const setOnMovilEventStable = useCallback((fn: ((payload: MovilSupabase) => void) | null) => {
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
      setRealtimeEnabled,
      realtimeEnabled,
    }),
    [positions, isConnected, error, latestPosition, latestMovil, getLastEventAt, onReconnect, setOnReconnectStable, onMovilEvent, setOnMovilEventStable, setRealtimeEnabled, realtimeEnabled],
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
