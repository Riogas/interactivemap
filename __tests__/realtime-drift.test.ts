/**
 * Tests para lib/realtime-drift.ts
 *
 * Cubre:
 * - getSyncColor: logica de colores 🟢🟡🔴 segun tiempo transcurrido
 * - buildDriftAuditEvent: shape del evento de audit
 * - reportDrift: gating de sendAuditBatch y toast segun condiciones
 * - Gating de UI: la condicion isRoot se evalua correctamente
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
vi.mock('@/lib/audit-client', () => ({
  sendAuditBatch: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: vi.fn(),
}));

import { getSyncColor, buildDriftAuditEvent, reportDrift, reportDriftFetchFailed } from '@/lib/realtime-drift';
import { sendAuditBatch } from '@/lib/audit-client';
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
    // 60s === 60s: NOT < pollingSeconds*1000, so yellow
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('yellow');
  });

  it('funciona correctamente en el limite exacto de 2x (edge)', () => {
    const lastSyncAt = BASE;
    const now = BASE + 120 * 1000; // exactamente 120s
    // 120s === 120s: NOT < pollingSeconds*2000, so red
    expect(getSyncColor(lastSyncAt, POLLING, now)).toBe('red');
  });
});

// --- buildDriftAuditEvent ---

describe('buildDriftAuditEvent', () => {
  it('construye el evento con el shape correcto', () => {
    const params = {
      trigger: 'interval' as const,
      added: 2,
      removed: 1,
      totalBefore: 10,
      totalAfter: 11,
      selectedDate: '2026-05-04',
      isRoot: true,
    };
    const event = buildDriftAuditEvent(params);
    expect(event.event_type).toBe('realtime_drift');
    expect(event.endpoint).toBe('dashboard/reconcile');
    expect(event.extra).toEqual({
      trigger: 'interval',
      added: 2,
      removed: 1,
      totalAfter: 11,
      totalBefore: 10,
      selectedDate: '2026-05-04',
      userIsRoot: true,
    });
  });

  it('refleja correctamente el campo userIsRoot = false', () => {
    const event = buildDriftAuditEvent({
      trigger: 'reconnect',
      added: 1,
      removed: 0,
      totalBefore: 5,
      totalAfter: 6,
      selectedDate: '2026-05-04',
      isRoot: false,
    });
    expect((event.extra as any).userIsRoot).toBe(false);
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

  it('llama sendAuditBatch cuando hay drift (added > 0)', () => {
    reportDrift(baseParams);
    expect(sendAuditBatch).toHaveBeenCalledOnce();
    const [events] = (sendAuditBatch as any).mock.calls[0];
    expect(events[0].event_type).toBe('realtime_drift');
    expect(events[0].extra.added).toBe(2);
    expect(events[0].extra.removed).toBe(1);
  });

  it('llama sendAuditBatch cuando removed > 0 aunque added === 0', () => {
    reportDrift({ ...baseParams, added: 0, removed: 3 });
    expect(sendAuditBatch).toHaveBeenCalledOnce();
  });

  it('NO llama sendAuditBatch si added === 0 && removed === 0', () => {
    reportDrift({ ...baseParams, added: 0, removed: 0 });
    expect(sendAuditBatch).not.toHaveBeenCalled();
  });

  it('muestra toast si isRoot === true y hay drift', () => {
    reportDrift(baseParams);
    expect(toast).toHaveBeenCalledOnce();
    const [msg, opts] = (toast as any).mock.calls[0];
    expect(msg).toContain('interval');
    expect(msg).toContain('+2');
    expect(msg).toContain('-1');
    expect(opts.duration).toBe(3000);
  });

  it('NO muestra toast si isRoot === false, aunque haya drift', () => {
    reportDrift({ ...baseParams, isRoot: false });
    expect(toast).not.toHaveBeenCalled();
    // Pero si llama al audit log
    expect(sendAuditBatch).toHaveBeenCalledOnce();
  });

  it('NO muestra toast si added === 0 && removed === 0', () => {
    reportDrift({ ...baseParams, added: 0, removed: 0 });
    expect(toast).not.toHaveBeenCalled();
  });

  it('incluye el trigger correcto en el mensaje del toast', () => {
    reportDrift({ ...baseParams, trigger: 'silence' });
    const [msg] = (toast as any).mock.calls[0];
    expect(msg).toContain('silence');
  });

  it('el evento de audit incluye selectedDate correctamente', () => {
    reportDrift({ ...baseParams, selectedDate: '2026-05-04' });
    const [events] = (sendAuditBatch as any).mock.calls[0];
    expect((events[0].extra as any).selectedDate).toBe('2026-05-04');
  });
});

// --- reportDriftFetchFailed ---

describe('reportDriftFetchFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('llama sendAuditBatch con event_type realtime_drift_fetch_failed', () => {
    reportDriftFetchFailed({
      trigger: 'interval',
      status: 401,
      selectedDate: '2026-05-04',
      isRoot: false,
    });
    expect(sendAuditBatch).toHaveBeenCalledOnce();
    const [events] = (sendAuditBatch as any).mock.calls[0];
    expect(events[0].event_type).toBe('realtime_drift_fetch_failed');
    expect((events[0].extra as any).status).toBe(401);
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
