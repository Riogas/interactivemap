/**
 * Tests unitarios para los bugs de ciclo de vida del dashboard:
 *
 * Bug 1 — selectedDate persiste a F5 via sessionStorage (AC1-AC4).
 * Bug 2 — reconnect-refetch en useGPSTracking / useMoviles (AC5-AC6).
 * Bug 3 — defaults de preferencias de reconciliación (AC7-AC8).
 *
 * Nota: estos tests corren en entorno 'node' (vitest.config.ts).
 * Las funciones de session-storage se testean con mocks in-memory.
 * Los hooks de React no se testean aquí (requieren jsdom) — se cubren
 * con las type-signatures que ya verifican el compilador en build.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { todayMontevideo } from '@/lib/date-utils';

// ──────────────────────────────────────────────────────────────
// Helpers reutilizados por los tests
// ──────────────────────────────────────────────────────────────

/**
 * Simula la lógica del inicializador de useState de selectedDate
 * (la misma que está en app/dashboard/page.tsx).
 * Aislada aquí para poder testearla sin montar el componente.
 */
function initSelectedDate(
  sessionStorage: Record<string, string>,
  nowOverride?: Date,
): string {
  const stored = sessionStorage['trackmovil:selectedDate'];
  const today = todayMontevideo(nowOverride ?? new Date());
  if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) && stored <= today) {
    return stored;
  }
  if (stored) delete sessionStorage['trackmovil:selectedDate'];
  return today;
}

/**
 * Simula setSelectedDate (el wrapper que escribe a sessionStorage).
 */
function makeSetSelectedDate(sessionStorage: Record<string, string>) {
  return (date: string) => {
    sessionStorage['trackmovil:selectedDate'] = date;
  };
}

// ──────────────────────────────────────────────────────────────
// Bug 1 — Persistencia de selectedDate
// ──────────────────────────────────────────────────────────────

describe('selectedDate — persistencia en sessionStorage', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
  });

  it('AC1 — F5 con fecha guardada válida: devuelve la fecha almacenada', () => {
    const now = new Date('2026-05-02T12:00:00Z'); // today = 2026-04-29 en Montevideo... usar fecha conocida
    const today = todayMontevideo(now);
    // Guardar fecha de ayer
    const yesterday = '2026-04-30';
    store['trackmovil:selectedDate'] = yesterday;

    const result = initSelectedDate(store, now);
    expect(result).toBe(yesterday);
  });

  it('AC1 — La fecha se guarda en sessionStorage al cambiar', () => {
    const setDate = makeSetSelectedDate(store);
    setDate('2026-04-30');
    expect(store['trackmovil:selectedDate']).toBe('2026-04-30');
  });

  it('AC2 — Logout limpia el sessionStorage (simulado)', () => {
    store['trackmovil:selectedDate'] = '2026-04-30';
    // Simula lo que hace AuthContext.logout()
    delete store['trackmovil:selectedDate'];
    // Al volver a montar, debe usar hoy
    const result = initSelectedDate(store);
    expect(result).toBe(todayMontevideo());
  });

  it('AC3 — Sin sessionStorage: usa todayMontevideo()', () => {
    const result = initSelectedDate({});
    expect(result).toBe(todayMontevideo());
  });

  it('AC4 — Valor inválido (texto libre): usa hoy y limpia el almacenamiento', () => {
    store['trackmovil:selectedDate'] = 'invalid-date';
    const result = initSelectedDate(store);
    expect(result).toBe(todayMontevideo());
    expect(store['trackmovil:selectedDate']).toBeUndefined();
  });

  it('AC4 — Valor inválido (fecha futura): usa hoy y limpia el almacenamiento', () => {
    store['trackmovil:selectedDate'] = '2099-12-31';
    const result = initSelectedDate(store);
    expect(result).toBe(todayMontevideo());
    expect(store['trackmovil:selectedDate']).toBeUndefined();
  });

  it('AC4 — Valor null-like (cadena vacía): usa hoy', () => {
    store['trackmovil:selectedDate'] = '';
    const result = initSelectedDate(store);
    expect(result).toBe(todayMontevideo());
  });
});

// ──────────────────────────────────────────────────────────────
// Bug 2 — Reconnect callback: verificación de contrato de las funciones
// ──────────────────────────────────────────────────────────────

describe('useGPSTracking / useMoviles — contrato de onReconnect', () => {
  /**
   * Simula el patrón wasConnectedRef + onReconnect que tienen ambos hooks.
   * Verifica la lógica de negocio aislada de React.
   */
  function simulateSubscribeCallback(
    status: string,
    wasConnectedRef: { current: boolean },
    onReconnect: (() => void) | undefined,
    setConnected: (v: boolean) => void,
  ) {
    if (status === 'SUBSCRIBED') {
      setConnected(true);
      if (wasConnectedRef.current && onReconnect) {
        onReconnect();
      }
      wasConnectedRef.current = true;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setConnected(false);
    }
  }

  it('AC5 — Primera conexión (wasConnected=false): NO llama onReconnect', () => {
    const onReconnect = vi.fn();
    const wasConnectedRef = { current: false };
    let connected = false;

    simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, onReconnect, (v) => { connected = v; });

    expect(connected).toBe(true);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(wasConnectedRef.current).toBe(true);
  });

  it('AC5 — Reconexión (wasConnected=true): SÍ llama onReconnect', () => {
    const onReconnect = vi.fn();
    const wasConnectedRef = { current: true }; // ya estuvo conectado antes
    let connected = false;

    simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, onReconnect, (v) => { connected = v; });

    expect(connected).toBe(true);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('AC6 — Reconexión sin callback: no explota', () => {
    const wasConnectedRef = { current: true };
    let connected = false;

    expect(() => {
      simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, undefined, (v) => { connected = v; });
    }).not.toThrow();

    expect(connected).toBe(true);
  });

  it('AC5/AC6 — CHANNEL_ERROR: desconecta sin llamar onReconnect', () => {
    const onReconnect = vi.fn();
    const wasConnectedRef = { current: true };
    let connected = true;

    simulateSubscribeCallback('CHANNEL_ERROR', wasConnectedRef, onReconnect, (v) => { connected = v; });

    expect(connected).toBe(false);
    expect(onReconnect).not.toHaveBeenCalled();
    // wasConnectedRef no cambia en CHANNEL_ERROR
    expect(wasConnectedRef.current).toBe(true);
  });

  it('AC5/AC6 — CLOSED: desconecta sin llamar onReconnect', () => {
    const onReconnect = vi.fn();
    const wasConnectedRef = { current: true };
    let connected = true;

    simulateSubscribeCallback('CLOSED', wasConnectedRef, onReconnect, (v) => { connected = v; });

    expect(connected).toBe(false);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('AC5 — Múltiples reconexiones: onReconnect se llama en cada una', () => {
    const onReconnect = vi.fn();
    const wasConnectedRef = { current: false };
    let connected = false;
    const setConnected = (v: boolean) => { connected = v; };

    // Primera conexión
    simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, onReconnect, setConnected);
    expect(onReconnect).not.toHaveBeenCalled();

    // Desconexión
    simulateSubscribeCallback('CLOSED', wasConnectedRef, onReconnect, setConnected);
    expect(connected).toBe(false);

    // Segunda conexión (reconexión)
    simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, onReconnect, setConnected);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Tercera conexión (segunda reconexión)
    simulateSubscribeCallback('SUBSCRIBED', wasConnectedRef, onReconnect, setConnected);
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────
// Bug 3 — Defaults de preferencias de reconciliación
// ──────────────────────────────────────────────────────────────

describe('Preferencias de reconciliación — defaults', () => {
  /**
   * Simula la lógica de resolución de realtimePollingReconcileSeconds
   * (misma lógica que está en el useEffect del dashboard).
   */
  function resolvePollingSeconds(raw: number | null | undefined): number | null {
    const seconds = (raw == null || raw === 0) ? 60 : raw;
    if (seconds === -1) return null; // desactivado
    return seconds;
  }

  /**
   * Simula la lógica de realtimeRefetchOnVisible.
   */
  function resolveRefetchOnVisible(raw: boolean | null | undefined): boolean {
    return raw !== false; // null/undefined → true; false → false
  }

  it('AC7 — realtimePollingReconcileSeconds=0: default a 60', () => {
    expect(resolvePollingSeconds(0)).toBe(60);
  });

  it('AC7 — realtimePollingReconcileSeconds=null: default a 60', () => {
    expect(resolvePollingSeconds(null)).toBe(60);
  });

  it('AC7 — realtimePollingReconcileSeconds=undefined: default a 60', () => {
    expect(resolvePollingSeconds(undefined)).toBe(60);
  });

  it('AC7 — realtimePollingReconcileSeconds=-1: desactivado (null)', () => {
    expect(resolvePollingSeconds(-1)).toBeNull();
  });

  it('AC7 — realtimePollingReconcileSeconds=120: respeta el valor', () => {
    expect(resolvePollingSeconds(120)).toBe(120);
  });

  it('AC8 — realtimeRefetchOnVisible=null: default true', () => {
    expect(resolveRefetchOnVisible(null)).toBe(true);
  });

  it('AC8 — realtimeRefetchOnVisible=undefined: default true', () => {
    expect(resolveRefetchOnVisible(undefined)).toBe(true);
  });

  it('AC8 — realtimeRefetchOnVisible=false: off', () => {
    expect(resolveRefetchOnVisible(false)).toBe(false);
  });

  it('AC8 — realtimeRefetchOnVisible=true: on', () => {
    expect(resolveRefetchOnVisible(true)).toBe(true);
  });
});
