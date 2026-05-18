import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const TICK_INTERVAL_MS = 5_000; // 5 segundos — reducido de 1s para bajar re-renders 5x

/**
 * Hook que sincroniza el reloj del cliente con el servidor.
 *
 * Calcula el offset = serverTime - clientTime al montar y cada 5 min.
 * serverNow se actualiza cada 5s usando ese offset fijo,
 * para que los filtros de ventana temporal sean reactivos sin llamadas extra a la red.
 *
 * Mejora de performance: el tick se pausa cuando la pestaña está en background
 * (document.hidden === true) y se reanuda al volver, haciendo un setServerNow
 * inmediato para que el reloj no quede "atrasado" durante el periodo pausado.
 *
 * Uso:
 *   const { serverNow, offset, loading } = useServerTime();
 *   // En filtros: isWithinSaWindow(p.fch_hora_para, serverNow, minutosAntes)
 */
export function useServerTime(): { serverNow: Date; offset: number; loading: boolean } {
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [serverNow, setServerNow] = useState<Date>(() => new Date());
  const offsetRef = useRef<number>(0);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncOffset = useCallback(async () => {
    try {
      const clientBefore = Date.now();
      const res = await fetch('/api/server-time', { cache: 'no-store' });
      const clientAfter = Date.now();
      if (!res.ok) return;
      const { now: serverIso } = await res.json() as { now: string };
      const serverMs = new Date(serverIso).getTime();
      // Estimar hora de la respuesta: punto medio del round-trip
      const roundTripMs = clientAfter - clientBefore;
      const clientAtResponse = clientBefore + roundTripMs / 2;
      const newOffset = serverMs - clientAtResponse;
      offsetRef.current = newOffset;
      setOffset(newOffset);
      setServerNow(new Date(Date.now() + newOffset));
    } catch (e) {
      console.warn('[useServerTime] sync error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncOffset();

    // Refrescar offset cada 5 minutos
    refreshTimerRef.current = setInterval(syncOffset, REFRESH_INTERVAL_MS);

    // Tick cada 5s para mantener serverNow actualizado (reducido de 1s — 5x menos re-renders).
    // Pausa cuando la pestaña está en background; sync inmediato al volver.
    tickTimerRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setServerNow(new Date(Date.now() + offsetRef.current));
    }, TICK_INTERVAL_MS);

    // Al volver de background: actualizar serverNow inmediatamente para que el reloj
    // no quede "atrasado" durante el periodo que estuvo pausado.
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        setServerNow(new Date(Date.now() + offsetRef.current));
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [syncOffset]);

  return { serverNow, offset, loading };
}
