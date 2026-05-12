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

const AUTO_RELOAD_MAX_PER_WINDOW = 3;
const AUTO_RELOAD_WINDOW_MS = 10 * 60_000;
const AUTO_RELOAD_DELAY_MS = 2000;
const AUTO_RELOAD_HEALTHY_RESET_MS = 30_000;
const STORAGE_KEY = 'trackmovil:rt-auto-reload-count';

interface ReloadCounter {
  count: number;
  firstAt: number;
}

function getReloadCounter(): ReloadCounter {
  try {
    if (typeof sessionStorage === 'undefined') return { count: 0, firstAt: 0 };
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { count: 0, firstAt: 0 };
    const parsed = JSON.parse(raw) as ReloadCounter;
    if (Date.now() - parsed.firstAt > AUTO_RELOAD_WINDOW_MS) return { count: 0, firstAt: 0 };
    return parsed;
  } catch {
    return { count: 0, firstAt: 0 };
  }
}

function setReloadCounter(c: ReloadCounter): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    }
  } catch {}
}

const recentFailures: number[] = [];
const listeners = new Set<() => void>();
let shouldReload = false;
let autoReloadPending = false;
let dismissedAt: number | null = null;
const DISMISS_COOLDOWN_MS = 5 * 60_000; // tras dismiss, esperar 5min antes de re-mostrar

function notify(): void {
  for (const fn of listeners) fn();
}

function notifyAutoReloadStarted(): void {
  autoReloadPending = true;
  notify();
}

export function shouldShowManualBanner(): boolean {
  return getReloadCounter().count >= AUTO_RELOAD_MAX_PER_WINDOW;
}

export function triggerAutoReload(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  if (shouldShowManualBanner()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        triggerAutoReload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return;
  }
  const c = getReloadCounter();
  const next: ReloadCounter = c.count === 0
    ? { count: 1, firstAt: Date.now() }
    : { count: c.count + 1, firstAt: c.firstAt };
  setReloadCounter(next);
  notifyAutoReloadStarted();
  autoReloadTimeoutId = setTimeout(() => {
    window.location.reload();
  }, AUTO_RELOAD_DELAY_MS);
}

let healthyResetTimer: ReturnType<typeof setTimeout> | null = null;
let autoReloadTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function scheduleHealthyReset(): void {
  if (typeof window === 'undefined') return;
  if (healthyResetTimer) clearTimeout(healthyResetTimer);
  healthyResetTimer = setTimeout(() => {
    if (recentFailures.length === 0) {
      setReloadCounter({ count: 0, firstAt: 0 });
    }
  }, AUTO_RELOAD_HEALTHY_RESET_MS);
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
    if (next) {
      if (!shouldShowManualBanner()) {
        triggerAutoReload();
      }
    }
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
  if (autoReloadTimeoutId !== null) {
    clearTimeout(autoReloadTimeoutId);
    autoReloadTimeoutId = null;
  }
  if (shouldReload || autoReloadPending) {
    shouldReload = false;
    autoReloadPending = false;
    notify();
  }
}

export function useRealtimeHealth(): {
  shouldReload: boolean;
  autoReloadPending: boolean;
  circuitBreakerActive: boolean;
} {
  const [v, setV] = useState({
    shouldReload,
    autoReloadPending,
    circuitBreakerActive: shouldShowManualBanner(),
  });
  useEffect(() => {
    const handler = () =>
      setV({
        shouldReload,
        autoReloadPending,
        circuitBreakerActive: shouldShowManualBanner(),
      });
    listeners.add(handler);
    handler();
    scheduleHealthyReset();
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return v;
}
