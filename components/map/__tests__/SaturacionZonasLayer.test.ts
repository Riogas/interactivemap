import { describe, it, expect } from 'vitest';
import { getCapEntregaColor, SaturacionZonaStats } from '@/lib/cap-entrega-color';

// Minimal stats factory — only fields relevant to getCapEntregaColor
function makeStats(overrides: Partial<SaturacionZonaStats> = {}): SaturacionZonaStats {
  return {
    sinAsignar: 0,
    capacidadTotal: 10,
    capacidadDisponible: 5,
    movilesEnZona: 2,
    movilesCompartidos: 0,
    asignadosWeight: 0,
    totalWeight: 10,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escala de valor absoluto: capEntrega = capacidadDisponible - sinAsignar.
// Sin gating por rol/funcionalidad: los negativos (sobrecupo) se muestran a TODOS.
//  cap >= 4   → verde fuerte #22c55e
//  1..3       → verde-amarillo #84cc16
//  cap = 0    → amarillo #eab308
//  -3..-1     → naranja #f97316
//  cap <= -4  → rojo #ef4444
// ─────────────────────────────────────────────────────────────────────────────

describe('getCapEntregaColor — escala de valor absoluto (sin gating por rol)', () => {

  it('sentinel -1000: sin moviles + sin pedidos → label "—"', () => {
    const result = getCapEntregaColor(makeStats({ movilesEnZona: 0, sinAsignar: 0 }));
    expect(result.label).toBe('—');
    expect(result.capEntrega).toBe(-1000);
  });

  it('sentinel -999: sin moviles + pedidos pendientes → label "Sin Cap."', () => {
    const result = getCapEntregaColor(makeStats({ movilesEnZona: 0, sinAsignar: 5 }));
    expect(result.label).toBe('Sin Cap.');
    expect(result.capEntrega).toBe(-999);
  });

  it('cap >= 4 → verde fuerte', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: 8, sinAsignar: 0, movilesEnZona: 2 }));
    expect(result.color).toBe('#22c55e');
    expect(result.capEntrega).toBe(8);
  });

  it('1..3 → verde-amarillo', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: 3, sinAsignar: 0, movilesEnZona: 2 }));
    expect(result.color).toBe('#84cc16');
    expect(result.capEntrega).toBe(3);
  });

  it('cap = 0 → amarillo, label "0"', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: 0, sinAsignar: 0, movilesEnZona: 2 }));
    expect(result.color).toBe('#eab308');
    expect(result.label).toBe('0');
    expect(result.capEntrega).toBe(0);
  });

  it('sobrecupo leve (-3..-1) → naranja, visible para todos', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: -3, sinAsignar: 0, movilesEnZona: 2 }));
    expect(result.color).toBe('#f97316');
    expect(result.capEntrega).toBe(-3);
  });

  it('sobrecupo alto (cap <= -4) → rojo, visible para todos', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: -8, sinAsignar: 0, movilesEnZona: 2 }));
    expect(result.color).toBe('#ef4444');
    expect(result.capEntrega).toBe(-8);
  });

  it('sinAsignar afecta capEntrega pero no la banda del color positivo', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: 8, sinAsignar: 3, movilesEnZona: 2 }));
    expect(result.color).toBe('#22c55e');
    expect(result.capEntrega).toBe(5); // 8 - 3
    expect(result.label).toBe('5');
  });

  it('sinAsignar puede empujar capEntrega a negativo (sobrecupo visible para todos)', () => {
    const result = getCapEntregaColor(makeStats({ capacidadDisponible: 2, sinAsignar: 7, movilesEnZona: 2 }));
    expect(result.capEntrega).toBe(-5); // 2 - 7
    expect(result.color).toBe('#ef4444');
  });

  describe('boundaries de la escala absoluta', () => {
    it('cap=4 (mínimo holgura alta) → verde fuerte', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: 4, movilesEnZona: 2 })).color).toBe('#22c55e');
    });
    it('cap=3 (máximo holgura baja) → verde-amarillo', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: 3, movilesEnZona: 2 })).color).toBe('#84cc16');
    });
    it('cap=1 (mínimo positivo) → verde-amarillo', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: 1, capacidadTotal: 1, movilesEnZona: 1 })).color).toBe('#84cc16');
    });
    it('cap=-1 (sobrecupo leve mínimo) → naranja', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: -1, movilesEnZona: 2 })).color).toBe('#f97316');
    });
    it('cap=-3 (límite inferior sobrecupo leve) → naranja', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: -3, movilesEnZona: 2 })).color).toBe('#f97316');
    });
    it('cap=-4 (mínimo sobrecupo alto) → rojo', () => {
      expect(getCapEntregaColor(makeStats({ capacidadDisponible: -4, movilesEnZona: 2 })).color).toBe('#ef4444');
    });
  });
});
