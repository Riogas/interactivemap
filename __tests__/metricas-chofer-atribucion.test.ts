/**
 * Tests para lib/metricas/chofer-atribucion.ts — atribuirChofer (AC10/AC14):
 * un chofer todo el día, cambio de chofer a mitad de día, historial vacío,
 * finalización previa al primer inicio del historial.
 */

import { describe, it, expect } from 'vitest';
import { atribuirChofer } from '@/lib/metricas/chofer-atribucion';

describe('atribuirChofer()', () => {
  it('un chofer todo el día → lo atribuye', () => {
    const historial = [{ chofer: 'Juan Perez', inicio: '2026-07-21T08:00:00Z' }];
    const chofer = atribuirChofer(historial, '2026-07-21T18:00:00Z');
    expect(chofer).toBe('Juan Perez');
  });

  it('cambio de chofer a mitad de día → atribuye al que estaba activo al momento del cumplimiento', () => {
    const historial = [
      { chofer: 'Juan Perez', inicio: '2026-07-21T08:00:00Z' },
      { chofer: 'Maria Lopez', inicio: '2026-07-21T13:00:00Z' },
    ];
    // Cumplimiento a las 12:00 → todavía era Juan
    expect(atribuirChofer(historial, '2026-07-21T12:00:00Z')).toBe('Juan Perez');
    // Cumplimiento a las 15:00 → ya era Maria
    expect(atribuirChofer(historial, '2026-07-21T15:00:00Z')).toBe('Maria Lopez');
  });

  it('elige el inicio máximo <= finalización cuando hay 3+ cambios', () => {
    const historial = [
      { chofer: 'A', inicio: '2026-07-21T06:00:00Z' },
      { chofer: 'B', inicio: '2026-07-21T10:00:00Z' },
      { chofer: 'C', inicio: '2026-07-21T14:00:00Z' },
    ];
    expect(atribuirChofer(historial, '2026-07-21T11:00:00Z')).toBe('B');
  });

  it('historial vacío ([]) → null', () => {
    expect(atribuirChofer([], '2026-07-21T12:00:00Z')).toBeNull();
  });

  it('historial null → null', () => {
    expect(atribuirChofer(null, '2026-07-21T12:00:00Z')).toBeNull();
  });

  it('finalización previa al primer inicio del historial → null (ningún candidato)', () => {
    const historial = [{ chofer: 'Juan Perez', inicio: '2026-07-21T14:00:00Z' }];
    expect(atribuirChofer(historial, '2026-07-21T08:00:00Z')).toBeNull();
  });

  it('entradas con inicio null se ignoran como candidatas', () => {
    const historial = [
      { chofer: 'Sin inicio', inicio: null },
      { chofer: 'Juan Perez', inicio: '2026-07-21T08:00:00Z' },
    ];
    expect(atribuirChofer(historial, '2026-07-21T12:00:00Z')).toBe('Juan Perez');
  });

  it('chofer vacío/whitespace tras trim → null', () => {
    const historial = [{ chofer: '   ', inicio: '2026-07-21T08:00:00Z' }];
    expect(atribuirChofer(historial, '2026-07-21T12:00:00Z')).toBeNull();
  });

  it('recorta espacios del nombre del chofer atribuido', () => {
    const historial = [{ chofer: '  Juan Perez  ', inicio: '2026-07-21T08:00:00Z' }];
    expect(atribuirChofer(historial, '2026-07-21T12:00:00Z')).toBe('Juan Perez');
  });

  it('inicio exactamente igual a la finalización cuenta como candidato válido (<=)', () => {
    const historial = [{ chofer: 'Juan Perez', inicio: '2026-07-21T12:00:00Z' }];
    expect(atribuirChofer(historial, '2026-07-21T12:00:00Z')).toBe('Juan Perez');
  });
});
