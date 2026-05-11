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

describe('getCapEntregaColor', () => {
  describe('capEntrega < 0 (calculo real, no sentinel)', () => {
    const negativeCases = [-1, -5, -100];

    negativeCases.forEach((capEntrega) => {
      const sinAsignar = Math.abs(capEntrega) + 5;
      const capacidadDisponible = 5;
      // capEntrega = capacidadDisponible - sinAsignar = 5 - (|capEntrega|+5) = -|capEntrega|
      const stats = makeStats({ sinAsignar, capacidadDisponible, movilesEnZona: 2 });

      it(`isPrivileged=true, capEntrega=${capEntrega} -> label "${capEntrega}"`, () => {
        const result = getCapEntregaColor(stats, true);
        expect(result.label).toBe(String(capEntrega));
        expect(result.color).toBe('#92400e');
        expect(result.capEntrega).toBe(capEntrega);
      });

      it(`isPrivileged=false, capEntrega=${capEntrega} -> label "Sin Cap."`, () => {
        const result = getCapEntregaColor(stats, false);
        expect(result.label).toBe('Sin Cap.');
        expect(result.color).toBe('#92400e');
        expect(result.capEntrega).toBe(capEntrega);
      });
    });
  });

  describe('sentinel -999: sin moviles + pedidos pendientes', () => {
    const stats = makeStats({ movilesEnZona: 0, sinAsignar: 5 });

    it('isPrivileged=true -> label "Sin Cap." (sentinel, no se muestra numero)', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.label).toBe('Sin Cap.');
      expect(result.capEntrega).toBe(-999);
      expect(result.color).toBe('#92400e');
    });

    it('isPrivileged=false -> label "Sin Cap."', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.label).toBe('Sin Cap.');
      expect(result.capEntrega).toBe(-999);
    });
  });

  describe('sentinel -1000: sin moviles + sin pedidos (sin datos)', () => {
    const stats = makeStats({ movilesEnZona: 0, sinAsignar: 0 });

    it('isPrivileged=true -> label "—"', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.label).toBe('—');
      expect(result.capEntrega).toBe(-1000);
      expect(result.color).toBe('#d1d5db');
    });

    it('isPrivileged=false -> label "—"', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.label).toBe('—');
      expect(result.capEntrega).toBe(-1000);
    });
  });

  describe('capEntrega >= 0 (bandas positivas, isPrivileged no afecta label)', () => {
    it('capEntrega=0 -> rojo label "0"', () => {
      const stats = makeStats({ capacidadDisponible: 3, sinAsignar: 3 });
      expect(getCapEntregaColor(stats, true)).toMatchObject({ color: '#ef4444', label: '0', capEntrega: 0 });
      expect(getCapEntregaColor(stats, false)).toMatchObject({ color: '#ef4444', label: '0', capEntrega: 0 });
    });

    it('capEntrega=1 -> naranja label "1"', () => {
      const stats = makeStats({ capacidadDisponible: 4, sinAsignar: 3 });
      expect(getCapEntregaColor(stats, true)).toMatchObject({ color: '#f97316', label: '1', capEntrega: 1 });
    });

    it('capEntrega=2 -> amarillo label "2"', () => {
      const stats = makeStats({ capacidadDisponible: 5, sinAsignar: 3 });
      expect(getCapEntregaColor(stats, true)).toMatchObject({ color: '#eab308', label: '2', capEntrega: 2 });
    });

    it('capEntrega=3 -> amarillo label "3"', () => {
      const stats = makeStats({ capacidadDisponible: 6, sinAsignar: 3 });
      expect(getCapEntregaColor(stats, true)).toMatchObject({ color: '#eab308', label: '3', capEntrega: 3 });
    });

    it('capEntrega=10 -> verde claro label "10"', () => {
      const stats = makeStats({ capacidadDisponible: 13, sinAsignar: 3 });
      expect(getCapEntregaColor(stats, true)).toMatchObject({ color: '#86efac', label: '10', capEntrega: 10 });
    });
  });
});
