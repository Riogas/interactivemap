/**
 * Tests de la lógica pura de expiración de sesión por inactividad (sliding window).
 * Ver `lib/session-expiry.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  isIdleExpired,
  resolveLastActivityMs,
  SESSION_MAX_IDLE_MS,
} from './session-expiry';

describe('isIdleExpired()', () => {
  const NOW = new Date('2026-06-17T22:00:00Z').getTime();

  it('NO expira si la última actividad fue dentro de la ventana (7h59m)', () => {
    const last = NOW - (SESSION_MAX_IDLE_MS - 60_000);
    expect(isIdleExpired(last, NOW)).toBe(false);
  });

  it('expira si la inactividad supera la ventana (8h01m)', () => {
    const last = NOW - (SESSION_MAX_IDLE_MS + 60_000);
    expect(isIdleExpired(last, NOW)).toBe(true);
  });

  it('actividad reciente renueva la ventana (sliding): hace 1s → vivo', () => {
    expect(isIdleExpired(NOW - 1000, NOW)).toBe(false);
  });

  it('borde exacto: igual al máximo NO expira (comparación con >, no >=)', () => {
    expect(isIdleExpired(NOW - SESSION_MAX_IDLE_MS, NOW)).toBe(false);
  });

  it('fail-closed: null/undefined/NaN/0 se tratan como expirado', () => {
    expect(isIdleExpired(null, NOW)).toBe(true);
    expect(isIdleExpired(undefined, NOW)).toBe(true);
    expect(isIdleExpired(NaN, NOW)).toBe(true);
    expect(isIdleExpired(0, NOW)).toBe(true);
  });

  it('respeta un maxIdleMs custom', () => {
    const last = NOW - 2 * 60 * 60 * 1000; // hace 2h
    expect(isIdleExpired(last, NOW, 1 * 60 * 60 * 1000)).toBe(true); // máx 1h → expira
    expect(isIdleExpired(last, NOW, 3 * 60 * 60 * 1000)).toBe(false); // máx 3h → vivo
  });
});

describe('resolveLastActivityMs()', () => {
  const ISO = '2026-06-17T14:00:00Z';

  it('usa la actividad persistida cuando es un número válido', () => {
    const t = 1_750_000_000_000;
    expect(resolveLastActivityMs(String(t), undefined)).toBe(t);
  });

  it('cae al loginTime cuando no hay actividad persistida', () => {
    expect(resolveLastActivityMs(null, ISO)).toBe(new Date(ISO).getTime());
  });

  it('prefiere la actividad persistida por sobre el loginTime', () => {
    const t = new Date('2026-06-17T20:00:00Z').getTime();
    expect(resolveLastActivityMs(String(t), ISO)).toBe(t);
  });

  it('ignora actividad persistida inválida y cae al loginTime', () => {
    expect(resolveLastActivityMs('not-a-number', ISO)).toBe(new Date(ISO).getTime());
  });

  it('ignora actividad persistida <= 0 y cae al loginTime', () => {
    expect(resolveLastActivityMs('0', ISO)).toBe(new Date(ISO).getTime());
  });

  it('devuelve 0 cuando no hay ni actividad ni loginTime', () => {
    expect(resolveLastActivityMs(null, undefined)).toBe(0);
  });
});
