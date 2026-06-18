/**
 * Tests del filtro de atraso para FINALIZADOS (modales extendidos).
 *
 * El filtro reutiliza los rangos de minutos de la card "Atrasos por pedidos
 * entregados" de la pantalla de estadísticas, basándose en la columna
 * atraso_cump_mins (minutos de atraso al cumplir la entrega).
 */

import { describe, it, expect } from 'vitest';
import {
  atrasoFinalizadoKey,
  ATRASO_FINALIZADO_OPTIONS,
  BUCKET_FINALIZADO_TO_KEY,
  bucketAtrasoFinalizado,
} from '@/utils/pedidoDelay';

describe('atrasoFinalizadoKey', () => {
  it('null / NaN / <= 0 → fin_sin_atraso (en hora o anticipado)', () => {
    expect(atrasoFinalizadoKey(null)).toBe('fin_sin_atraso');
    expect(atrasoFinalizadoKey(NaN)).toBe('fin_sin_atraso');
    expect(atrasoFinalizadoKey(0)).toBe('fin_sin_atraso');
    expect(atrasoFinalizadoKey(-12)).toBe('fin_sin_atraso');
  });

  it('1..15 → fin_1a15', () => {
    expect(atrasoFinalizadoKey(1)).toBe('fin_1a15');
    expect(atrasoFinalizadoKey(15)).toBe('fin_1a15');
  });

  it('16..30 → fin_15a30', () => {
    expect(atrasoFinalizadoKey(16)).toBe('fin_15a30');
    expect(atrasoFinalizadoKey(30)).toBe('fin_15a30');
  });

  it('31..60 → fin_30a60', () => {
    expect(atrasoFinalizadoKey(31)).toBe('fin_30a60');
    expect(atrasoFinalizadoKey(60)).toBe('fin_30a60');
  });

  it('> 60 → fin_60mas', () => {
    expect(atrasoFinalizadoKey(61)).toBe('fin_60mas');
    expect(atrasoFinalizadoKey(500)).toBe('fin_60mas');
  });

  it('es consistente con bucketAtrasoFinalizado vía BUCKET_FINALIZADO_TO_KEY', () => {
    for (const mins of [null, -5, 0, 1, 15, 16, 30, 45, 60, 120]) {
      expect(atrasoFinalizadoKey(mins)).toBe(
        BUCKET_FINALIZADO_TO_KEY[bucketAtrasoFinalizado(mins)],
      );
    }
  });
});

describe('ATRASO_FINALIZADO_OPTIONS', () => {
  it('tiene las 5 categorías esperadas, en orden de menor a mayor atraso', () => {
    expect(ATRASO_FINALIZADO_OPTIONS.map(o => o.key)).toEqual([
      'fin_1a15',
      'fin_15a30',
      'fin_30a60',
      'fin_60mas',
      'fin_sin_atraso',
    ]);
  });

  it('cada opción tiene label, color y dotColor', () => {
    for (const opt of ATRASO_FINALIZADO_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.color.length).toBeGreaterThan(0);
      expect(opt.dotColor.length).toBeGreaterThan(0);
    }
  });
});
