/**
 * Hook para GET /api/metricas/dashboard (patrón `use-zona-capacidad-snapshot.ts`).
 *
 * Micro-cache con staleTime de 30s para no refetchear en cada re-render
 * cuando la clave (filtros) no cambió. No usa @tanstack/react-query porque
 * el repo no lo tiene instalado.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import type { MetricasDashboardData, Ventana, Dimension } from '@/types/metricas-dashboard';

export interface UseMetricasDashboardParams {
  /** ID de escenario. Si es null, el hook queda deshabilitado. */
  escenario: number | null;
  ventana: Ventana;
  dimension: Dimension;
  /** Período elegido; null = 1ra carga, la RPC resuelve el último disponible. */
  desde: string | null;
  hasta: string | null;
  /** null/[] = todos los tipos. */
  tipos: string[] | null;
  /** Empresa fletera elegida en el filtro (null = "Todas"). */
  empresaSel: number | null;
  // ─── Auth-scope del caller (enviados como headers) ─────────────────────
  isRoot: boolean;
  empresasIds: number[];
}

export interface UseMetricasDashboardResult {
  data: MetricasDashboardData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface CacheEntry {
  data: MetricasDashboardData;
  fetchedAt: number;
}

const STALE_TIME_MS = 30_000;
const _cache = new Map<string, CacheEntry>();

function buildCacheKey(p: UseMetricasDashboardParams): string {
  return [
    p.escenario,
    p.ventana,
    p.dimension,
    p.desde ?? '',
    p.hasta ?? '',
    (p.tipos ?? []).slice().sort().join(','),
    p.empresaSel ?? '',
    p.isRoot ? 'root' : p.empresasIds.slice().sort((a, b) => a - b).join(','),
  ].join('|');
}

async function fetchDashboard(p: UseMetricasDashboardParams, signal: AbortSignal): Promise<MetricasDashboardData> {
  const sp = new URLSearchParams();
  sp.set('escenario', String(p.escenario));
  sp.set('ventana', p.ventana);
  sp.set('dimension', p.dimension);
  if (p.desde) sp.set('desde', p.desde);
  if (p.hasta) sp.set('hasta', p.hasta);
  if (p.tipos && p.tipos.length > 0) sp.set('tipos', p.tipos.join(','));
  if (p.empresaSel != null) sp.set('empresa', String(p.empresaSel));

  const headers: Record<string, string> = {};
  if (p.isRoot) {
    headers['x-track-isroot'] = 'S';
  } else if (p.empresasIds.length > 0) {
    headers['x-track-empresas-ids'] = p.empresasIds.join(',');
  }

  const res = await fetch(`/api/metricas/dashboard?${sp.toString()}`, { method: 'GET', headers, signal });

  if (!res.ok) {
    let errorMsg = `metricas/dashboard: HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) errorMsg = body.error;
    } catch {
      // ignorar error de parseo del body de error
    }
    throw new Error(errorMsg);
  }

  const json = await res.json();
  return json.data as MetricasDashboardData;
}

export function useMetricasDashboard(params: UseMetricasDashboardParams): UseMetricasDashboardResult {
  const [data, setData] = useState<MetricasDashboardData | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const cacheKey = buildCacheKey(params);

  const refetch = () => {
    _cache.delete(cacheKey);
    setRefetchTrigger((n) => n + 1);
  };

  useEffect(() => {
    if (params.escenario == null) {
      setData(undefined);
      return;
    }

    const cached = _cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < STALE_TIME_MS) {
      setData(cached.data);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetchDashboard(params, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        _cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
        setData(result);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, refetchTrigger]);

  return { data, isLoading, error, refetch };
}
