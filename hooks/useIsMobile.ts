'use client';

import { useEffect, useState } from 'react';

/**
 * True cuando el viewport es "mobile" (<= maxWidthPx). SSR-safe: false en server
 * y en el primer render; se resuelve en useEffect y reacciona a resize/rotación.
 */
export function useIsMobile(maxWidthPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // addEventListener moderno con fallback a addListener (Safari viejo)
    if (mql.addEventListener) mql.addEventListener('change', update);
    else mql.addListener(update);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update);
      else mql.removeListener(update);
    };
  }, [maxWidthPx]);

  return isMobile;
}
