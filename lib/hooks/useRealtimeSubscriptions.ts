'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { 
  GPSTrackingSupabase, 
  MovilSupabase, 
  PedidoSupabase,
  EmpresaFleteraSupabase 
} from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Hook para suscribirse a cambios en tiempo real de GPS tracking
 * @param escenarioId - ID del escenario a monitorear
 * @param movilIds - Array de IDs de móviles a filtrar (opcional)
 * @param onUpdate - Callback cuando se recibe una actualización
 */
export function useGPSTracking(
  escenarioId: number = 1,
  movilIds?: string[],
  onUpdate?: (position: GPSTrackingSupabase) => void
) {
  const [positions, setPositions] = useState<Map<string, GPSTrackingSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    console.log('🔄 Iniciando suscripción GPS Tracking...');
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isComponentMounted = true;

    const MAX_RETRIES = 5;
    const RETRY_DELAY = 3000; // 3 segundos

    const setupChannel = () => {
      // Limpiar canal anterior si existe
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      // Crear canal único con timestamp para evitar conflictos
      const channelName = `gps-tracking-${escenarioId}-${Date.now()}`;
      
      // Crear canal de Realtime
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
            table: 'gps_tracking_extended',
            filter: `escenario_id=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            
            console.log('📍 Nueva posición GPS recibida:', payload.new);
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
            table: 'gps_tracking_extended',
            filter: `escenario_id=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            
            console.log('📍 Posición GPS actualizada:', payload.new);
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
          
          console.log('📡 Estado de suscripción GPS:', status);
          
          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            setRetryCount(0); // Reset retry counter on success
            console.log('✅ Conectado a Realtime GPS Tracking');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            console.warn(`⚠️ Error en suscripción GPS: ${status}. Intento ${retryCount + 1}/${MAX_RETRIES}`);
            
            // Intentar reconectar automáticamente
            if (retryCount < MAX_RETRIES && isComponentMounted) {
              console.log(`🔄 Reconectando... (intento ${retryCount + 1}/${MAX_RETRIES})`);
              setRetryCount(prev => prev + 1);
              
              // Programar reconexión
              reconnectTimer = setTimeout(() => {
                if (isComponentMounted) {
                  console.log('🔄 Intentando reconectar...');
                  setupChannel();
                }
              }, RETRY_DELAY);
            } else if (retryCount >= MAX_RETRIES) {
              setError('Error de conexión persistente. Verifica tu red o Supabase.');
              console.error('❌ Máximo de reintentos alcanzado');
            }
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción GPS cerrada');
          }
        });
    };

    // Iniciar primera conexión
    setupChannel();

    // Cleanup
    return () => {
      console.log('🧹 Limpiando suscripción GPS...');
      isComponentMounted = false;
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      
      if (channel) {
        supabase.removeChannel(channel);
      }
      
      setIsConnected(false);
    };
  }, [escenarioId, movilIds?.join(',')]); // Re-suscribir si cambian los filtros

  return { positions, isConnected, error };
}

/**
 * Hook para suscribirse a cambios en la tabla de móviles
 */
export function useMoviles(
  escenarioId: number = 1,
  empresaIds?: number[],
  onUpdate?: (movil: MovilSupabase) => void
) {
  const [moviles, setMoviles] = useState<MovilSupabase[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    console.log('🔄 Iniciando suscripción a móviles...');
    
    const channel = supabase
      .channel('moviles-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'moviles',
        },
        (payload) => {
          console.log('🚗 Cambio en móviles:', payload);
          
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
        console.log('📡 Estado de suscripción móviles:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
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
          console.log('📦 Cambio en pedidos:', payload);
          
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
        console.log('📡 Estado de suscripción pedidos:', status);
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
  onUpdate?: (pedido: PedidoSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
) {
  const [pedidos, setPedidos] = useState<Map<number, PedidoSupabase>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('🔄 Iniciando suscripción a pedidos pendientes...', {
      escenarioId,
      movilIds,
      hasMovilFilter: movilIds && movilIds.length > 0
    });
    let channel: RealtimeChannel | null = null;

    const setupChannel = () => {
      const channelName = `pedidos-realtime-${escenarioId}-${Date.now()}`;
      
      console.log(`📡 Creando canal de Realtime: ${channelName}`);
      
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
            console.log('📦 Nuevo pedido recibido:', payload.new);
            const newPedido = payload.new as PedidoSupabase;
            
            // Filtrar por móvil si se especifica (o mostrar todos si no hay filtro)
            if (!movilIds || movilIds.length === 0 || (newPedido.movil && movilIds.includes(newPedido.movil))) {
              // Agregar todos los pedidos (con o sin coordenadas)
              setPedidos(prev => {
                const updated = new Map(prev);
                updated.set(newPedido.id, newPedido);
                return updated;
              });
              
              if (onUpdate) {
                onUpdate(newPedido, 'INSERT');
              }
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
            console.log('📦 Pedido actualizado:', payload.new);
            const updatedPedido = payload.new as PedidoSupabase;
            
            // Filtrar por móvil si se especifica (o mostrar todos si no hay filtro)
            if (!movilIds || movilIds.length === 0 || (updatedPedido.movil && movilIds.includes(updatedPedido.movil))) {
              setPedidos(prev => {
                const updated = new Map(prev);
                // Actualizar el pedido (con o sin coordenadas)
                updated.set(updatedPedido.id, updatedPedido);
                return updated;
              });
              
              if (onUpdate) {
                onUpdate(updatedPedido, 'UPDATE');
              }
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
            console.log('📦 Pedido eliminado:', payload.old);
            const deletedPedido = payload.old as PedidoSupabase;
            
            setPedidos(prev => {
              const updated = new Map(prev);
              updated.delete(deletedPedido.id);
              return updated;
            });
            
            if (onUpdate) {
              onUpdate(deletedPedido, 'DELETE');
            }
          }
        )
        .subscribe((status) => {
          console.log('📡 Estado de suscripción pedidos:', status);
          
          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            console.log('✅ Conectado a Realtime Pedidos');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            const errorMsg = `Error de conexión con Realtime Pedidos: ${status}`;
            setError(errorMsg);
            console.error('❌ Error en suscripción de pedidos:', status);
            console.error('💡 Verifica que Realtime esté habilitado en Supabase para la tabla pedidos');
            console.error('💡 Ejecuta: ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;');
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción pedidos cerrada');
          }
        });
    };

    setupChannel();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [escenarioId, movilIds?.join(',')]); // Recrear si cambian los móviles

  return { 
    pedidos: Array.from(pedidos.values()), 
    isConnected, 
    error 
  };
}
