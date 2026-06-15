'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { recordRealtimeFailure } from '@/lib/realtime-health';
import { mapMovilDiaRowToMovilData } from '@/lib/moviles/moviles-dia-mapper';
import type { MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';
import type { MovilData } from '@/types/index';

const DEBOUNCE_MS = 250;

// Replica de scheduleReconnect de useRealtimeSubscriptions — misma semántica
// de visibilityState para evitar el loop CLOSED→reconnect→CLOSED en tabs background.
function scheduleReconnect(
  retryMs: number,
  fire: () => void,
): { cancel: () => void } {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    let staggerTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
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
 * Hook de suscripción realtime a `moviles_dia` para el dashboard.
 *
 * Solo activo cuando `isToday === true` y `escenarioId` es válido. Para fechas
 * históricas el canal NO se abre y se devuelve un array vacío.
 *
 * Los eventos INSERT/UPDATE se coalescen con debounce de DEBOUNCE_MS (mismo
 * que usePedidosRealtime / useServicesRealtime) para evitar renders en ráfaga.
 * Solo se propagan filas cuya columna `fecha` coincida con el parámetro `fecha`
 * (defensa client-side ante eventos de otros días en el canal).
 *
 * @param escenarioId - ID del escenario a monitorear.
 * @param fecha       - Fecha en formato 'YYYY-MM-DD' que coincide con today.
 * @param isToday     - Si false, el canal no se abre (modo histórico).
 * @param onReconnect - Callback invocado cuando el canal reconecta tras una
 *   caída. El consumidor debe usarlo para hacer refetch del estado completo.
 */
export function useMovilesDiaRealtime(
  escenarioId: number,
  fecha: string,
  isToday: boolean,
  onReconnect?: () => void,
) {
  const [updates, setUpdates] = useState<MovilData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number>(Date.now());

  const wasConnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  // Buffer debounced: acumula filas mapeadas; se vacía en un solo setUpdates.
  const pendingPatchesRef = useRef<Array<{ type: 'upsert'; movil: MovilData }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isToday || !escenarioId) {
      setIsConnected(false);
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
      return () => {};
    }

    console.log('🔄 Suscripción moviles_dia realtime - escenario:', escenarioId, 'fecha:', fecha);

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

      setUpdates(prev => {
        const updated = new Map<number, MovilData>(prev.map(m => [m.id, m]));
        let changed = false;
        for (const patch of patches) {
          const existing = updated.get(patch.movil.id);
          if (existing !== patch.movil) {
            updated.set(patch.movil.id, patch.movil);
            changed = true;
          }
        }
        return changed ? Array.from(updated.values()) : prev;
      });
      setLastEventAt(Date.now());
    };

    const enqueuePatch = (movil: MovilData) => {
      pendingPatchesRef.current.push({ type: 'upsert', movil });
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flushPending, DEBOUNCE_MS);
      }
    };

    const setupChannel = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      const channelName = `moviles-dia-realtime-${escenarioId}-${Date.now()}`;

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
            event: '*',
            schema: 'public',
            table: 'moviles_dia',
            filter: `escenario_id=eq.${escenarioId}`,
          },
          (payload) => {
            if (!isComponentMounted) return;
            if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;

            const row = payload.new as MovilDiaRow;

            // Defensa client-side: ignorar filas de otro día que lleguen por el canal.
            if (row.fecha !== fecha) return;

            enqueuePatch(mapMovilDiaRowToMovilData(row));
          }
        )
        .subscribe((status) => {
          if (!isComponentMounted) return;

          if (status === 'SUBSCRIBED') {
            setIsConnected(true);
            setError(null);
            setLastEventAt(Date.now());
            console.log('✅ Conectado a Realtime moviles_dia');
            if (wasConnectedRef.current && onReconnectRef.current) {
              console.log('🔄 Realtime moviles_dia reconectado — solicitando refetch completo');
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);
            setError(`Error de conexión con Realtime moviles_dia: ${status}`);
            console.warn(`⚠️ Error en suscripción moviles_dia: ${status}. Reconectando...`);
            recordRealtimeFailure(`MovilesDia:${status}`);
            reconnectHandle = scheduleReconnect(RETRY_DELAY, () => {
              if (isComponentMounted) {
                console.log('🔄 Reconectando moviles_dia realtime...');
                setupChannel();
              }
            });
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            console.log('🔌 Suscripción moviles_dia cerrada. Reconectando cuando vuelva visible...');
            recordRealtimeFailure('MovilesDia:CLOSED');
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
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingPatchesRef.current = [];
    };
  }, [escenarioId, fecha, isToday]);

  return {
    updates,
    isConnected,
    error,
    lastEventAt,
  };
}
