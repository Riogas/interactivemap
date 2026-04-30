'use client';

/**
 * createRealtimeHook
 * ──────────────────
 * Factory que genera un hook de Supabase Realtime con el patrón estándar
 * usado en TrackMovil:
 *
 *   - canal único por instancia (channelName = prefix-<deps>-<timestamp>-<rand>)
 *   - listeners postgres_changes para los eventos solicitados (INSERT/UPDATE/DELETE)
 *   - reconexión automática con backoff exponencial (1s..30s, default MAX_RETRIES=5)
 *   - reset del contador de retries en SUBSCRIBED
 *   - cleanup correcto en unmount: cancela timers, isComponentMounted=false,
 *     supabase.removeChannel
 *   - audit log via sendAuditBatch (mismo formato que el código original)
 *   - callback opcional de reconexión (se llama en SUBSCRIBED *después* del primero,
 *     útil para refetch full luego de un disconnect)
 *
 * El estado interno se materializa como un Map<id, row> y el hook devuelve
 * tanto el Map (para usos tipo `positions.size`/iteración por id) como un
 * array `data` (Array.from(map.values())) para consumidores que esperan lista.
 *
 * Esta factory NO absorbe transformaciones de shape (ej: agregar flags
 * computados a los rows); para eso, el hook concreto debe envolver el
 * resultado y mapear `data`/`byId` a su gusto.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { sendAuditBatch } from '@/lib/audit-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Activar solo en desarrollo para no serializar objetos en cada update de GPS
const DEBUG_REALTIME =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_DEBUG_REALTIME === '1';
const dbg = (...args: unknown[]) => {
  if (DEBUG_REALTIME) console.log(...args);
};

/**
 * Mapea el status crudo de Supabase a un evento semántico para el audit_log.
 */
function logRealtimeStatus(
  channelName: string,
  tableName: string,
  status: string,
  extra?: Record<string, unknown>,
) {
  const semantic =
    status === 'SUBSCRIBED' ? 'connected'
    : status === 'CLOSED' ? 'disconnected'
    : status === 'CHANNEL_ERROR' ? 'error'
    : status === 'TIMED_OUT' ? 'timeout'
    : status;

  sendAuditBatch([{
    event_type: 'realtime',
    endpoint: `realtime://${tableName}`,
    error: semantic === 'error' || semantic === 'timeout' ? status : undefined,
    extra: {
      channel: channelName,
      table: tableName,
      status,
      semantic,
      ...extra,
    },
  }]);
}

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeHookConfig<
  T extends Record<string, unknown>,
  Deps extends Record<string, unknown> = Record<string, unknown>,
  IdKey extends keyof T = keyof T,
> {
  /** Tabla postgres a escuchar. */
  table: string;
  /** Prefijo del nombre del canal — se completa con deps + timestamp + rand. */
  channelPrefix: string;
  /**
   * Construye el filter `postgres_changes` a partir de las deps. Si retorna
   * undefined, la suscripción no aplica filter (escucha toda la tabla).
   */
  filter: (deps: Deps) => string | undefined;
  /**
   * Calcula la "key" del effect: cualquier cambio en este string fuerza
   * cleanup + nuevo setup. Por default usa el filter; sobreescribir si las
   * deps incluyen variables que no van en el filter (ej: arrays de IDs).
   */
  effectKey?: (deps: Deps) => string;
  /** Atributo del row que actúa como id único en el Map. */
  idKey: IdKey;
  /** Eventos a escuchar. Default: ['*'] (INSERT, UPDATE y DELETE). */
  events?: ('*' | RealtimeEventType)[];
  /**
   * Filtro client-side opcional aplicado tras recibir el payload. Si retorna
   * false, el row no se incorpora al Map ni dispara onUpdate.
   * Útil cuando el backend filter no soporta IN (...) y hay que filtrar
   * por subconjunto de IDs.
   */
  shouldAccept?: (row: T, deps: Deps) => boolean;
  /** Cantidad máxima de reintentos en CHANNEL_ERROR/TIMED_OUT. Default: 5. */
  maxRetries?: number;
  /** Si true, mantiene los items previos en error en vez de limpiar el Map. Default: true. Reservado: la implementación actual siempre conserva. */
  keepOnError?: boolean;
  /**
   * Si true, además de re-suscribir en CLOSED (caída no-error), expone
   * onReconnect en el subscribe SUBSCRIBED siguiente. Default: false.
   * Los hooks que usan onReconnect (pedidos/services) lo activan.
   */
  reconnectOnClosed?: boolean;
}

export interface RealtimeHookResult<T, IdKey extends keyof T> {
  /** Lista plana de rows (Array.from(byId.values())). */
  data: T[];
  /** Map por idKey — preserva forma original para hooks legacy que dependían de `.size`. */
  byId: Map<T[IdKey], T>;
  /** Estado de la conexión Realtime. */
  isConnected: boolean;
  /** Mensaje de error si hubo CHANNEL_ERROR/TIMED_OUT/max retries. */
  error: string | null;
  /** ms de epoch del último evento Realtime (incluye SUBSCRIBED). */
  lastEventAt: number;
  /** Vacía el Map manualmente. */
  reset: () => void;
}

export interface UseRealtimeOptions<T> {
  /** Callback en cada cambio aceptado. */
  onUpdate?: (row: T, eventType: RealtimeEventType) => void;
  /**
   * Callback que se invoca en SUBSCRIBED tras una reconexión (no en la primera
   * suscripción). Útil para forzar refetch full luego de un disconnect.
   */
  onReconnect?: () => void;
}

export function createRealtimeHook<
  T extends Record<string, unknown>,
  Deps extends Record<string, unknown> = Record<string, unknown>,
  IdKey extends keyof T = keyof T,
>(
  config: RealtimeHookConfig<T, Deps, IdKey>,
): (deps: Deps, options?: UseRealtimeOptions<T>) => RealtimeHookResult<T, IdKey> {
  const MAX_RETRIES = config.maxRetries ?? 5;
  const events = config.events ?? ['*'];

  return function useRealtime(
    deps: Deps,
    options: UseRealtimeOptions<T> = {},
  ): RealtimeHookResult<T, IdKey> {
    const [byId, setById] = useState<Map<T[IdKey], T>>(() => new Map());
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastEventAt, setLastEventAt] = useState<number>(() => Date.now());

    const retryCountRef = useRef(0);
    const wasConnectedRef = useRef(false);

    // Refs para que cambios de callbacks no fuercen re-suscripción.
    const onUpdateRef = useRef(options.onUpdate);
    onUpdateRef.current = options.onUpdate;
    const onReconnectRef = useRef(options.onReconnect);
    onReconnectRef.current = options.onReconnect;
    const depsRef = useRef(deps);
    depsRef.current = deps;

    const filter = config.filter(deps);
    const effectKey = config.effectKey ? config.effectKey(deps) : (filter ?? '__none__');

    useEffect(() => {
      let channel: RealtimeChannel | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let isComponentMounted = true;

      const setupChannel = () => {
        if (!isComponentMounted) return;

        if (channel) {
          supabase.removeChannel(channel);
          channel = null;
        }

        const channelName = `${config.channelPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        let builder = supabase.channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
          },
        });

        const currentFilter = config.filter(depsRef.current);

        const handlePayload = (eventType: RealtimeEventType, payload: { new: unknown; old: unknown }) => {
          if (!isComponentMounted) return;
          const row = (eventType === 'DELETE' ? payload.old : payload.new) as T;
          if (!row) return;

          if (config.shouldAccept && !config.shouldAccept(row, depsRef.current)) {
            return;
          }

          dbg(`[realtime:${config.table}] ${eventType}`, row[config.idKey]);

          setById(prev => {
            const next = new Map(prev);
            const id = row[config.idKey];
            if (eventType === 'DELETE') {
              next.delete(id);
            } else {
              next.set(id, row);
            }
            return next;
          });
          setLastEventAt(Date.now());

          if (onUpdateRef.current) {
            onUpdateRef.current(row, eventType);
          }
        };

        for (const evt of events) {
          const filterCfg: Record<string, unknown> = {
            event: evt,
            schema: 'public',
            table: config.table,
          };
          if (currentFilter) filterCfg.filter = currentFilter;

          // postgres_changes acepta tanto '*' como evento específico; el callback
          // se ejecuta para todos los eventos cubiertos por esa subscripción.
          // Tipamos el .on con cast vía unknown porque el genérico de supabase-js
          // exige overloads complejos que no aportan seguridad acá.
          builder = (builder as unknown as {
            on: (
              ev: string,
              cfg: Record<string, unknown>,
              cb: (payload: { new: unknown; old: unknown; eventType: string }) => void,
            ) => RealtimeChannel;
          }).on('postgres_changes', filterCfg, (payload) => {
            const et = payload.eventType as RealtimeEventType | '*';
            if (et === 'INSERT' || et === 'UPDATE' || et === 'DELETE') {
              handlePayload(et, payload);
            }
          });
        }

        channel = builder.subscribe((status) => {
          if (!isComponentMounted) return;

          dbg(`[realtime:${config.table}] status:`, status);
          logRealtimeStatus(channelName, config.table, status, { effectKey });

          if (status === 'SUBSCRIBED') {
            retryCountRef.current = 0;
            setIsConnected(true);
            setError(null);
            setLastEventAt(Date.now());

            if (wasConnectedRef.current && onReconnectRef.current) {
              dbg(`[realtime:${config.table}] reconectado — invocando onReconnect`);
              onReconnectRef.current();
            }
            wasConnectedRef.current = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setIsConnected(false);

            if (retryCountRef.current < MAX_RETRIES && isComponentMounted) {
              retryCountRef.current++;
              const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
              setError(`Error de conexión Realtime (${config.table}): ${status}. Reintentando en ${Math.round(delay / 1000)}s (intento ${retryCountRef.current}/${MAX_RETRIES})`);
              reconnectTimer = setTimeout(() => {
                if (isComponentMounted) setupChannel();
              }, delay);
            } else {
              setError(`Error de conexión persistente con Realtime (${config.table}). Verifica tu red o Supabase.`);
              console.error(`[realtime:${config.table}] máximo de reintentos alcanzado`);
            }
          } else if (status === 'CLOSED') {
            setIsConnected(false);
            if (config.reconnectOnClosed && isComponentMounted) {
              // Reconexión sin contar contra MAX_RETRIES (CLOSED no es error
              // estrictamente — puede ser un cleanup de Supabase). Reusamos
              // el contador igual para evitar loops infinitos.
              if (retryCountRef.current < MAX_RETRIES) {
                retryCountRef.current++;
                const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
                reconnectTimer = setTimeout(() => {
                  if (isComponentMounted) setupChannel();
                }, delay);
              }
            }
          }
        });
      };

      setupChannel();

      return () => {
        isComponentMounted = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (channel) supabase.removeChannel(channel);
        wasConnectedRef.current = false;
        retryCountRef.current = 0;
      };
      // effectKey subsume todas las dependencias reactivas reales; el resto
      // (callbacks, deps no-filter) se accede vía refs.
    }, [effectKey]);

    const reset = useCallback(() => setById(new Map()), []);
    const data = Array.from(byId.values());

    return { data, byId, isConnected, error, lastEventAt, reset };
  };
}
