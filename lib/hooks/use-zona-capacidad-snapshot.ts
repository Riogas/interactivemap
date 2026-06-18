/**
 * Hook para el snapshot de capacidad por zona.
 *
 * Consume GET /api/zonas/capacidad-snapshot.
 * Implementa un micro-cache con staleTime de 30 segundos para evitar
 * refetches innecesarios, equivalente a React Query con staleTime: 30_000.
 * No se usa @tanstack/react-query porque el repo no lo tiene instalado.
 *
 * PR2 usará este hook para reemplazar el cálculo client-side de saturacionData.
 *
 * Uso básico:
 *   const { data, isLoading, refetch } = useZonaCapacidadSnapshot({
 *     escenario: 1,
 *     tipoServicio: 'PEDIDOS',
 *     isRoot: true,
 *     empresasIds: [],
 *     funcionalidades: ['Ped s/asignar x zona'],
 *   });
 *
 * Invalidación manual (ej. tras asignar un pedido en PR2):
 *   invalidateZonaCapacidadSnapshot();  // invalida TODAS las entradas del cache
 *
 * PR: PR1 — Backend zona-capacidad-snapshot
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ZonaCapSnapshot, TipoServicioSnapshot } from '@/types/zona-capacidad';

// =============================================================================
// Tipos
// =============================================================================

export interface UseZonaCapacidadSnapshotParams {
  /** ID de escenario. Si es null, el hook queda deshabilitado. */
  escenario: number | null;
  /** Tipo de servicio a consultar — uno de los 3 valores reales de BD. */
  tipoServicio: TipoServicioSnapshot;
  /**
   * Lista de zona_ids a consultar.
   * Si se omite, el endpoint devuelve todas las zonas del scope del caller.
   */
  zonas?: number[];
  /** Fecha "parado en el mapa" (YYYY-MM-DD). Define la ventana SA (hoy+ayer). Default: hoy. */
  fecha?: string;
  // ─── Auth-scope del caller (enviados como headers al endpoint) ────────────
  /** true si el usuario es root o despacho (sin restricción de empresa). */
  isRoot: boolean;
  /** IDs de empresas fleteras del scope. Vacío → fail-closed si !isRoot. */
  empresasIds: number[];
  /** Nombres de funcionalidades del caller (para "Ped s/asignar x zona"). */
  funcionalidades: string[];
  /**
   * Si false, el hook NO refetchea por invalidaciones realtime (solo mantiene su
   * último data). Útil para no agregar carga cuando la capa Cap. Entrega no está
   * visible. Default true. Las invalidaciones SIEMPRE limpian el cache global.
   */
  enabled?: boolean;
}

export interface UseZonaCapacidadSnapshotResult {
  data: ZonaCapSnapshot[] | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Fuerza re-fetch ignorando cache. */
  refetch: () => void;
}

// =============================================================================
// Cache de módulo (sobrevive re-renders, no mounts/unmounts del componente)
// =============================================================================

interface CacheEntry {
  data: ZonaCapSnapshot[];
  fetchedAt: number; // Date.now()
}

/** Stale time: 30 segundos */
const STALE_TIME_MS = 30_000;

// Clave → CacheEntry
const _cache = new Map<string, CacheEntry>();

// Listeners de invalidación: los hooks montados se suscriben para refetchear
// cuando algo invalida el cache (ej. llegan pedidos nuevos por realtime).
const _invalidationListeners = new Set<() => void>();

/** Construye la clave de cache a partir de los params. */
function buildCacheKey(
  escenario: number,
  tipoServicio: string,
  zonasKey: string,
  fecha: string,
): string {
  return [escenario, tipoServicio, zonasKey, fecha].join('|');
}

/**
 * Invalida todas las entradas del cache de zona-capacidad-snapshot Y notifica a
 * los hooks montados para que refetcheen (logra actualización "realtime" de la
 * capa Cap. Entrega cuando cambian pedidos por WebSocket).
 * Llamar tras asignar/desasignar pedidos, cambiar capacidad de móvil,
 * o cualquier evento que cambie la capacidad de las zonas.
 */
export function invalidateZonaCapacidadSnapshot(): void {
  _cache.clear();
  for (const listener of _invalidationListeners) {
    try { listener(); } catch { /* no romper el resto de listeners */ }
  }
}

// =============================================================================
// Fetch helper
// =============================================================================

async function fetchSnapshot(params: UseZonaCapacidadSnapshotParams): Promise<ZonaCapSnapshot[]> {
  if (!params.escenario) return [];

  const sp = new URLSearchParams();
  sp.set('escenario', String(params.escenario));
  sp.set('tipoServicio', params.tipoServicio);
  if (params.zonas && params.zonas.length > 0) sp.set('zonas', params.zonas.join(','));
  if (params.fecha) sp.set('fecha', params.fecha);

  const funcs = params.funcionalidades
    .map((f) => String(f).trim())
    .filter(Boolean)
    .join(',');
  const headers: Record<string, string> = {
    'x-track-funcs': funcs,
  };
  if (params.isRoot) {
    headers['x-track-isroot'] = 'S';
  } else if (params.empresasIds.length > 0) {
    headers['x-track-empresas-ids'] = params.empresasIds.join(',');
  }

  const res = await fetch(`/api/zonas/capacidad-snapshot?${sp.toString()}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    let errorMsg = `capacidad-snapshot: HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) errorMsg = body.error;
    } catch {
      // ignorar error de parseo del body de error
    }
    throw new Error(errorMsg);
  }

  const json = await res.json();
  return (json.data as ZonaCapSnapshot[]) ?? [];
}

// =============================================================================
// Hook principal
// =============================================================================

export function useZonaCapacidadSnapshot(
  params: UseZonaCapacidadSnapshotParams,
): UseZonaCapacidadSnapshotResult {
  const [data, setData] = useState<ZonaCapSnapshot[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Ref para cancelar fetch si el componente se desmonta mid-flight
  const abortRef = useRef<AbortController | null>(null);

  // Serializar arrays a strings estables para las deps del effect
  const zonasKey = useMemo(
    () => (params.zonas && params.zonas.length > 0 ? [...params.zonas].sort((a, b) => a - b).join(',') : 'all'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.zonas?.join(',')],
  );
  const empresasKey = useMemo(
    () => params.empresasIds.join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.empresasIds.join(',')],
  );
  const funcsKey = useMemo(
    () => params.funcionalidades.join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.funcionalidades.join(',')],
  );

  const refetch = useCallback(() => {
    if (params.escenario == null) return;
    const key = buildCacheKey(params.escenario, params.tipoServicio, zonasKey, params.fecha ?? '');
    _cache.delete(key);
    setRefetchTrigger((n) => n + 1);
  }, [params.escenario, params.tipoServicio, zonasKey, params.fecha]);

  // Suscribirse a invalidaciones globales: cuando algo invalida el cache (ej.
  // llegan pedidos por realtime), refetcheamos para que la capa Cap. Entrega se
  // actualice sin necesidad de cerrar/reabrir. El cache ya fue limpiado por
  // invalidateZonaCapacidadSnapshot(), así que el refetch va directo al server.
  // Solo se suscribe si enabled (la capa está visible) para no agregar carga.
  const enabled = params.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const onInvalidate = () => setRefetchTrigger((n) => n + 1);
    _invalidationListeners.add(onInvalidate);
    return () => { _invalidationListeners.delete(onInvalidate); };
  }, [enabled]);

  useEffect(() => {
    if (params.escenario == null) {
      setData(undefined);
      return;
    }

    const key = buildCacheKey(params.escenario, params.tipoServicio, zonasKey, params.fecha ?? '');
    const cached = _cache.get(key);
    const now = Date.now();

    // Cache hit válido (no stale)
    if (cached && now - cached.fetchedAt < STALE_TIME_MS) {
      setData(cached.data);
      setError(null);
      return;
    }

    // Cancelar fetch anterior si existe
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    fetchSnapshot(params)
      .then((result) => {
        if (abortRef.current?.signal.aborted) return;
        _cache.set(key, { data: result, fetchedAt: Date.now() });
        setData(result);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (abortRef.current?.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => {
      abortRef.current?.abort();
    };
  }, [
    params.escenario,
    params.tipoServicio,
    params.isRoot,
    params.fecha,
    zonasKey,
    empresasKey,
    funcsKey,
    refetchTrigger,
  ]);

  return { data, isLoading, error, refetch };
}
