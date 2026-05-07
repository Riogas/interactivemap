'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
 */
export function useGPSTracking(
  escenarioId: number = 1,
  movilIds?: string[],
  onUpdate?: (position: GPSTrackingSupabase) => void,
  onReconnect?: () => void
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
    console.log('🔄 Iniciando suscripción GPS Tracking...');
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

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
            filter: `escenario_id=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;

            dbg('📍 GPS INSERT:', (payload.new as any)?.movil_id);
            const newPosition = payload.new as GPSTrackingSupabase;

            // Filtrar por móvil si se especifica
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
            filter: `escenario_id=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;

            dbg('📍 GPS UPDATE:', (payload.new as any)?.movil_id);
            const updatedPosition = payload.new as GPSTrackingSupabase;

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
  }, [escenarioId, movilIds?.join(',')]); // Re-suscribir si cambian los filtros

  return { positions, isConnected, error };
}

/**
 * Hook para suscribirse a cambios en la tabla de móviles
 * @param escenarioId - ID del escenario a monitorear
 * @param empresaIds - Array de IDs de empresas a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización de móvil
 * @param onReconnect - Callback invocado cuando el canal reconecta tras una caída.
 *   El consumidor debe usarlo para hacer refetch del estado completo.
 */
export function useMoviles(
  escenarioId: number = 1,
  empresaIds?: number[],
  onUpdate?: (movil: MovilSupabase) => void,
  onReconnect?: () => void
) {
  const [moviles, setMoviles] = useState<MovilSupabase[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // wasConnectedRef: true después de la primera conexión exitosa.
  const wasConnectedRef = useRef(false);
  // onReconnectRef: mantiene siempre la versión más reciente sin forzar re-suscripción.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
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
  }, [escenarioId, empresaIds?.join(',')]);

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
 * Hook para suscribirse a cambios en tiempo real de pedidos pendientes
 * @param escenarioId - ID del escenario a monitorear
 * @param movilIds - Array de IDs de móviles a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización de pedido
 */
export function usePedidosRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (pedido: PedidoSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void
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

  useEffect(() => {
    console.log('🔄 Suscripción pedidos realtime - escenario:', escenarioId);
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

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
              setPedidos(prev => {
                const updated = new Map(prev);
                updated.set(newPedido.id, newPedido);
                return updated;
              });
              setLastEventAt(Date.now());
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
              setPedidos(prev => {
                const updated = new Map(prev);
                updated.set(updatedPedido.id, updatedPedido);
                return updated;
              });
              setLastEventAt(Date.now());
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

            setPedidos(prev => {
              const updated = new Map(prev);
              updated.delete(deletedPedido.id);
              return updated;
            });
            setLastEventAt(Date.now());
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
    };
  }, [escenarioId, movilIds?.join(',')]); // Recrear si cambian los móviles

  return {
    pedidos: Array.from(pedidos.values()),
    isConnected,
    error,
    lastEventAt,
  };
}

/**
 * Hook para escuchar cambios en services en tiempo real via Supabase Realtime
 */
export function useServicesRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (service: ServiceSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void
) {
  const [services, setServices] = useState<Map<number, ServiceSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // lastEventAt: ms de epoch de la última novedad recibida por el WS.
  // El dashboard lo usa para detectar "silencio" del canal (feature admin).
  const [lastEventAt, setLastEventAt] = useState<number>(Date.now());
  const wasConnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    console.log('🔄 Suscripción services realtime - escenario:', escenarioId);
    let channel: RealtimeChannel | null = null;
    let reconnectHandle: { cancel: () => void } | null = null;
    let isComponentMounted = true;
    const RETRY_DELAY = 5000;

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
              setServices(prev => {
                const updated = new Map(prev);
                updated.set(newService.id, newService);
                return updated;
              });
              setLastEventAt(Date.now());
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
              setServices(prev => {
                const updated = new Map(prev);
                updated.set(updatedService.id, updatedService);
                return updated;
              });
              setLastEventAt(Date.now());
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
            setServices(prev => {
              const updated = new Map(prev);
              updated.delete(deletedService.id);
              return updated;
            });
            setLastEventAt(Date.now());
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
    };
  }, [escenarioId, movilIds?.join(',')]);

  return {
    services: Array.from(services.values()),
    isConnected,
    error,
    lastEventAt,
  };
}
