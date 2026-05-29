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
import { todayMontevideo, todayInTimezone, daysAgoMontevideo, pendienteDateRange, pendienteDateRangeCompact } from '@/lib/date-utils';

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

describe('daysAgoMontevideo()', () => {
  it('0 días → mismo resultado que todayMontevideo', () => {
    const now = new Date('2026-05-07T15:00:00Z');
    expect(daysAgoMontevideo(0, now)).toBe(todayMontevideo(now));
  });

  it('10 días → 10 días calendario hacia atrás en hora Montevideo', () => {
    // 2026-05-07 15:00 UTC = 2026-05-07 12:00 -03 → hoy '2026-05-07'
    // 10 días antes: '2026-04-27'
    const now = new Date('2026-05-07T15:00:00Z');
    expect(daysAgoMontevideo(10, now)).toBe('2026-04-27');
  });

  it('respeta el timezone Montevideo en horario nocturno', () => {
    // 2026-05-07 23:30 -03 = 2026-05-08 02:30 UTC. Hoy en Montevideo es '2026-05-07'.
    // 10 días antes desde ese instante = '2026-04-27'
    const utcMoment = new Date('2026-05-08T02:30:00Z');
    expect(daysAgoMontevideo(10, utcMoment)).toBe('2026-04-27');
  });

  it('cruce de mes: 5 días antes del 03/05 → 28/04', () => {
    const now = new Date('2026-05-03T15:00:00Z');
    expect(daysAgoMontevideo(5, now)).toBe('2026-04-28');
  });

  it('formato siempre YYYY-MM-DD', () => {
    expect(daysAgoMontevideo(10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

// ─── Tests de pendienteDateRange (feature: arrastre de pendientes del dia anterior) ───

describe('pendienteDateRange()', () => {
  const HOY_UTC = new Date('2026-05-29T15:00:00Z'); // 2026-05-29T12:00 -03 → hoy UY = '2026-05-29'

  it('fecha === hoy → devuelve [hoy, ayer]', () => {
    const result = pendienteDateRange('2026-05-29', HOY_UTC);
    expect(result).toEqual(['2026-05-29', '2026-05-28']);
  });

  it('fecha pasada → devuelve solo [fecha] (sin arrastre)', () => {
    const result = pendienteDateRange('2026-05-28', HOY_UTC);
    expect(result).toEqual(['2026-05-28']);
  });

  it('fecha futura (edge case) → devuelve solo [fecha] (sin arrastre)', () => {
    const result = pendienteDateRange('2026-05-30', HOY_UTC);
    expect(result).toEqual(['2026-05-30']);
  });

  it('hoy a mediodia → arrastre activo', () => {
    // 2026-05-29T15:00Z = 12:00 UY. Hoy es '2026-05-29'.
    const result = pendienteDateRange('2026-05-29', new Date('2026-05-29T15:00:00Z'));
    expect(result).toEqual(['2026-05-29', '2026-05-28']);
  });

  it('franja nocturna: 23:30 UY (=02:30 UTC+1dia) → arrastre activo con fecha UY correcta', () => {
    // 2026-05-29 23:30 -03 = 2026-05-30T02:30:00Z
    // todayMontevideo en ese momento = '2026-05-29'
    const now = new Date('2026-05-30T02:30:00Z');
    expect(todayMontevideo(now)).toBe('2026-05-29'); // confirmar TZ
    const result = pendienteDateRange('2026-05-29', now);
    expect(result).toEqual(['2026-05-29', '2026-05-28']);
  });

  it('cruce de mes: hoy=01/06 → ayer=31/05', () => {
    // 2026-06-01T15:00:00Z = 12:00 UY → hoy = '2026-06-01'
    const now = new Date('2026-06-01T15:00:00Z');
    const result = pendienteDateRange('2026-06-01', now);
    expect(result).toEqual(['2026-06-01', '2026-05-31']);
  });

  it('cruce de año: hoy=01/01/2027 → ayer=31/12/2026', () => {
    // 2027-01-01T15:00:00Z → hoy UY = '2027-01-01'
    const now = new Date('2027-01-01T15:00:00Z');
    const result = pendienteDateRange('2027-01-01', now);
    expect(result).toEqual(['2027-01-01', '2026-12-31']);
  });

  it('devuelve exactamente 2 elementos cuando es hoy', () => {
    expect(pendienteDateRange('2026-05-29', HOY_UTC)).toHaveLength(2);
  });

  it('devuelve exactamente 1 elemento para fecha pasada', () => {
    expect(pendienteDateRange('2026-05-01', HOY_UTC)).toHaveLength(1);
  });

  it('formato de salida siempre YYYY-MM-DD', () => {
    const result = pendienteDateRange('2026-05-29', HOY_UTC);
    result.forEach(f => expect(f).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });
});

describe('pendienteDateRangeCompact()', () => {
  const HOY_UTC = new Date('2026-05-29T15:00:00Z');

  it('hoy → devuelve [YYYYMMDD_hoy, YYYYMMDD_ayer] sin guiones', () => {
    const result = pendienteDateRangeCompact('2026-05-29', HOY_UTC);
    expect(result).toEqual(['20260529', '20260528']);
  });

  it('fecha pasada → devuelve [YYYYMMDD] sin guiones', () => {
    const result = pendienteDateRangeCompact('2026-05-28', HOY_UTC);
    expect(result).toEqual(['20260528']);
  });

  it('formato siempre YYYYMMDD (sin guiones)', () => {
    const result = pendienteDateRangeCompact('2026-05-29', HOY_UTC);
    result.forEach(f => expect(f).toMatch(/^\d{8}$/));
  });

  it('franja nocturna: resultado compacto correcto', () => {
    // 2026-05-29 23:30 UY = 2026-05-30T02:30Z → hoy UY = '2026-05-29'
    const now = new Date('2026-05-30T02:30:00Z');
    const result = pendienteDateRangeCompact('2026-05-29', now);
    expect(result).toEqual(['20260529', '20260528']);
  });
});
