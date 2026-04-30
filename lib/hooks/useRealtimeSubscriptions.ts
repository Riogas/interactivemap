'use client';

// Hooks Realtime — wrappers sobre createRealtimeHook. Cada hook define
// table/filter/idKey, mapea el shape al esperado por los consumers y mantiene
// la firma posicional histórica. Retry/backoff (1s..30s, MAX_RETRIES=5) vive
// en la factory.

import { useMemo } from 'react';
import { createRealtimeHook } from './createRealtimeHook';
import type {
  GPSTrackingSupabase,
  MovilSupabase,
  PedidoSupabase,
  ServiceSupabase,
  EmpresaFleteraSupabase,
} from '@/types';

// ── useGPSTracking ──────────────────────────────────────────────────────────

const useGPSTrackingFactory = createRealtimeHook<
  GPSTrackingSupabase,
  { escenarioId: number; movilIdsKey: string },
  'movil_id'
>({
  table: 'gps_latest_positions',
  channelPrefix: 'gps-latest',
  idKey: 'movil_id',
  events: ['INSERT', 'UPDATE'],
  filter: ({ escenarioId }) => `escenario_id=eq.${escenarioId}`,
  effectKey: ({ escenarioId, movilIdsKey }) => `gps:${escenarioId}:${movilIdsKey}`,
});

export function useGPSTracking(
  escenarioId: number = 1,
  movilIds?: string[],
  onUpdate?: (position: GPSTrackingSupabase) => void,
) {
  const movilIdsKey = movilIds?.join(',') ?? '';
  const allowed = useMemo(
    () => (movilIds ? new Set(movilIds) : null),
    [movilIdsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const result = useGPSTrackingFactory(
    { escenarioId, movilIdsKey },
    {
      onUpdate: (row) => {
        if (allowed && !allowed.has(row.movil_id)) return;
        if (onUpdate) onUpdate(row);
      },
    },
  );

  const positions = useMemo(() => {
    if (!allowed) return result.byId;
    const out = new Map<string, GPSTrackingSupabase>();
    result.byId.forEach((row, id) => { if (allowed.has(id)) out.set(id, row); });
    return out;
  }, [result.byId, allowed]);

  return { positions, isConnected: result.isConnected, error: result.error };
}

// ── useMoviles ──────────────────────────────────────────────────────────────

const useMovilesFactory = createRealtimeHook<
  MovilSupabase,
  { escenarioId: number; empresaIdsKey: string },
  'id'
>({
  table: 'moviles',
  channelPrefix: 'moviles-changes',
  idKey: 'id',
  events: ['*'],
  // El hook original no aplicaba filter por escenario; preservamos eso.
  filter: () => undefined,
  effectKey: ({ escenarioId, empresaIdsKey }) => `moviles:${escenarioId}:${empresaIdsKey}`,
});

export function useMoviles(
  escenarioId: number = 1,
  empresaIds?: number[],
  onUpdate?: (movil: MovilSupabase) => void,
) {
  const empresaIdsKey = empresaIds?.join(',') ?? '';
  const allowed = useMemo(
    () => (empresaIds ? new Set(empresaIds) : null),
    [empresaIdsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const result = useMovilesFactory(
    { escenarioId, empresaIdsKey },
    {
      onUpdate: (row, evt) => {
        if (evt === 'DELETE') return;
        if (allowed && !allowed.has(row.empresa_fletera_id)) return;
        if (onUpdate) onUpdate(row);
      },
    },
  );

  const moviles = useMemo(() => {
    if (!allowed) return result.data;
    return result.data.filter(m => allowed.has(m.empresa_fletera_id));
  }, [result.data, allowed]);

  return { moviles, isConnected: result.isConnected };
}

// ── usePedidos (legacy, demo) ───────────────────────────────────────────────
// Nota: el hook original construía filter `escenario_id=eq.${id}` aunque
// la columna real se llama `escenario`. Se preserva el comportamiento
// original en este PR de refactor (no fixeamos lógica de negocio acá).

const usePedidosFactory = createRealtimeHook<
  PedidoSupabase,
  { escenarioId: number; movilId: number | undefined },
  'id'
>({
  table: 'pedidos',
  channelPrefix: 'pedidos-changes',
  idKey: 'id',
  events: ['*'],
  filter: ({ escenarioId, movilId }) => {
    let f = `escenario_id=eq.${escenarioId}`;
    if (movilId) f += `,movil_id=eq.${movilId}`;
    return f;
  },
  effectKey: ({ escenarioId, movilId }) => `pedidos:${escenarioId}:${movilId ?? 'all'}`,
});

export function usePedidos(
  escenarioId: number = 1,
  movilId?: number,
  onUpdate?: (pedido: PedidoSupabase) => void,
) {
  const result = usePedidosFactory(
    { escenarioId, movilId },
    { onUpdate: (row, evt) => { if (evt !== 'DELETE' && onUpdate) onUpdate(row); } },
  );
  return { pedidos: result.data, isConnected: result.isConnected };
}

// ── useEmpresasFleteras ─────────────────────────────────────────────────────

const useEmpresasFletersFactory = createRealtimeHook<
  EmpresaFleteraSupabase,
  { escenarioId: number },
  'empresa_fletera_id'
>({
  table: 'empresas_fleteras',
  channelPrefix: 'empresas-changes',
  idKey: 'empresa_fletera_id',
  events: ['*'],
  filter: ({ escenarioId }) => `escenario_id=eq.${escenarioId}`,
  effectKey: ({ escenarioId }) => `empresas:${escenarioId}`,
});

export function useEmpresasFleteras(
  escenarioId: number = 1,
  onUpdate?: (empresa: EmpresaFleteraSupabase) => void,
) {
  const result = useEmpresasFletersFactory(
    { escenarioId },
    { onUpdate: (row, evt) => { if (evt !== 'DELETE' && onUpdate) onUpdate(row); } },
  );
  return { empresas: result.data, isConnected: result.isConnected };
}

// ── usePedidosRealtime / useServicesRealtime ────────────────────────────────
// Mismo patrón: filter por escenario, subset opcional de movilIds aplicado
// cliente-side, reconnectOnClosed, onReconnect en re-SUBSCRIBED, lastEventAt.

type RowWithMovil = { movil?: number | null };

function buildRtConfig<T extends RowWithMovil & Record<string, unknown>>(
  table: string,
  prefix: string,
) {
  return createRealtimeHook<T, { escenarioId: number; movilIdsKey: string }, 'id'>({
    table,
    channelPrefix: prefix,
    idKey: 'id' as keyof T & 'id',
    events: ['INSERT', 'UPDATE', 'DELETE'],
    filter: ({ escenarioId }) => `escenario=eq.${escenarioId}`,
    effectKey: ({ escenarioId, movilIdsKey }) => `${prefix}:${escenarioId}:${movilIdsKey}`,
    reconnectOnClosed: true,
  });
}

const usePedidosRealtimeFactory = buildRtConfig<PedidoSupabase>('pedidos', 'pedidos-realtime');
const useServicesRealtimeFactory = buildRtConfig<ServiceSupabase>('services', 'services-realtime');

function useMovilSubsetRealtime<T extends RowWithMovil & Record<string, unknown>>(
  factory: ReturnType<typeof buildRtConfig<T>>,
  escenarioId: number,
  movilIds: number[] | undefined,
  onUpdate?: (row: T, evt: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void,
) {
  const movilIdsKey = movilIds?.join(',') ?? '';
  const allowed = useMemo(
    () => (movilIds && movilIds.length > 0 ? new Set(movilIds) : null),
    [movilIdsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const result = factory(
    { escenarioId, movilIdsKey },
    {
      onUpdate: (row, evt) => {
        if (evt !== 'DELETE' && allowed && row.movil != null && !allowed.has(row.movil)) return;
        if (onUpdate) onUpdate(row, evt);
      },
      onReconnect,
    },
  );

  const data = useMemo(() => {
    if (!allowed) return result.data;
    return result.data.filter(r => r.movil != null && allowed.has(r.movil));
  }, [result.data, allowed]);

  return { data, isConnected: result.isConnected, error: result.error, lastEventAt: result.lastEventAt };
}

export function usePedidosRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (pedido: PedidoSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void,
) {
  const r = useMovilSubsetRealtime<PedidoSupabase>(
    usePedidosRealtimeFactory, escenarioId, movilIds, onUpdate, onReconnect,
  );
  return { pedidos: r.data, isConnected: r.isConnected, error: r.error, lastEventAt: r.lastEventAt };
}

export function useServicesRealtime(
  escenarioId: number = 1,
  movilIds?: number[],
  onUpdate?: (service: ServiceSupabase, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onReconnect?: () => void,
) {
  const r = useMovilSubsetRealtime<ServiceSupabase>(
    useServicesRealtimeFactory, escenarioId, movilIds, onUpdate, onReconnect,
  );
  return { services: r.data, isConnected: r.isConnected, error: r.error, lastEventAt: r.lastEventAt };
}
