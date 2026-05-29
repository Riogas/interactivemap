/**
 * Tests unitarios para la logica de conteo por subconjunto de moviles en zonas.
 * Feature 2026-05-29: combo "Moviles" (prio_transito / prioridad / transito) en MovilesZonasLayer.
 *
 * Casos cubiertos:
 *  1. prio_transito → cuenta todos (prioridad + transito)
 *  2. prioridad → solo prioridad_o_transito === 1
 *  3. transito → solo prioridad_o_transito !== 1
 *  4. Comportamiento correcto para URGENTE, SERVICE y NOCTURNO (unifica logica previa)
 *  5. Regresion: SERVICE + Transito antes coloreaba mal (ignoraba transito) — ahora correcto
 *  6. Zona sin moviles → count = 0
 *  7. Zona con solo tránsito, subset=prioridad → count = 0
 */

import { describe, it, expect } from 'vitest';

// ─── Tipos (replicados del componente para el test) ───────────────────────────

type MovilSubset = 'prio_transito' | 'prioridad' | 'transito';

interface MovilZonaRecord {
  movil_id: string;
  zona_id: number;
  prioridad_o_transito: number; // 1=prioridad, 2=transito
  tipo_de_servicio: string;
  escenario_id: number;
  activa: boolean;
}

// ─── Función extraida de MovilesZonasLayer (pura, sin React) ─────────────────

function computeSubsetCount(
  filteredData: MovilZonaRecord[],
  movilFilter: MovilSubset,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const mz of filteredData) {
    const isPrioridad = mz.prioridad_o_transito === 1;
    const incluir =
      movilFilter === 'prio_transito' ? true
      : movilFilter === 'prioridad'   ? isPrioridad
      : /* 'transito' */                !isPrioridad;
    if (!incluir) continue;
    map.set(mz.zona_id, (map.get(mz.zona_id) ?? 0) + 1);
  }
  return map;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRecord(zona_id: number, prioridad_o_transito: 1 | 2, tipo: string): MovilZonaRecord {
  return {
    movil_id: `movil-${Math.random()}`,
    zona_id,
    prioridad_o_transito,
    tipo_de_servicio: tipo,
    escenario_id: 1,
    activa: true,
  };
}

// Zona 1: 2 prioridad + 3 transito (= 5 total)
const zona1Records = [
  makeRecord(1, 1, 'URGENTE'),
  makeRecord(1, 1, 'URGENTE'),
  makeRecord(1, 2, 'URGENTE'),
  makeRecord(1, 2, 'URGENTE'),
  makeRecord(1, 2, 'URGENTE'),
];

// Zona 2: solo transito (3 moviles)
const zona2Records = [
  makeRecord(2, 2, 'SERVICE'),
  makeRecord(2, 2, 'SERVICE'),
  makeRecord(2, 2, 'SERVICE'),
];

// Zona 3: solo prioridad (2 moviles)
const zona3Records = [
  makeRecord(3, 1, 'NOCTURNO'),
  makeRecord(3, 1, 'NOCTURNO'),
];

const allRecords = [...zona1Records, ...zona2Records, ...zona3Records];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeSubsetCount', () => {
  describe('prio_transito (todos)', () => {
    it('cuenta prioridad + transito de zona 1', () => {
      const result = computeSubsetCount(allRecords, 'prio_transito');
      expect(result.get(1)).toBe(5); // 2 prio + 3 transito
    });

    it('cuenta solo transito de zona 2', () => {
      const result = computeSubsetCount(allRecords, 'prio_transito');
      expect(result.get(2)).toBe(3);
    });

    it('cuenta solo prioridad de zona 3', () => {
      const result = computeSubsetCount(allRecords, 'prio_transito');
      expect(result.get(3)).toBe(2);
    });
  });

  describe('prioridad', () => {
    it('cuenta solo prioridad de zona 1 (ignora transito)', () => {
      const result = computeSubsetCount(allRecords, 'prioridad');
      expect(result.get(1)).toBe(2); // 2 prio
    });

    it('zona 2 (solo transito) da 0 con filtro prioridad', () => {
      const result = computeSubsetCount(allRecords, 'prioridad');
      expect(result.get(2)).toBeUndefined(); // no hay prio en zona 2
    });

    it('zona 3 (solo prioridad) da 2', () => {
      const result = computeSubsetCount(allRecords, 'prioridad');
      expect(result.get(3)).toBe(2);
    });
  });

  describe('transito', () => {
    it('cuenta solo transito de zona 1 (ignora prioridad)', () => {
      const result = computeSubsetCount(allRecords, 'transito');
      expect(result.get(1)).toBe(3); // 3 transito
    });

    it('zona 2 (solo transito SERVICE) da 3 — regresion: antes ignoraba transito en SERVICE', () => {
      // Este test verifica la correccion del bug donde SERVICE + Transito se ignoraba.
      // Con la logica nueva, transito se cuenta correctamente para SERVICE tambien.
      const serviceRecords = zona2Records; // todos son SERVICE con prioridad_o_transito=2
      const result = computeSubsetCount(serviceRecords, 'transito');
      expect(result.get(2)).toBe(3);
    });

    it('zona 3 (solo prioridad NOCTURNO) da 0 con filtro transito', () => {
      const result = computeSubsetCount(allRecords, 'transito');
      expect(result.get(3)).toBeUndefined();
    });
  });

  describe('zona vacía', () => {
    it('zona sin moviles → no aparece en el mapa', () => {
      const result = computeSubsetCount([], 'prio_transito');
      expect(result.size).toBe(0);
    });
  });

  describe('tabla de casos de la spec (§5 Feature B)', () => {
    // Zona con prio=2, transito=3
    const specZona = [
      makeRecord(10, 1, 'URGENTE'), makeRecord(10, 1, 'URGENTE'),          // 2 prio
      makeRecord(10, 2, 'URGENTE'), makeRecord(10, 2, 'URGENTE'), makeRecord(10, 2, 'URGENTE'), // 3 transito
    ];

    it('URGENTE + prio_transito → 5', () => {
      expect(computeSubsetCount(specZona, 'prio_transito').get(10)).toBe(5);
    });
    it('URGENTE + prioridad → 2', () => {
      expect(computeSubsetCount(specZona, 'prioridad').get(10)).toBe(2);
    });
    it('URGENTE + transito → 3', () => {
      expect(computeSubsetCount(specZona, 'transito').get(10)).toBe(3);
    });

    // Mismo fixture pero con SERVICE (pre-fix coloreaba solo por prio=2)
    const specZonaService = [
      makeRecord(10, 1, 'SERVICE'), makeRecord(10, 1, 'SERVICE'),
      makeRecord(10, 2, 'SERVICE'), makeRecord(10, 2, 'SERVICE'), makeRecord(10, 2, 'SERVICE'),
    ];

    it('SERVICE + prio_transito → 5 (antes coloreaba solo 2)', () => {
      expect(computeSubsetCount(specZonaService, 'prio_transito').get(10)).toBe(5);
    });
    it('SERVICE + prioridad → 2', () => {
      expect(computeSubsetCount(specZonaService, 'prioridad').get(10)).toBe(2);
    });
    it('SERVICE + transito → 3 (antes ignoraba transito en SERVICE)', () => {
      expect(computeSubsetCount(specZonaService, 'transito').get(10)).toBe(3);
    });
  });
});
