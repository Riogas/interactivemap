'use client';

import { useEffect, useState, useRef } from 'react';

interface Options {
  enabled: boolean;
  graceMinutes: number;
}

/**
 * Devuelve un boolean `paused` que se vuelve true cuando el tab estuvo oculto
 * por más de `graceMinutes`. Vuelve a false ni bien el tab se vuelve visible.
 *
 * Caso típico: usuarios alternan tabs frecuentemente. Si el usuario vuelve
 * antes del grace period, el timer se cancela y nada se desconecta.
 * Si lleva idle largo rato, devuelve true y el caller debe pausar Realtime.
 *
 * Si `enabled === false`, siempre devuelve false (feature OFF).
 */
export function useRealtimePauseOnHidden({ enabled, graceMinutes }: Options): boolean {
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Feature OFF: cancelar timer pendiente y des-pausar si estaba pausado.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (paused) setPaused(false);
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Iniciar countdown si no había uno activo.
        if (timerRef.current === null) {
          const ms = Math.max(5, graceMinutes) * 60 * 1000;
          timerRef.current = setTimeout(() => {
            console.log(`[realtime-pause] Tab oculto >${graceMinutes}min — pausando Realtime`);
            setPaused(true);
            timerRef.current = null;
          }, ms);
        }
      } else {
        // Volvió visible: cancelar timer y des-pausar.
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (paused) {
          console.log('[realtime-pause] Tab visible — reconectando Realtime');
          setPaused(false);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Aplicar estado inicial (por si el tab ya está hidden al montar).
    handleVisibilityChange();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // paused intencionalmente fuera de deps para no reiniciar el effect cada vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, graceMinutes]);

  return paused;
}
