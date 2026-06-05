'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  GPSTrackingSupabase,
  MovilSupabase,
  PedidoSupabase,
  ServiceSupabase,
  EmpresaFleteraSupabase
} from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';
import { recordRealtimeFailure } from '@/lib/realtime-health';

// Activar solo en desarrollo para no serializar objetos en cada update de GPS
const DEBUG_REALTIME = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_REALTIME === '1';
const dbg = (...args: any[]) => { if (DEBUG_REALTIME) console.log(...args); };

// perf-round-3: tiempo de debounce para coalescer eventos de pedidos/services.
// 250ms es imperceptible para el usuario y reduce actualizaciones de state ~10x
// cuando llegan ráfagas de eventos (ej. importación masiva, cambio de turno).
const PEDIDOS_DEBOUNCE_MS = 250;

/**
 * Programa una reconexión del canal Realtime respetando la visibilidad del
 * tab. Si el tab está oculto, NO reintenta inmediatamente — algunos
 * navegadores (Chrome/Edge con "Tab Freezing") suspenden los WebSockets en
 * tabs en background, y un setTimeout cada 5s genera un loop infinito de
 * CLOSED → reconnect → CLOSED. En ese caso, registramos un listener
 * `visibilitychange` y reconectamos UNA sola vez al volver visible.
 *
 * Cuando el tab está visible, comportamiento normal con setTimeout(retryMs).
 *
 * @returns un objeto con un `cancel()` para limpiar timers/listeners.
 */
function scheduleReconnect(
  retryMs: number,
  fire: () => void,
): { cancel: () => void } {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    let staggerTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        // Stagger con jitter aleatorio 0-1500ms para que las 4 suscripciones
        // (GPS / Móviles / Pedidos / Services) NO reabran al unísono al volver
        // la visibilidad. Sin esto, el burst de 4 reconexiones simultáneas
        // dispara un death-loop con CLOSED inmediato.
        const jitter = Math.floor(Math.random() * 1500);
        staggerTimer = setTimeout(fire, jitter);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return {
      cancel: () => {
        document.removeEventListener('visibilitychange', onVisible);
        if (staggerTimer) clearTimeout(staggerTimer);
      },
    };
  }
  const t = setTimeout(fire, retryMs);
  return { cancel: () => clearTimeout(t) };
}

/**
 * Hook para suscribirse a cambios en tiempo real de GPS tracking
 * @param escenarioId - ID del escenario a monitorear
 * @param movilIds - Array de IDs de móviles a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización
 * @param onReconnect - Callback invocado cuando el canal reconecta tras una caída.
 *   El consumidor debe usarlo para hacer refetch del estado completo, ya que los
 *   eventos perdidos durante la desconexión no se reenvían.
 * @param empresaIds - Array de IDs de empresa_fletera para filtrado server-side (opcional).
 *   Si se provee, aplica filter en el canal Realtime de gps_latest_positions.
 *   Requiere que la columna empresa_fletera_id exista en gps_latest_positions
 *   (migration: docs/sqls/2026-05-18-gps-latest-empresa-fletera.sql).
 *   Si es null/undefined (root o sin restricción): NO se aplica filtro server-side.
 * @param enabled - Si false, no se crea ningún channel y se limpian los existentes.
 *   Usado por el modo histórico para pausar Realtime sin desmontar el hook.
 */
export function useGPSTracking(
  escenarioId: number = 1,
  movilIds?: string[],
  onUpdate?: (position: GPSTrackingSupabase) => void,
  onReconnect?: () => void,
  empresaIds?: number[],
  enabled: boolean = true
) {
  const [positions, setPositions] = useState<Map<string, GPSTrackingSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wasConnectedRef: true después de la primera conexión exitosa.
  // Permite distinguir "primera conexión" de "reconexión" en el callback de subscribe.
  const wasConnectedRef = useRef(false);
  // onReconnectRef: mantiene siempre la versión más reciente del callback sin
  // que el efecto tenga que re-suscribirse cuando la función cambia en el padre.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    // Modo histórico: no crear channels, marcar como desconectado.
    if (!enabled) {
      console.log('🔌 Realtime GPS pausado (modo histórico)');
      setIsConnected(false);
      return () => {};
    }

    console.log('🔄 Iniciando suscripción GPS Tracking...');
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

    // Construir el filtro server-side para el canal Realtime.
    // Replica el patrón de useMoviles (perf-round-2, commit 2391a4f):
    //   - 1 empresa: 'empresa_fletera_id=eq.X'
    //   - N empresas: 'empresa_fletera_id=in.(X,Y,Z)'
    //   - null/undefined (root): sin filtro adicional (comportamiento original)
    // NOTA: el filtro server-side reduce el tráfico de red, pero el filtrado
    // client-side por movilIds se mantiene como segunda defensa.
    const buildGpsFilter = (): string => {
      if (empresaIds && empresaIds.length === 1) {
        return `empresa_fletera_id=eq.${empresaIds[0]}`;
      }
      if (empresaIds && empresaIds.length > 1) {
        return `empresa_fletera_id=in.(${empresaIds.join(',')})`;
      }
      // Root/sin restricción: filtrar solo por escenario
      return `escenario_id=eq.${escenarioId}`;
    };

    const gpsFilter = buildGpsFilter();

    const setupChannel = () => {
      // Limpiar canal anterior si existe
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      // Crear canal único con timestamp para evitar conflictos
      const channelName = `gps-latest-${escenarioId}-${Date.now()}`;

      // Crear canal de Realtime — suscrito a gps_latest_positions (1 fila por móvil)
      // Los eventos INSERT ocurren cuando un móvil aparece por primera vez
      // Los eventos UPDATE ocurren cuando el trigger sync_gps_latest_position actualiza la fila
      channel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'gps_latest_positions',
            filter: gpsFilter,
          },
          (payload) => {
            if (!isComponentMounted) return;

            dbg('📍 GPS INSERT:', (payload.new as any)?.movil_id);
            const newPosition = payload.new as GPSTrackingSupabase;

            // Filtrar por móvil si se especifica (segunda defensa client-side)
            if (!movilIds || movilIds.includes(newPosition.movil_id)) {
              setPositions(prev => {
                const updated = new Map(prev);
                updated.set(newPosition.movil_id, newPosition);
                return updated;
              });

              if (onUpdate) {
                onUpdate(newPosition);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'gps_latest_positions',
            filter: gpsFilter,
          },
          (payload) => {
            if (!isComponentMounted) return;

            dbg('📍 GPS UPDATE:', (payload.new as any)?.movil_id);
            const updatedPosition = payload.new as GPSTrackingSupabase;

            // Filtrar por móvil si se especifica (segunda defensa client-side)
            if (!movilIds || movilIds.includes(updatedPosition.movil_id)) {
              setPositions(prev => {
                const updated = new Map(prev);
                updated.set(updatedPosition.movil_id, updatedPosition);
                return updated;
              });

              if (onUpdate) {
                onUpdate(updatedPosition);
              }
            }
          }
        )
        .subscribe((status) => {
          if (!isComponentMounted) return;

          dbg('📡 GPS status:', status);

          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            console.log('✅ Conectado a Realtime GPS Tracking');
            // Si era una reconexión (no la primera vez), solicitar refetch completo.
            // Los eventos perdidos durante la desconexión no se reenvían, por eso
            // el consumidor debe pedir el estado completo a la API.
            if (wasConnectedRef.current && onReconnectRef.current) {
              console.log('🔄 Realtime GPS reconectado — solicitando refetch completo');
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            setError(`Error de conexión con Realtime GPS: ${status}`);
            console.warn(`⚠️ Error en suscripción GPS: ${status}. Reconectando...`);
            recordRealtimeFailure(`GPS:${status}`);
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) {
                console.log('🔄 Reconectando GPS realtime...');
                setupChannel();
              }
            });
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción GPS cerrada. Reconectando cuando vuelva visible...');
            recordRealtimeFailure('GPS:CLOSED');
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) setupChannel();
            });
          }
        });
    };

    // Iniciar primera conexión
    setupChannel();

    // Cleanup
    return () => {
      console.log('🧹 Limpiando suscripción GPS...');
      isComponentMounted = false;

      if (reconnectHandle) {
        reconnectHandle.cancel();
      }

      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  // Re-suscribir si cambian los filtros (escenario, moviles, empresas, o enabled)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escenarioId, movilIds?.join(','), empresaIds?.join(','), enabled]);

  return { positions, isConnected, error };
}

/**
 * Hook para suscribirse a cambios en la tabla de móviles
 * @param escenarioId - ID del escenario a monitorear
 * @param empresaIds - Array de IDs de empresas a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización de móvil
 * @param onReconnect - Callback invocado cuando el canal reconecta tras una caída.
 *   El consumidor debe usarlo para hacer refetch del estado completo.
 * @param enabled - Si false, no se crea ningún channel. Usado en modo histórico.
 */
export function useMoviles(
  escenarioId: number = 1,
  empresaIds?: number[],
  onUpdate?: (movil: MovilSupabase) => void,
  onReconnect?: () => void,
  enabled: boolean = true
) {
  const [moviles, setMoviles] = useState<MovilSupabase[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // wasConnectedRef: true después de la primera conexión exitosa.
  const wasConnectedRef = useRef(false);
  // onReconnectRef: mantiene siempre la versión más reciente sin forzar re-suscripción.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    // Modo histórico: no crear channels, marcar como desconectado.
    if (!enabled) {
      console.log('🔌 Realtime Móviles pausado (modo histórico)');
      setIsConnected(false);
      return () => {};
    }

    console.log('🔄 Iniciando suscripción a móviles...');
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

    const setupChannel = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      const channelName = `moviles-changes-${escenarioId}-${Date.now()}`;

      channel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'moviles',
            // Fix 3 perf-round-2: server-side filter por empresa.
            // Supabase Realtime postgres_changes soporta filter con sintaxis PostgREST.
            // Si empresaIds tiene exactamente 1 empresa: 'empresa_fletera_id=eq.X'
            // Si tiene 2+: 'empresa_fletera_id=in.(1,2,3)'
            // Si es null/undefined (root/sin restriccion): sin filter (comportamiento actual).
            // IMPORTANTE: el filtro server-side reduce el trafico de red pero el
            // filtrado client-side en el callback se mantiene como segunda defensa.
            ...(empresaIds && empresaIds.length === 1
              ? { filter: `empresa_fletera_id=eq.${empresaIds[0]}` }
              : empresaIds && empresaIds.length > 1
              ? { filter: `empresa_fletera_id=in.(${empresaIds.join(',')})` }
              : {}),
          },
          (payload) => {
            if (!isComponentMounted) return;
            dbg('🚗 Movil change:', (payload.new as any)?.id);

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const movil = payload.new as MovilSupabase;

              // Filtrar por empresa si se especifica
              if (!empresaIds || empresaIds.includes(movil.empresa_fletera_id)) {
                setMoviles(prev => {
                  const filtered = prev.filter(m => m.id !== movil.id);
                  return [...filtered, movil];
                });

                if (onUpdate) {
                  onUpdate(movil);
                }
              }
            } else if (payload.eventType === 'DELETE') {
              const oldMovil = payload.old as MovilSupabase;
              setMoviles(prev => prev.filter(m => m.id !== oldMovil.id));
            }
          }
        )
        .subscribe((status) => {
          if (!isComponentMounted) return;
          dbg('📡 Moviles status:', status);

          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            console.log('✅ Conectado a Realtime Móviles');
            // Si era una reconexión, solicitar refetch completo para recuperar
            // los cambios perdidos durante la desconexión.
            if (wasConnectedRef.current && onReconnectRef.current) {
              console.log('🔄 Realtime Móviles reconectado — solicitando refetch completo');
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            console.warn(`⚠️ Error en suscripción de móviles: ${status}. Reconectando...`);
            recordRealtimeFailure(`Moviles:${status}`);
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) {
                console.log('🔄 Reconectando móviles realtime...');
                setupChannel();
              }
            });
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción móviles cerrada. Reconectando cuando vuelva visible...');
            recordRealtimeFailure('Moviles:CLOSED');
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) setupChannel();
            });
          }
        });
    };

    setupChannel();

    return () => {
      isComponentMounted = false;
      if (reconnectHandle) reconnectHandle.cancel();
      if (channel) supabase.removeChannel(channel);
    };
  }, [escenarioId, empresaIds?.join(','), enabled]);

  return { moviles, isConnected };
}

/**
 * Hook para suscribirse a cambios en pedidos
 */
export function usePedidos(
  escenarioId: number = 1,
  movilId?: number,
  onUpdate?: (pedido: PedidoSupabase) => void
) {
  const [pedidos, setPedidos] = useState<PedidoSupabase[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    console.log('🔄 Iniciando suscripción a pedidos...');

    let filterString = `escenario_id=eq.${escenarioId}`;
    if (movilId) {
      filterString += `,movil_id=eq.${movilId}`;
    }

    const channel = supabase
      .channel('pedidos-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pedidos',
          filter: filterString,
        },
        (payload) => {
          dbg('📦 Pedido change:', (payload.new as any)?.id);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const pedido = payload.new as PedidoSupabase;
            setPedidos(prev => {
              const filtered = prev.filter(p =>
                !(p.id === pedido.id && p.escenario === pedido.escenario)
              );
              return [...filtered, pedido];
            });

            if (onUpdate) {
              onUpdate(pedido);
            }
          } else if (payload.eventType === 'DELETE') {
            const oldPedido = payload.old as PedidoSupabase;
            setPedidos(prev => prev.filter(p =>
              !(p.id === oldPedido.id && p.escenario === oldPedido.escenario)
            ));
          }
        }
      )
      .subscribe((status) => {
        dbg('📡 Pedidos status:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [escenarioId, movilId]);

  return { pedidos, isConnected };
}

/**
 * Hook para suscribirse a cambios en empresas fleteras
 */
export function useEmpresasFleteras(
  escenarioId: number = 1,
  onUpdate?: (empresa: EmpresaFleteraSupabase) => void
) {
  const [empresas, setEmpresas] = useState<EmpresaFleteraSupabase[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    console.log('🔄 Iniciando suscripción a empresas fleteras...');

    const channel = supabase
      .channel('empresas-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'empresas_fleteras',
          filter: `escenario_id=eq.${escenarioId}`,
        },
        (payload) => {
          console.log('🏢 Cambio en empresas:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const empresa = payload.new as EmpresaFleteraSupabase;
            setEmpresas(prev => {
              const filtered = prev.filter(e => e.empresa_fletera_id !== empresa.empresa_fletera_id);
              return [...filtered, empresa];
            });

            if (onUpdate) {
              onUpdate(empresa);
            }
          } else if (payload.eventType === 'DELETE') {
            const oldEmpresa = payload.old as EmpresaFleteraSupabase;
            setEmpresas(prev => prev.filter(e => e.empresa_fletera_id !== oldEmpresa.empresa_fletera_id));
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Estado de suscripción empresas:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [escenarioId]);

  return { empresas, isConnected };
}

/**
 * Hook para escuchar cambios en tiempo real de pedidos pendientes.
 *
 * perf-round-3: los eventos Supabase Realtime se coalescen en un buffer debounced
 * (PEDIDOS_DEBOUNCE_MS). Cuando llegan múltiples eventos en ráfaga (ej. asignación
 * masiva), solo se emite UNA actualización del Map de state. Esto evita que el
 * dashboard dispare N renders consecutivos con N setMoviles().
 *
 * @param escenarioId - ID del escenario a monitorear
 * @param movilIds - Array de IDs de móviles a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización de pedido
 * @param onReconnect - Callback invocado cuando el canal reconecta tras una caída.
 * @param enabled - Si false, no se crea ningún channel y se limpian los existentes.
 *   Usado en modo histórico para pausar Realtime sin desmontar el hook.
 */
export function usePedidosRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (pedido: PedidoSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void,
  enabled: boolean = true
) {
  const [pedidos, setPedidos] = useState<Map<number, PedidoSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // lastEventAt: ms de epoch de la última novedad recibida por el WS.
  // El dashboard lo usa para detectar "silencio" del canal (feature admin).
  const [lastEventAt, setLastEventAt] = useState<number>(Date.now());
  const wasConnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  // perf-round-3 Fix 1: buffer debounced para coalescer eventos de pedidos.
  // En lugar de llamar setPedidos en cada evento (que dispara el useEffect del
  // dashboard que hace setMoviles), acumulamos cambios y los aplicamos juntos.
  // El flushRef guarda la función de flush actualizada (por closure) sin recrear el timer.
  const pendingPatchesRef = useRef<Array<{ type: 'upsert' | 'delete'; pedido: PedidoSupabase }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Modo histórico: no crear channels, limpiar estado pendiente.
    if (!enabled) {
      console.log('🔌 Realtime Pedidos pausado (modo histórico)');
      setIsConnected(false);
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
      return () => {};
    }

    console.log('🔄 Suscripción pedidos realtime - escenario:', escenarioId);
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

    // Función de flush: aplica todos los patches pendientes al Map y llama setPedidos UNA vez.
    const flushPending = () => {
      flushTimerRef.current = null;
      if (!isComponentMounted) return;
      const patches = pendingPatchesRef.current;
      if (patches.length === 0) return;
      pendingPatchesRef.current = [];

      setPedidos(prev => {
        const updated = new Map(prev);
        let changed = false;
        for (const patch of patches) {
          if (patch.type === 'upsert') {
            const existing = updated.get(patch.pedido.id);
            // Bail-out: si el objeto es idéntico (misma referencia o mismos campos clave),
            // no reemplazar para evitar invalidar el useMemo downstream.
            if (existing !== patch.pedido) {
              updated.set(patch.pedido.id, patch.pedido);
              changed = true;
            }
          } else {
            if (updated.has(patch.pedido.id)) {
              updated.delete(patch.pedido.id);
              changed = true;
            }
          }
        }
        // Fix 3 shallow merge: si ningún patch cambió nada, devolver la referencia anterior.
        return changed ? updated : prev;
      });
      setLastEventAt(Date.now());
    };

    // Encolar un patch y armar el timer de flush (si no existe ya).
    const enqueuePatch = (type: 'upsert' | 'delete', pedido: PedidoSupabase) => {
      pendingPatchesRef.current.push({ type, pedido });
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flushPending, PEDIDOS_DEBOUNCE_MS);
      }
      // Si ya hay timer pendiente, solo actualizamos el buffer — el timer existente
      // flusheará todos los patches acumulados al expirar.
    };

    const setupChannel = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      const channelName = `pedidos-realtime-${escenarioId}-${Date.now()}`;

      channel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'pedidos',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const newPedido = payload.new as PedidoSupabase;

            if (!movilIds || movilIds.length === 0 || (newPedido.movil && movilIds.includes(newPedido.movil))) {
              enqueuePatch('upsert', newPedido);
              if (onUpdate) onUpdate(newPedido, 'INSERT');
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'pedidos',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const updatedPedido = payload.new as PedidoSupabase;

            if (!movilIds || movilIds.length === 0 || (updatedPedido.movil && movilIds.includes(updatedPedido.movil))) {
              enqueuePatch('upsert', updatedPedido);
              if (onUpdate) onUpdate(updatedPedido, 'UPDATE');
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'pedidos',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const deletedPedido = payload.old as PedidoSupabase;
            enqueuePatch('delete', deletedPedido);
            if (onUpdate) onUpdate(deletedPedido, 'DELETE');
          }
        )
        .subscribe((status) => {
          if (!isComponentMounted) return;

          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            setLastEventAt(Date.now());
            console.log('✅ Conectado a Realtime Pedidos');
            // Si era una reconexión (no la primera vez), avisar para refetch
            if (wasConnectedRef.current && onReconnectRef.current) {
              console.log('🔄 Realtime Pedidos reconectado — solicitando refetch completo');
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            setError(`Error de conexión con Realtime Pedidos: ${status}`);
            console.warn(`⚠️ Error en suscripción de pedidos: ${status}. Reconectando...`);
            recordRealtimeFailure(`Pedidos:${status}`);
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) {
                console.log('🔄 Reconectando pedidos realtime...');
                setupChannel();
              }
            });
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción pedidos cerrada. Reconectando cuando vuelva visible...');
            recordRealtimeFailure('Pedidos:CLOSED');
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) setupChannel();
            });
          }
        });
    };

    setupChannel();

    return () => {
      isComponentMounted = false;
      if (reconnectHandle) reconnectHandle.cancel();
      if (channel) supabase.removeChannel(channel);
      // Cancelar el timer de flush pendiente para evitar setState tras unmount
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
    };
  }, [escenarioId, movilIds?.join(','), enabled]); // Recrear si cambian los móviles o enabled

  // perf: memoizar el array para que la referencia no cambie si el Map no cambió.
  // Sin esto, cada render del hook (por any state) crea un nuevo array → downstream
  // useMemos que dependen de pedidosCompletos se invalidan innecesariamente.
  const pedidosArray = useMemo(() => Array.from(pedidos.values()), [pedidos]);

  return {
    pedidos: pedidosArray,
    isConnected,
    error,
    lastEventAt,
  };
}

/**
 * Hook para escuchar cambios en services en tiempo real via Supabase Realtime.
 *
 * perf-round-3: misma estrategia de debounce que usePedidosRealtime — los eventos
 * se coalescen en PEDIDOS_DEBOUNCE_MS antes de actualizar el state.
 *
 * @param enabled - Si false, no se crea ningún channel. Usado en modo histórico.
 */
export function useServicesRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (service: ServiceSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void,
  enabled: boolean = true
) {
  const [services, setServices] = useState<Map<number, ServiceSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // lastEventAt: ms de epoch de la última novedad recibida por el WS.
  const [lastEventAt, setLastEventAt] = useState<number>(Date.now());
  const wasConnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  // perf-round-3 Fix 1: buffer debounced para coalescer eventos de services.
  const pendingPatchesRef = useRef<Array<{ type: 'upsert' | 'delete'; service: ServiceSupabase }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Modo histórico: no crear channels, limpiar estado pendiente.
    if (!enabled) {
      console.log('🔌 Realtime Services pausado (modo histórico)');
      setIsConnected(false);
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
      return () => {};
    }

    console.log('🔄 Suscripción services realtime - escenario:', escenarioId);
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

    const flushPending = () => {
      flushTimerRef.current = null;
      if (!isComponentMounted) return;
      const patches = pendingPatchesRef.current;
      if (patches.length === 0) return;
      pendingPatchesRef.current = [];

      setServices(prev => {
        const updated = new Map(prev);
        let changed = false;
        for (const patch of patches) {
          if (patch.type === 'upsert') {
            const existing = updated.get(patch.service.id);
            if (existing !== patch.service) {
              updated.set(patch.service.id, patch.service);
              changed = true;
            }
          } else {
            if (updated.has(patch.service.id)) {
              updated.delete(patch.service.id);
              changed = true;
            }
          }
        }
        // Fix 3 shallow merge: devolver referencia anterior si nada cambió.
        return changed ? updated : prev;
      });
      setLastEventAt(Date.now());
    };

    const enqueuePatch = (type: 'upsert' | 'delete', service: ServiceSupabase) => {
      pendingPatchesRef.current.push({ type, service });
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flushPending, PEDIDOS_DEBOUNCE_MS);
      }
    };

    const setupChannel = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      const channelName = `services-realtime-${escenarioId}-${Date.now()}`;

      channel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'services',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const newService = payload.new as ServiceSupabase;
            if (!movilIds || movilIds.length === 0 || (newService.movil && movilIds.includes(newService.movil))) {
              enqueuePatch('upsert', newService);
              if (onUpdate) onUpdate(newService, 'INSERT');
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'services',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const updatedService = payload.new as ServiceSupabase;
            if (!movilIds || movilIds.length === 0 || (updatedService.movil && movilIds.includes(updatedService.movil))) {
              enqueuePatch('upsert', updatedService);
              if (onUpdate) onUpdate(updatedService, 'UPDATE');
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'services',
            filter: `escenario=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            const deletedService = payload.old as ServiceSupabase;
            enqueuePatch('delete', deletedService);
            if (onUpdate) onUpdate(deletedService, 'DELETE');
          }
        )
        .subscribe((status) => {
          if (!isComponentMounted) return;

          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            setLastEventAt(Date.now());
            console.log('✅ Conectado a Realtime Services');
            if (wasConnectedRef.current && onReconnectRef.current) {
              console.log('🔄 Realtime Services reconectado — solicitando refetch completo');
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            setError(`Error de conexión con Realtime Services: ${status}`);
            console.warn(`⚠️ Error en suscripción de services: ${status}. Reconectando...`);
            recordRealtimeFailure(`Services:${status}`);
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) setupChannel();
            });
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción services cerrada. Reconectando cuando vuelva visible...');
            recordRealtimeFailure('Services:CLOSED');
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) setupChannel();
            });
          }
        });
    };

    setupChannel();

    return () => {
      isComponentMounted = false;
      if (reconnectHandle) reconnectHandle.cancel();
      if (channel) supabase.removeChannel(channel);
      // Cancelar el timer de flush pendiente para evitar setState tras unmount
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
    };
  }, [escenarioId, movilIds?.join(','), enabled]);

  // perf: memoizar el array para que la referencia no cambie si el Map no cambió.
  const servicesArray = useMemo(() => Array.from(services.values()), [services]);

  return {
    services: servicesArray,
    isConnected,
    error,
    lastEventAt,
  };
}
