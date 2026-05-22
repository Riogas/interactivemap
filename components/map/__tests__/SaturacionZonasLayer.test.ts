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
// Nueva escala de color: ratio = capacidadDisponible / max(capacidadTotal, 1)
//  ratio > 0.5  → verde fuerte  #22c55e
//  0 < ratio <= 0.5 → verde-amarillo #84cc16
//  ratio = 0    → amarillo #eab308
//  -0.5 <= ratio < 0 → naranja #f97316  (solo con feature / isPrivileged)
//  ratio < -0.5 → rojo #ef4444          (solo con feature / isPrivileged)
// ─────────────────────────────────────────────────────────────────────────────

describe('getCapEntregaColor — nueva escala de ratio', () => {

  describe('sentinel -1000: sin moviles + sin pedidos (sin datos)', () => {
    const stats = makeStats({ movilesEnZona: 0, sinAsignar: 0 });

    it('isPrivileged=true -> label "—", gris', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.label).toBe('—');
      expect(result.capEntrega).toBe(-1000);
    });

    it('isPrivileged=false -> label "—", gris', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.label).toBe('—');
      expect(result.capEntrega).toBe(-1000);
    });
  });

  describe('sentinel -999: sin moviles + pedidos pendientes', () => {
    const stats = makeStats({ movilesEnZona: 0, sinAsignar: 5 });

    it('isPrivileged=true -> label "Sin Cap.", capEntrega=-999', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.label).toBe('Sin Cap.');
      expect(result.capEntrega).toBe(-999);
    });

    it('isPrivileged=false -> label "Sin Cap.", capEntrega=-999', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.label).toBe('Sin Cap.');
      expect(result.capEntrega).toBe(-999);
    });
  });

  describe('ratio > 0.5 → verde fuerte (#22c55e)', () => {
    // capacidadDisponible=8, capacidadTotal=10 → ratio=0.8 > 0.5
    const stats = makeStats({ capacidadDisponible: 8, capacidadTotal: 10, sinAsignar: 0, movilesEnZona: 2 });

    it('isPrivileged=true -> verde fuerte', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#22c55e');
      expect(result.capEntrega).toBe(8);
    });

    it('isPrivileged=false -> verde fuerte (cap no afecta positivos)', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.color).toBe('#22c55e');
    });
  });

  describe('0 < ratio <= 0.5 → verde-amarillo (#84cc16)', () => {
    // capacidadDisponible=3, capacidadTotal=10 → ratio=0.3, en [0, 0.5]
    const stats = makeStats({ capacidadDisponible: 3, capacidadTotal: 10, sinAsignar: 0, movilesEnZona: 2 });

    it('isPrivileged=true -> verde-amarillo', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#84cc16');
      expect(result.capEntrega).toBe(3);
    });
  });

  describe('ratio = 0 → amarillo (#eab308)', () => {
    // capacidadDisponible=0, capacidadTotal=10 → ratio=0
    const stats = makeStats({ capacidadDisponible: 0, capacidadTotal: 10, sinAsignar: 0, movilesEnZona: 2 });

    it('isPrivileged=true -> amarillo, label "0"', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#eab308');
      expect(result.label).toBe('0');
      expect(result.capEntrega).toBe(0);
    });

    it('isPrivileged=false -> amarillo (ratio 0, no negativo)', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.color).toBe('#eab308');
    });
  });

  describe('-0.5 <= ratio < 0 → naranja (#f97316) — solo con feature', () => {
    // capacidadDisponible=-3, capacidadTotal=10 → ratio=-0.3, en [-0.5, 0)
    // Solo visible con isPrivileged=true (sin feature, se capea a 0)
    const stats = makeStats({ capacidadDisponible: -3, capacidadTotal: 10, sinAsignar: 0, movilesEnZona: 2 });

    it('isPrivileged=true -> naranja', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#f97316');
      expect(result.capEntrega).toBe(-3);
    });

    it('isPrivileged=false -> color claro (capeado a 0, ratio=0 → amarillo)', () => {
      const result = getCapEntregaColor(stats, false);
      // Con isPrivileged=false, capacidadDisponible se capea a max(-3,0)=0 → ratio=0 → amarillo
      expect(result.color).toBe('#eab308');
    });
  });

  describe('ratio < -0.5 → rojo (#ef4444) — solo con feature', () => {
    // capacidadDisponible=-8, capacidadTotal=10 → ratio=-0.8 < -0.5
    const stats = makeStats({ capacidadDisponible: -8, capacidadTotal: 10, sinAsignar: 0, movilesEnZona: 2 });

    it('isPrivileged=true -> rojo', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#ef4444');
      expect(result.capEntrega).toBe(-8);
    });

    it('isPrivileged=false -> amarillo (capeado a 0, ratio=0)', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.color).toBe('#eab308');
    });
  });

  describe('sinAsignar afecta capEntrega pero NO el ratio del color', () => {
    // capacidadDisponible=8 → ratio=0.8 → verde fuerte
    // sinAsignar=3 → capEntrega=8-3=5 (label "5"), pero color sigue verde fuerte
    const stats = makeStats({ capacidadDisponible: 8, capacidadTotal: 10, sinAsignar: 3, movilesEnZona: 2 });

    it('isPrivileged=true -> verde fuerte, label "5"', () => {
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#22c55e');
      expect(result.capEntrega).toBe(5); // 8 - 3
      expect(result.label).toBe('5');
    });

    it('isPrivileged=false -> verde fuerte, sinAsignar ignorado (0)', () => {
      const result = getCapEntregaColor(stats, false);
      expect(result.color).toBe('#22c55e');
      expect(result.capEntrega).toBe(8); // sinAsignar=0 para no-privilegiado → 8-0=8
    });
  });

  describe('getCapEntregaColor — 5 bandas de ratio completas', () => {
    it('ratio exactamente 0.5 → verde-amarillo (boundary incluido en [0, 0.5])', () => {
      // capacidadDisponible=5, capacidadTotal=10 → ratio=0.5 → verde-amarillo
      const stats = makeStats({ capacidadDisponible: 5, capacidadTotal: 10, movilesEnZona: 2 });
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#84cc16');
    });

    it('ratio=0.51 → verde fuerte', () => {
      // capacidadDisponible=6, capacidadTotal=10 → ratio=0.6 → verde fuerte
      const stats = makeStats({ capacidadDisponible: 6, capacidadTotal: 10, movilesEnZona: 2 });
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#22c55e');
    });

    it('ratio=-0.5 → naranja (boundary inferior de naranja)', () => {
      // capacidadDisponible=-5, capacidadTotal=10 → ratio=-0.5 → naranja
      const stats = makeStats({ capacidadDisponible: -5, capacidadTotal: 10, movilesEnZona: 2 });
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#f97316');
    });

    it('ratio=-0.51 → rojo', () => {
      // capacidadDisponible=-6, capacidadTotal=10 → ratio=-0.6 → rojo
      const stats = makeStats({ capacidadDisponible: -6, capacidadTotal: 10, movilesEnZona: 2 });
      const result = getCapEntregaColor(stats, true);
      expect(result.color).toBe('#ef4444');
    });
  });
});
