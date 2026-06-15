'use client';

import { useEffect, useState } from 'react';

/**
 * Devuelve true si el usuario tiene activada la preferencia del sistema
 * "reducir movimiento" (prefers-reduced-motion: reduce).
 *
 * Se usa para apagar animaciones decorativas (pulsos/ripples de markers) y
 * respetar accesibilidad. SSR-safe: arranca en false hasta montar.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // addEventListener moderno; fallback a addListener para navegadores viejos.
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }, []);

  return reduced;
}
