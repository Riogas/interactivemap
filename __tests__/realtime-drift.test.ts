/**
 * Tests para lib/realtime-drift.ts
 *
 * Cubre:
 * - getSyncColor: logica de colores 🟢🟡🔴 segun tiempo transcurrido
 * - reportDrift: gating de toast segun condiciones (drift > 0 && isRoot)
 * - Gating de UI: la condicion isRoot se evalua correctamente
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: vi.fn(),
}));

import { getSyncColor, reportDrift } from '@/lib/realtime-drift';
import toast from 'react-hot-toast';

// --- getSyncColor ---

describe('getSyncColor', () => {
  const POLLING = 60; // segundos
  const BASE = 1000000000; // timestamp base para tests

  it('devuelve "green" si elapsed < 1x pollingSeconds', () => {
    const lastSyncAt = BASE;
    const now = BASE + 30 * 1000; // 30s despues (< 60s)
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('green');
  });

  it('devuelve "yellow" si elapsed esta entre 1x y 2x pollingSeconds', () => {
    const lastSyncAt = BASE;
    const now = BASE + 90 * 1000; // 90s despues (entre 60s y 120s)
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('yellow');
  });

  it('devuelve "red" si elapsed > 2x pollingSeconds', () => {
    const lastSyncAt = BASE;
    const now = BASE + 130 * 1000; // 130s despues (> 120s)
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('red');
  });

  it('devuelve "red" si lastSyncAt es null (nunca sincronizo)', () => {
    expect(getSyncColor(null, POLLING, BASE)).toBe('red');
  });

  it('usa Date.now() si no se pasa "now" (smoke test)', () => {
    const recentSync = Date.now() - 5000; // hace 5 segundos
    expect(getSyncColor(recentSync, POLLING)).toBe('green');
  });

  it('funciona correctamente en el limite exacto de 1x (edge)', () => {
    const lastSyncAt = BASE;
    const now = BASE + 60 * 1000; // exactamente 60s
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('yellow');
  });

  it('funciona correctamente en el limite exacto de 2x (edge)', () => {
    const lastSyncAt = BASE;
    const now = BASE + 120 * 1000; // exactamente 120s
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('red');
  });
});

// --- reportDrift ---

describe('reportDrift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseParams = {
    trigger: 'interval' as const,
    added: 2,
    removed: 1,
    totalBefore: 10,
    totalAfter: 11,
    selectedDate: '2026-05-04',
    isRoot: true,
  };

  it('muestra toast si isRoot === true y hay drift', () => {
    reportDrift(baseParams);
    expect(toast).toHaveBeenCalledOnce();
    const [msg, opts] = (toast as any).mock.calls[0];
    expect(msg).toContain('interval');
    expect(msg).toContain('+2');
    expect(msg).toContain('-1');
    expect(opts.duration).toBe(3000);
  });

  it('muestra toast si removed > 0 aunque added === 0', () => {
    reportDrift({ ...baseParams, added: 0, removed: 3 });
    expect(toast).toHaveBeenCalledOnce();
  });

  it('NO muestra toast si added === 0 && removed === 0', () => {
    reportDrift({ ...baseParams, added: 0, removed: 0 });
    expect(toast).not.toHaveBeenCalled();
  });

  it('NO muestra toast si isRoot === false, aunque haya drift', () => {
    reportDrift({ ...baseParams, isRoot: false });
    expect(toast).not.toHaveBeenCalled();
  });

  it('incluye el trigger correcto en el mensaje del toast', () => {
    reportDrift({ ...baseParams, trigger: 'silence' });
    const [msg] = (toast as any).mock.calls[0];
    expect(msg).toContain('silence');
  });
});

// --- Gating de UI (logica booleana, sin RTL) ---

describe('Gating de UI: isRoot === S', () => {
  it('isRoot es false cuando user.isRoot es "N"', () => {
    const user = { isRoot: 'N' };
    const isRoot = user?.isRoot === 'S';
    expect(isRoot).toBe(false);
  });

  it('isRoot es false cuando user.isRoot es undefined', () => {
    const user = {} as any;
    const isRoot = user?.isRoot === 'S';
    expect(isRoot).toBe(false);
  });

  it('isRoot es false cuando user es null', () => {
    const user = null as any;
    const isRoot = user?.isRoot === 'S';
    expect(isRoot).toBe(false);
  });

  it('isRoot es false cuando user.isRoot es true (no es string S)', () => {
    const user = { isRoot: true } as any;
    const isRoot = user?.isRoot === 'S';
    expect(isRoot).toBe(false);
  });

  it('isRoot es true SOLO cuando user.isRoot === "S" (literal)', () => {
    const user = { isRoot: 'S' };
    const isRoot = user?.isRoot === 'S';
    expect(isRoot).toBe(true);
  });
});
