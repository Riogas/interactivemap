/**
 * Tests unitarios para lib/date-utils.ts
 *
 * Cubren el bug de timezone: entre las 21:00 y 23:59 hora Montevideo (UTC-3),
 * la implementación anterior con `new Date().toISOString().split('T')[0]`
 * devolvía el día siguiente (UTC ya marcaba el día siguiente).
 *
 * Escenarios de AC3 del request:
 *   1. 02/05 21:40 Montevideo (00:40 UTC del 03/05) → '2026-05-02'
 *   2. 02/05 23:59 Montevideo (02:59 UTC del 03/05) → '2026-05-02'
 *   3. 03/05 00:01 Montevideo (03:01 UTC del 03/05) → '2026-05-03'
 *   4. 02/05 12:00 Montevideo (15:00 UTC del 02/05) → '2026-05-02'
 */

import { describe, it, expect } from 'vitest';
import { todayMontevideo, todayInTimezone } from '@/lib/date-utils';

describe('todayMontevideo()', () => {
  it('AC3-1: 21:40 Montevideo (=00:40 UTC del día siguiente) → devuelve día local Montevideo', () => {
    // 2026-05-03T00:40:00Z = 2026-05-02T21:40:00-03:00 (Montevideo)
    const utcMoment = new Date('2026-05-03T00:40:00Z');
    expect(todayMontevideo(utcMoment)).toBe('2026-05-02');
  });

  it('AC3-2: 23:59 Montevideo (=02:59 UTC del día siguiente) → devuelve día local Montevideo', () => {
    // 2026-05-03T02:59:00Z = 2026-05-02T23:59:00-03:00 (Montevideo)
    const utcMoment = new Date('2026-05-03T02:59:00Z');
    expect(todayMontevideo(utcMoment)).toBe('2026-05-02');
  });

  it('AC3-3: 00:01 Montevideo (=03:01 UTC mismo día) → devuelve día local Montevideo nuevo', () => {
    // 2026-05-03T03:01:00Z = 2026-05-03T00:01:00-03:00 (Montevideo)
    const utcMoment = new Date('2026-05-03T03:01:00Z');
    expect(todayMontevideo(utcMoment)).toBe('2026-05-03');
  });

  it('AC3-4: 12:00 Montevideo (=15:00 UTC mismo día) → devuelve día local Montevideo', () => {
    // 2026-05-02T15:00:00Z = 2026-05-02T12:00:00-03:00 (Montevideo)
    const utcMoment = new Date('2026-05-02T15:00:00Z');
    expect(todayMontevideo(utcMoment)).toBe('2026-05-02');
  });

  it('medianoche exacta UTC (03:00 Montevideo = medianoche UTC+3) → día correcto', () => {
    // 2026-05-03T00:00:00Z = 2026-05-02T21:00:00-03:00 (Montevideo) — todavía es el 02
    const atMidnightUTC = new Date('2026-05-03T00:00:00Z');
    expect(todayMontevideo(atMidnightUTC)).toBe('2026-05-02');
  });

  it('medianoche Montevideo exacta (03:00 UTC) → cambia al día siguiente', () => {
    // 2026-05-03T03:00:00Z = 2026-05-03T00:00:00-03:00 (Montevideo)
    const atMidnightMontevideo = new Date('2026-05-03T03:00:00Z');
    expect(todayMontevideo(atMidnightMontevideo)).toBe('2026-05-03');
  });

  it('formato de salida es siempre YYYY-MM-DD', () => {
    const result = todayMontevideo(new Date('2026-01-05T15:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('antipatrón anterior devolvería día incorrecto a las 22:00 Montevideo', () => {
    // Demostración del bug: 22:00 Montevideo = 01:00 UTC del día siguiente
    const utcMoment = new Date('2026-05-03T01:00:00Z');

    // Bug: toISOString() devolvería '2026-05-03' (UTC), pero estamos en el 02 en Montevideo
    const buggyResult = utcMoment.toISOString().split('T')[0];
    expect(buggyResult).toBe('2026-05-03'); // El bug: día equivocado

    // Fix: todayMontevideo() devuelve el día correcto
    const fixedResult = todayMontevideo(utcMoment);
    expect(fixedResult).toBe('2026-05-02'); // Correcto
  });
});

describe('todayInTimezone()', () => {
  it('devuelve la misma fecha que todayMontevideo para America/Montevideo', () => {
    const now = new Date('2026-05-03T00:40:00Z');
    expect(todayInTimezone('America/Montevideo', now)).toBe(todayMontevideo(now));
  });

  it('puede calcular fecha para otra timezone', () => {
    // 2026-05-03T00:40:00Z = 2026-05-02T20:40:00-04:00 (New York DST)
    const now = new Date('2026-05-03T00:40:00Z');
    const result = todayInTimezone('America/New_York', now);
    // New York en mayo está en EDT (UTC-4), 00:40 UTC = 20:40 del día anterior
    expect(result).toBe('2026-05-02');
  });
});
