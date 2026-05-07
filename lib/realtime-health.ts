'use client';

import { useEffect, useState } from 'react';

/**
 * Monitor liviano de salud del Realtime: cuenta cuántos cierres/errores de
 * suscripción ocurrieron en los últimos N segundos. Si supera el umbral, expone
 * un flag `shouldReload` para que la UI muestre un banner sugiriendo recargar.
 *
 * Diseño:
 *  - Singleton a nivel de módulo (todas las suscripciones comparten contador).
 *  - Ventana móvil de 60 segundos.
 *  - Umbral: 8 cierres en la ventana → recomendar recarga.
 *  - Cuando el flag se prende, queda prendido hasta que el usuario lo descarte
 *    o recargue (no se apaga automáticamente — si está mal, el usuario decide).
 *  - dismiss() apaga el flag y resetea el contador.
 *
 * Uso:
 *  - Las suscripciones llaman `recordRealtimeFailure()` en CLOSED/CHANNEL_ERROR.
 *  - El componente `RealtimeHealthBanner` consume `useRealtimeHealth()`.
 */

const WINDOW_MS = 60_000;
const THRESHOLD = 8;

const recentFailures: number[] = [];
const listeners = new Set<() => void>();
let shouldReload = false;
let dismissedAt: number | null = null;
const DISMISS_COOLDOWN_MS = 5 * 60_000; // tras dismiss, esperar 5min antes de re-mostrar

function notify(): void {
  for (const fn of listeners) fn();
}

function recompute(now: number): void {
  // Si el usuario descartó hace poco, no re-mostrar aunque haya fallas
  if (dismissedAt !== null && now - dismissedAt < DISMISS_COOLDOWN_MS) {
    if (shouldReload) {
      shouldReload = false;
      notify();
    }
    return;
  }
  // Limpiar fallas viejas fuera de la ventana
  while (recentFailures.length > 0 && now - recentFailures[0] > WINDOW_MS) {
    recentFailures.shift();
  }
  const next = recentFailures.length >= THRESHOLD;
  if (next !== shouldReload) {
    shouldReload = next;
    notify();
  }
}

export function recordRealtimeFailure(reason?: string): void {
  const now = Date.now();
  recentFailures.push(now);
  if (reason && process.env.NODE_ENV === 'development') {
    console.log(`📉 RealtimeHealth: failure registrado (${reason}), total en ventana: ${recentFailures.length}`);
  }
  recompute(now);
}

export function dismissRealtimeReloadBanner(): void {
  dismissedAt = Date.now();
  recentFailures.length = 0;
  if (shouldReload) {
    shouldReload = false;
    notify();
  }
}

export function useRealtimeHealth(): { shouldReload: boolean } {
  const [v, setV] = useState({ shouldReload });
  useEffect(() => {
    const handler = () => setV({ shouldReload });
    listeners.add(handler);
    // Sync inicial por si el flag ya estaba prendido cuando montamos
    handler();
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return v;
}
