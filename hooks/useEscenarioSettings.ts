import { useState, useEffect, useRef, useCallback } from 'react';

export type EscenarioSettings = {
  escenarioId: number;
  pedidosSaMinutosAntes: number | null;
};

const CACHE_TTL_MS = 60_000; // 60 segundos

type ApiResponse = {
  success: boolean;
  data?: EscenarioSettings;
  error?: string;
};

/**
 * Hook que lee los settings de un escenario desde la API y los cachea 60 segundos.
 *
 * Si escenarioId es null, no hace fetch y retorna settings=null.
 * Si no existe configuracion para el escenario, retorna { pedidosSaMinutosAntes: null }.
 *
 * Uso:
 *   const { settings } = useEscenarioSettings(escenarioId);
 *   const minutosAntes = settings?.pedidosSaMinutosAntes ?? null;
 */
export function useEscenarioSettings(escenarioId: number | null): {
  settings: EscenarioSettings | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
} {
  const [settings, setSettings] = useState<EscenarioSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const lastFetchRef = useRef<number>(0);
  const cacheRef = useRef<EscenarioSettings | null>(null);
  const fetchingRef = useRef<boolean>(false);

  const doFetch = useCallback(async (id: number, force: boolean) => {
    const now = Date.now();
    if (!force && cacheRef.current && (now - lastFetchRef.current) < CACHE_TTL_MS) {
      // Cache hit — ya tenemos datos frescos
      return;
    }
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/escenario-settings?escenarioId=${id}`, { cache: 'no-store' });
      const json: ApiResponse = await res.json();
      if (!json.success || !json.data) throw new Error(json.error ?? 'Error inesperado');
      cacheRef.current = json.data;
      lastFetchRef.current = Date.now();
      setSettings(json.data);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn('[useEscenarioSettings] fetch error:', err.message);
      setError(err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (escenarioId === null) {
      setSettings(null);
      return;
    }
    doFetch(escenarioId, false);

    // Revalidar periodicamente
    const timer = setInterval(() => {
      doFetch(escenarioId, true);
    }, CACHE_TTL_MS);

    return () => clearInterval(timer);
  }, [escenarioId, doFetch]);

  const refresh = useCallback(() => {
    if (escenarioId !== null) doFetch(escenarioId, true);
  }, [escenarioId, doFetch]);

  return { settings, loading, error, refresh };
}
