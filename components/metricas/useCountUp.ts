'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * true si el usuario tiene `prefers-reduced-motion: reduce`. Reactivo a
 * cambios en caliente (poco común, pero barato de soportar con matchMedia).
 * Colocado acá (en vez de un archivo aparte) porque useCountUp es el
 * consumidor principal y varios componentes de metricas/ ya importan de
 * este módulo para las animaciones (TrendChart/TipoBarChart/RankingList).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Anima un número desde 0 hasta `value` con easing cúbico (rAF), al montar
 * o cuando `value` cambia. Respeta prefers-reduced-motion (salta directo al
 * valor final, sin animar). `decimals` controla el redondeo mostrado.
 */
export function useCountUp(value: number | null | undefined, decimals: 0 | 1 = 0, durationMs = 900): number | null {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState<number | null>(reducedMotion ? (value ?? null) : 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      setDisplay(null);
      return;
    }
    if (reducedMotion) {
      setDisplay(value);
      return;
    }

    const target = value;
    let start: number | null = null;

    function step(ts: number) {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      setDisplay(decimals === 1 ? Math.round(current * 10) / 10 : Math.round(current));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, reducedMotion, durationMs, decimals]);

  return display;
}
