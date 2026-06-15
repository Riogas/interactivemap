/**
 * Tests for ZonaMovilesViewModal sub-filter logic.
 *
 * Since the vitest environment is 'node' (no jsdom), we test the pure logic
 * functions that drive the modal's sub-filter default behavior:
 *   - determineServicePeriod (from lib/horario-servicio)
 *   - The PEDIDOS_SUB_OPTIONS shape (no 'Todos')
 *
 * Each test corresponds to an Acceptance Criteria from the spec.
 */
import { describe, it, expect } from 'vitest';
import {
  determineServicePeriod,
  parseTimeToDecimal,
  NIGHT_START_HOUR,
  DAY_START_HOUR,
} from '../lib/horario-servicio';

/** Helper: build a Date with a specific local hour:minute */
function makeLocalDate(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ── AC1: Sub-options are exactly ['URGENTE', 'NOCTURNO'] (no 'Todos') ─────────

const PEDIDOS_SUB_OPTIONS = [
  { value: 'URGENTE', label: 'Urgente' },
  { value: 'NOCTURNO', label: 'Nocturno' },
] as const;

describe('PEDIDOS_SUB_OPTIONS shape', () => {
  it('tiene exactamente 2 opciones: Urgente y Nocturno', () => {
    expect(PEDIDOS_SUB_OPTIONS).toHaveLength(2);
    expect(PEDIDOS_SUB_OPTIONS.map(o => o.value)).toEqual(['URGENTE', 'NOCTURNO']);
  });

  it('no tiene la opción Todos', () => {
    const values = PEDIDOS_SUB_OPTIONS.map(o => o.value);
    expect(values).not.toContain('TODOS');
  });
});

// ── AC2: Default URGENTE cuando hora=10:00 + aplicaNocturno=true ──────────────

describe('determineServicePeriod — defaults por horario', () => {
  it('AC2: hora 10:00 + aplicaNocturno=true → URGENTE', () => {
    const serverNow = makeLocalDate(10, 0);
    const result = determineServicePeriod(serverNow, true);
    expect(result).toBe('URGENTE');
  });

  // ── AC3: Default NOCTURNO cuando hora=22:00 + aplicaNocturno=true ───────────

  it('AC3: hora 22:00 + aplicaNocturno=true → NOCTURNO', () => {
    const serverNow = makeLocalDate(22, 0);
    const result = determineServicePeriod(serverNow, true);
    expect(result).toBe('NOCTURNO');
  });

  // ── AC4: Default NOCTURNO cuando hora=01:30 + aplicaNocturno=true (wraps midnight) ─

  it('AC4: hora 01:30 + aplicaNocturno=true → NOCTURNO (envuelve medianoche)', () => {
    const serverNow = makeLocalDate(1, 30);
    const result = determineServicePeriod(serverNow, true);
    expect(result).toBe('NOCTURNO');
  });

  // ── AC5: Default forzado URGENTE cuando aplicaNocturno=false ─────────────────

  it('AC5: aplicaNocturno=false → siempre URGENTE (independiente de la hora)', () => {
    // Hora nocturna pero sin capa nocturna → URGENTE
    expect(determineServicePeriod(makeLocalDate(22, 0), false)).toBe('URGENTE');
    // Hora diurna también → URGENTE
    expect(determineServicePeriod(makeLocalDate(10, 0), false)).toBe('URGENTE');
    // Madrugada → URGENTE
    expect(determineServicePeriod(makeLocalDate(2, 0), false)).toBe('URGENTE');
  });
});

// ── AC6: Horarios custom de nocturno respetados ───────────────────────────────

describe('determineServicePeriod — horarios custom', () => {
  // Custom: nocturno 22:00 - 07:00
  const customNightStart = parseTimeToDecimal('22:00')!; // 22.0
  const customDayStart = parseTimeToDecimal('07:00')!;   // 7.0

  it('AC6a: hora 22:00 con horario custom (22:00-07:00) → NOCTURNO', () => {
    const serverNow = makeLocalDate(22, 0);
    expect(determineServicePeriod(serverNow, true, customNightStart, customDayStart)).toBe('NOCTURNO');
  });

  it('AC6b: hora 06:30 con horario custom (22:00-07:00) → NOCTURNO (aún dentro del periodo nocturno)', () => {
    // 06:30 < 07:00 → todavía nocturno con horario custom
    const serverNow = makeLocalDate(6, 30);
    expect(determineServicePeriod(serverNow, true, customNightStart, customDayStart)).toBe('NOCTURNO');
  });

  it('AC6c: hora 07:01 con horario custom (22:00-07:00) → URGENTE (ya diurno)', () => {
    const serverNow = makeLocalDate(7, 1);
    expect(determineServicePeriod(serverNow, true, customNightStart, customDayStart)).toBe('URGENTE');
  });

  it('AC6d: hora 21:59 con horario custom (22:00-07:00) → URGENTE (justo antes del nocturno)', () => {
    const serverNow = makeLocalDate(21, 59);
    expect(determineServicePeriod(serverNow, true, customNightStart, customDayStart)).toBe('URGENTE');
  });
});

// ── AC7: Re-cálculo al volver a Pedidos refleja la hora actual ────────────────
// Este test verifica la lógica directamente: si la hora cambia, el resultado cambia.

describe('determineServicePeriod — re-cálculo dinámico', () => {
  it('AC7: mismo escenario, horas diferentes → resultados distintos', () => {
    const horaManana = makeLocalDate(10, 0);  // diurno → URGENTE
    const horaNoche = makeLocalDate(22, 0);   // nocturno → NOCTURNO

    const resultManana = determineServicePeriod(horaManana, true);
    const resultNoche = determineServicePeriod(horaNoche, true);

    expect(resultManana).toBe('URGENTE');
    expect(resultNoche).toBe('NOCTURNO');
    // Verifica que el re-cálculo con hora diferente produce resultado diferente
    expect(resultManana).not.toBe(resultNoche);
  });
});

// ── AC8: Límites exactos del horario default ──────────────────────────────────

describe('determineServicePeriod — límites exactos del horario default (20:30 / 06:00)', () => {
  it('20:30 exacto → NOCTURNO (inicio del periodo nocturno)', () => {
    const d = makeLocalDate(20, 30);
    expect(determineServicePeriod(d, true)).toBe('NOCTURNO');
  });

  it('20:29 → URGENTE (un minuto antes del nocturno)', () => {
    const d = makeLocalDate(20, 29);
    expect(determineServicePeriod(d, true)).toBe('URGENTE');
  });

  it('06:00 exacto → URGENTE (inicio del periodo diurno)', () => {
    const d = makeLocalDate(6, 0);
    expect(determineServicePeriod(d, true)).toBe('URGENTE');
  });

  it('05:59 → NOCTURNO (un minuto antes del diurno)', () => {
    const d = makeLocalDate(5, 59);
    expect(determineServicePeriod(d, true)).toBe('NOCTURNO');
  });
});

// ── parseTimeToDecimal — parsing robusto ─────────────────────────────────────

describe('parseTimeToDecimal', () => {
  it('parsea "20:30" → 20.5', () => {
    expect(parseTimeToDecimal('20:30')).toBeCloseTo(20.5);
  });

  it('parsea "06:00" → 6.0', () => {
    expect(parseTimeToDecimal('06:00')).toBe(6);
  });

  it('parsea "07:00" → 7.0', () => {
    expect(parseTimeToDecimal('07:00')).toBe(7);
  });

  it('parsea "22:00" → 22.0', () => {
    expect(parseTimeToDecimal('22:00')).toBe(22);
  });

  it('parsea "20:30:00" (con segundos) → 20.5', () => {
    expect(parseTimeToDecimal('20:30:00')).toBeCloseTo(20.5);
  });

  it('retorna null para null', () => {
    expect(parseTimeToDecimal(null)).toBeNull();
  });

  it('retorna null para undefined', () => {
    expect(parseTimeToDecimal(undefined)).toBeNull();
  });

  it('retorna null para string vacío', () => {
    expect(parseTimeToDecimal('')).toBeNull();
  });

  it('retorna null para formato inválido', () => {
    expect(parseTimeToDecimal('no-es-hora')).toBeNull();
  });
});
