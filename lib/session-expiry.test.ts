/**
 * Tests de la lógica pura de expiración de sesión por inactividad (sliding window).
 * Ver `lib/session-expiry.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  isIdleExpired,
  resolveLastActivityMs,
  SESSION_MAX_IDLE_MS,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  minutesToMs,
  readIdleTimeoutOverrideMin,
  resolveIdleTimeoutMin,
  resolveIdleTimeoutMs,
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

describe('minutesToMs()', () => {
  it('convierte minutos a ms', () => {
    expect(minutesToMs(120)).toBe(120 * 60 * 1000);
  });
  it('valores inválidos/<=0 → 0', () => {
    expect(minutesToMs(null)).toBe(0);
    expect(minutesToMs(undefined)).toBe(0);
    expect(minutesToMs(NaN)).toBe(0);
    expect(minutesToMs(0)).toBe(0);
    expect(minutesToMs(-5)).toBe(0);
  });
});

describe('readIdleTimeoutOverrideMin()', () => {
  it('devuelve null si no hay atributos o no está el atributo', () => {
    expect(readIdleTimeoutOverrideMin(null)).toBeNull();
    expect(readIdleTimeoutOverrideMin([])).toBeNull();
    expect(readIdleTimeoutOverrideMin([{ atributo: 'Otro', valor: '99' }])).toBeNull();
  });

  it('lee TiempoInactividadMin como número', () => {
    expect(readIdleTimeoutOverrideMin([{ atributo: 'TiempoInactividadMin', valor: '3600' }])).toBe(3600);
  });

  it('si varios roles lo definen, gana el mayor (más permisivo)', () => {
    expect(readIdleTimeoutOverrideMin([
      { atributo: 'TiempoInactividadMin', valor: '120' },
      { atributo: 'TiempoInactividadMin', valor: '3600' },
      { atributo: 'Otro', valor: '5' },
    ])).toBe(3600);
  });

  it('ignora valores inválidos/<=0', () => {
    expect(readIdleTimeoutOverrideMin([{ atributo: 'TiempoInactividadMin', valor: 'abc' }])).toBeNull();
    expect(readIdleTimeoutOverrideMin([{ atributo: 'TiempoInactividadMin', valor: '0' }])).toBeNull();
    expect(readIdleTimeoutOverrideMin([{ atributo: 'TiempoInactividadMin', valor: '-10' }])).toBeNull();
  });
});

describe('resolveIdleTimeoutMin() — prioridad override > global > default', () => {
  const atr = (v: string) => [{ atributo: 'TiempoInactividadMin', valor: v }];

  it('override por usuario gana sobre global', () => {
    expect(resolveIdleTimeoutMin(atr('3600'), 120)).toBe(3600);
  });

  it('sin override usa el global', () => {
    expect(resolveIdleTimeoutMin([], 120)).toBe(120);
    expect(resolveIdleTimeoutMin(null, 200)).toBe(200);
  });

  it('sin override ni global usa el default (8h = 480)', () => {
    expect(resolveIdleTimeoutMin([], null)).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES);
    expect(resolveIdleTimeoutMin(null, undefined)).toBe(480);
    expect(resolveIdleTimeoutMin([], 0)).toBe(480);
  });
});

describe('resolveIdleTimeoutMs()', () => {
  it('devuelve el efectivo en ms (override por usuario)', () => {
    expect(resolveIdleTimeoutMs([{ atributo: 'TiempoInactividadMin', valor: '3600' }], 120))
      .toBe(3600 * 60 * 1000);
  });
  it('cae al default 8h en ms cuando no hay nada', () => {
    expect(resolveIdleTimeoutMs(null, null)).toBe(SESSION_MAX_IDLE_MS);
  });
});
