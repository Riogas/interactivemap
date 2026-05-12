'use client';

import React from 'react';
import { dismissRealtimeReloadBanner, useRealtimeHealth } from '@/lib/realtime-health';

/**
 * Banner no-intrusivo que aparece cuando el monitor detecta inestabilidad
 * del Realtime (ver lib/realtime-health.ts).
 *
 * Tres estados:
 * 1. Idle: no renderiza nada (sin problemas).
 * 2. Auto-reload pending: toast pequeño "Reconectando..." con spinner, sin botones.
 * 3. Circuit-breaker fallback: banner con botón Recargar y X, más texto explicativo.
 */
export default function RealtimeHealthBanner() {
  const { shouldReload, autoReloadPending, circuitBreakerActive } = useRealtimeHealth();

  if (!shouldReload && !autoReloadPending) return null;

  if (autoReloadPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[10050] pointer-events-none"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 shadow-xl backdrop-blur">
          <svg
            className="h-4 w-4 animate-spin text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm font-medium text-amber-900">Reconectando...</span>
        </div>
      </div>
    );
  }

  if (circuitBreakerActive) {
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
              Recargas automáticas deshabilitadas tras 3 intentos. Recargá manualmente.
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

  return null;
}
