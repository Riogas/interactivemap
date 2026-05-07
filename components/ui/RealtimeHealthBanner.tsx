'use client';

import React from 'react';
import { dismissRealtimeReloadBanner, useRealtimeHealth } from '@/lib/realtime-health';

/**
 * Banner no-intrusivo que aparece cuando el monitor detecta inestabilidad
 * del Realtime (ver lib/realtime-health.ts). Permite al usuario recargar
 * la página o descartarlo manualmente.
 *
 * Se renderiza fixed en la parte superior central; no bloquea interacción.
 */
export default function RealtimeHealthBanner() {
  const { shouldReload } = useRealtimeHealth();

  if (!shouldReload) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[10050] pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-2.5 shadow-2xl backdrop-blur">
        <span className="text-lg" aria-hidden="true">⚠️</span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-amber-900">
            Conexión en tiempo real inestable
          </span>
          <span className="text-[11px] text-amber-700">
            Recargá la página para reestablecer la conexión.
          </span>
        </div>
        <div className="ml-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            Recargar
          </button>
          <button
            type="button"
            onClick={() => dismissRealtimeReloadBanner()}
            aria-label="Cerrar aviso"
            className="rounded-lg p-1.5 text-amber-700 transition-colors hover:bg-amber-200/60"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
