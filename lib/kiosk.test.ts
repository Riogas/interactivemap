/**
 * Tests de la lógica pura de Modo Kiosko. Ver `lib/kiosk.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KIOSK_ATTR,
  ROLLOVER_OFFSET_MS,
  resolveModoKiosko,
  msUntilNextRollover,
  scheduleRollover,
} from './kiosk';

describe('resolveModoKiosko()', () => {
  it('true para valores truthy explícitos (trim + case-insensitive)', () => {
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'true' }])).toBe(true);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'TRUE' }])).toBe(true);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '  true  ' }])).toBe(true);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'S' }])).toBe(true);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 's' }])).toBe(true);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '1' }])).toBe(true);
  });

  it('true para boolean true JSON-wrapped', () => {
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'true' }])).toBe(true);
  });

  it('false (fail-safe) para valores ambiguos/negativos', () => {
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'false' }])).toBe(false);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '0' }])).toBe(false);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: 'N' }])).toBe(false);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '' }])).toBe(false);
  });

  it('false para JSON no booleano', () => {
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '{"a":1}' }])).toBe(false);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '"true"' }])).toBe(false);
    expect(resolveModoKiosko([{ atributo: KIOSK_ATTR, valor: '[true]' }])).toBe(false);
  });

  it('atributo ausente/otro nombre → false', () => {
    expect(resolveModoKiosko([{ atributo: 'Otro', valor: 'true' }])).toBe(false);
  });

  it('default false con null/undefined/[] (fail-safe)', () => {
    expect(resolveModoKiosko(null)).toBe(false);
    expect(resolveModoKiosko(undefined)).toBe(false);
    expect(resolveModoKiosko([])).toBe(false);
  });

  it('OR entre roles: algún rol truthy ⇒ true, aunque otros sean false', () => {
    expect(
      resolveModoKiosko([
        { atributo: KIOSK_ATTR, valor: 'false' },
        { atributo: KIOSK_ATTR, valor: 'true' },
      ]),
    ).toBe(true);
  });

  it('todos los roles false ⇒ false', () => {
    expect(
      resolveModoKiosko([
        { atributo: KIOSK_ATTR, valor: 'false' },
        { atributo: KIOSK_ATTR, valor: '0' },
      ]),
    ).toBe(false);
  });
});

describe('msUntilNextRollover()', () => {
  it('23:30 Montevideo (2026-06-17T02:30:00Z) → 30min a medianoche + offset', () => {
    const now = new Date('2026-06-17T02:30:00Z'); // = 23:30 Montevideo (UTC-3)
    expect(msUntilNextRollover(now)).toBe(30 * 60 * 1000 + ROLLOVER_OFFSET_MS);
  });

  it('justo a medianoche Montevideo → 24h + offset', () => {
    const now = new Date('2026-06-17T03:00:00Z'); // = 00:00:00 Montevideo
    expect(msUntilNextRollover(now)).toBe(24 * 60 * 60 * 1000 + ROLLOVER_OFFSET_MS);
  });

  it('respeta un offset custom', () => {
    const now = new Date('2026-06-17T02:30:00Z');
    expect(msUntilNextRollover(now, 0)).toBe(30 * 60 * 1000);
    expect(msUntilNextRollover(now, 60_000)).toBe(30 * 60 * 1000 + 60_000);
  });
});

describe('scheduleRollover()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispara onRollover una vez al llegar el delay calculado', () => {
    vi.setSystemTime(new Date('2026-06-17T02:30:00Z')); // 23:30 Montevideo
    const onRollover = vi.fn();
    scheduleRollover(onRollover);

    vi.advanceTimersByTime(30 * 60 * 1000 + ROLLOVER_OFFSET_MS - 1);
    expect(onRollover).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onRollover).toHaveBeenCalledOnce();
  });

  it('cancelar antes de que llegue el delay ⇒ onRollover NUNCA se llama (cleanup, AC10)', () => {
    vi.setSystemTime(new Date('2026-06-17T02:30:00Z'));
    const onRollover = vi.fn();
    const cancel = scheduleRollover(onRollover);

    cancel();
    vi.advanceTimersByTime(30 * 60 * 1000 + ROLLOVER_OFFSET_MS + 1000);
    expect(onRollover).not.toHaveBeenCalled();
  });

  it('usa el offset custom pasado', () => {
    vi.setSystemTime(new Date('2026-06-17T02:30:00Z'));
    const onRollover = vi.fn();
    scheduleRollover(onRollover, () => new Date(), 0);

    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(onRollover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRollover).toHaveBeenCalledOnce();
  });
});
