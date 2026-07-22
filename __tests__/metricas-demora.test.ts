/**
 * Tests para lib/metricas/demora.ts — computeDemora (AC8/OQ4/AC14):
 * CAMPO vs DERIVADO, sin dato calculable, demora negativa (excluida).
 */

import { describe, it, expect } from 'vitest';
import { computeDemora } from '@/lib/metricas/demora';

describe('computeDemora() — prioridad CAMPO', () => {
  it('usa fch_hora_asignado cuando existe → source CAMPO', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: '2026-07-21T14:00:00Z',
      demoraMovilDesdeAsignacionMins: 999, // ignorado: CAMPO tiene prioridad
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.demoraMins).toBe(30);
      expect(result.source).toBe('CAMPO');
      expect(result.fchHoraAsignado).toBe('2026-07-21T14:00:00Z');
    }
  });

  it('redondea a 2 decimales', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:00:10Z',
      fchHoraAsignado: '2026-07-21T14:00:00Z',
      demoraMovilDesdeAsignacionMins: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.demoraMins).toBeCloseTo(0.17, 2); // 10s = 0.1666... min
    }
  });
});

describe('computeDemora() — fallback DERIVADO', () => {
  it('sin fch_hora_asignado, usa demora_movil_desde_asignacion_mins → source DERIVADO', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: 45,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.demoraMins).toBe(45);
      expect(result.source).toBe('DERIVADO');
      expect(result.fchHoraAsignado).toBeNull();
    }
  });

  it('demora_movil_desde_asignacion_mins = 0 es un valor válido (no "sin dato")', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.demoraMins).toBe(0);
      expect(result.source).toBe('DERIVADO');
    }
  });
});

describe('computeDemora() — sin dato calculable', () => {
  it('sin fch_hora_asignado ni demora_movil_desde_asignacion_mins → excluido', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('sin_asignado_calculable');
  });
});

describe('computeDemora() — demora negativa (OQ4)', () => {
  it('fch_hora_asignado posterior a la finalización → excluido con demora_negativa', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:00:00Z',
      fchHoraAsignado: '2026-07-21T14:30:00Z', // asignado DESPUÉS del cumplimiento
      demoraMovilDesdeAsignacionMins: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('demora_negativa');
  });

  it('demora_movil_desde_asignacion_mins negativo (DERIVADO) → excluido con demora_negativa', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: -15,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('demora_negativa');
  });

  it('NO clampea a 0 ni registra el valor negativo — se excluye directamente', () => {
    const result = computeDemora({
      fchHoraFinalizacion: '2026-07-21T14:30:00Z',
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: -1,
    });
    expect(result.ok).toBe(false);
  });
});
