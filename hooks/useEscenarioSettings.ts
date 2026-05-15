import { useState, useEffect, useRef, useCallback } from 'react';

export type EscenarioSettings = {
  escenarioId: number;
  pedidosSaMinutosAntes: number | null;
  /** Si el escenario cubre servicio nocturno. Default true (conservativo). */
  aplicaServNocturno: boolean;
  /** Hora de inicio del periodo nocturno (HH:MM:SS). NULL = usar default (20:30). */
  horaIniNocturno: string | null;
  /** Hora de fin del periodo nocturno / inicio diurno (HH:MM:SS). NULL = usar default (06:00). */
  horaFinNocturno: string | null;
  /**
   * Peso de las zonas de transito en el prorrateo del lote del movil.
   * 1 = igual que prioridad, 0 = no aporta nada, 0.3 default = aporta ~30%.
   * Configurable solo por root.
   */
  pesoTransitoAlpha: number;
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
 * Si no existe configuracion para el escenario, retorna defaults seguros
 * ({ pedidosSaMinutosAntes: null, aplicaServNocturno: true, horaIniNocturno: null, horaFinNocturno: null, pesoTransitoAlpha: 0.3 }).
 *
 * Uso:
 *   const { settings } = useEscenarioSettings(escenarioId);
 *   const minutosAntes = settings?.pedidosSaMinutosAntes ?? null;
 *   const aplicaNocturno = settings?.aplicaServNocturno ?? true;
 *   const horaIni = settings?.horaIniNocturno ?? null;
 *   const horaFin = settings?.horaFinNocturno ?? null;
 *   const alpha = settings?.pesoTransitoAlpha ?? 0.3;
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
