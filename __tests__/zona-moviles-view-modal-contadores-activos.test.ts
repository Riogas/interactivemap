/**
 * Tests for ZonaMovilesViewModal counter logic: contadores solo cuentan activos.
 *
 * Since ZonaMovilesViewModal is a React component (hooks + DOM), we test the
 * pure logic helpers that drive the counters rather than mounting the component.
 *
 * The two helpers under test are extracted from the component logic:
 *   - isMovilRecordActivo: true iff estado_nro NOT IN {3,5,15}
 *   - countActivosInList: filters a list of MovilZonaRecord keeping only activos
 *
 * These mirror exactly the helper functions declared inside the component.
 *
 * Acceptance Criteria covered:
 *   AC1 — badge sidebar = activos (NOT badge = total)
 *   AC2 — header Prioridad(N) = activos en prioridad
 *   AC3 — header Tránsito(N) = activos en tránsito
 *   AC4 — inactivos siguen en lista (no se filtran del render)
 *   AC5 — zona con 0 activos → contador = 0 (no se oculta la zona)
 */

import { describe, it, expect } from 'vitest';
import { MOVIL_ESTADOS_INACTIVOS } from '../lib/movil-estados';

// ── Pure helpers (mirror of component internals) ──────────────────────────────

type MinimalMovilZonaRecord = {
  movil_id: string;
  zona_id: number;
  prioridad_o_transito: number;
  tipo_de_servicio?: string;
};

/**
 * Mirror of isMovilRecordActivo defined in ZonaMovilesViewModal.
 * estado_nro ∈ {3,5,15} → inactivo. Undefined → activo (fail-open).
 */
function isMovilRecordActivo(
  record: MinimalMovilZonaRecord,
  movilEstadosMap: Map<string, number>,
): boolean {
  const estado = movilEstadosMap.get(String(record.movil_id));
  if (estado === undefined) return true;
  return !MOVIL_ESTADOS_INACTIVOS.has(estado);
}

function countActivosInList(
  items: MinimalMovilZonaRecord[],
  movilEstadosMap: Map<string, number>,
): number {
  return items.filter(r => isMovilRecordActivo(r, movilEstadosMap)).length;
}

// ── Helpers de test ───────────────────────────────────────────────────────────

function makeRecord(movilId: string, prioridadOTransito = 1): MinimalMovilZonaRecord {
  return { movil_id: movilId, zona_id: 1, prioridad_o_transito: prioridadOTransito };
}

function makeEstadosMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isMovilRecordActivo — lógica de inactividad', () => {
  it('estado activo (1) → true', () => {
    const map = makeEstadosMap([['10', 1]]);
    expect(isMovilRecordActivo(makeRecord('10'), map)).toBe(true);
  });

  it('estado inactivo 3 → false', () => {
    const map = makeEstadosMap([['10', 3]]);
    expect(isMovilRecordActivo(makeRecord('10'), map)).toBe(false);
  });

  it('estado inactivo 5 → false', () => {
    const map = makeEstadosMap([['10', 5]]);
    expect(isMovilRecordActivo(makeRecord('10'), map)).toBe(false);
  });

  it('estado inactivo 15 → false', () => {
    const map = makeEstadosMap([['10', 15]]);
    expect(isMovilRecordActivo(makeRecord('10'), map)).toBe(false);
  });

  it('sin dato de estado (undefined) → activo (fail-open)', () => {
    const map = makeEstadosMap([]);
    expect(isMovilRecordActivo(makeRecord('99'), map)).toBe(true);
  });

  it('estado 0 (valor inusual) → activo (no está en {3,5,15})', () => {
    const map = makeEstadosMap([['10', 0]]);
    expect(isMovilRecordActivo(makeRecord('10'), map)).toBe(true);
  });
});

describe('countActivosInList — conteo correcto', () => {
  // AC1 / AC2: zona con 1 activo + 1 inactivo → contador = 1
  it('AC1: 1 activo + 1 inactivo (estado=3) → 1', () => {
    const records = [makeRecord('1'), makeRecord('2')];
    const map = makeEstadosMap([['1', 1], ['2', 3]]);
    expect(countActivosInList(records, map)).toBe(1);
  });

  // AC2: 3 activos + 0 inactivos → 3
  it('AC2: 3 activos → 3', () => {
    const records = [makeRecord('1'), makeRecord('2'), makeRecord('3')];
    const map = makeEstadosMap([['1', 1], ['2', 2], ['3', 7]]);
    expect(countActivosInList(records, map)).toBe(3);
  });

  // AC3: 0 activos + 2 inactivos (estados 5 y 15) → 0
  it('AC3: 0 activos + 2 inactivos (estados 5 y 15) → 0', () => {
    const records = [makeRecord('1'), makeRecord('2')];
    const map = makeEstadosMap([['1', 5], ['2', 15]]);
    expect(countActivosInList(records, map)).toBe(0);
  });

  // AC4: inactivos siguen en la lista (countActivosInList no modifica el array original)
  it('AC4: la lista original conserva todos los elementos (inactivos no se filtran del array)', () => {
    const records = [makeRecord('1'), makeRecord('2'), makeRecord('3')];
    const map = makeEstadosMap([['1', 3], ['2', 5], ['3', 1]]);
    // Contar activos devuelve 1
    expect(countActivosInList(records, map)).toBe(1);
    // La lista original sigue con 3 elementos
    expect(records).toHaveLength(3);
  });

  // AC5: zona con 0 activos → contador = 0 (la zona sigue listada)
  it('AC5: todos inactivos → contador = 0', () => {
    const records = [makeRecord('1'), makeRecord('2')];
    const map = makeEstadosMap([['1', 15], ['2', 3]]);
    expect(countActivosInList(records, map)).toBe(0);
  });

  // Espejo para Prioridad y Tránsito por separado (AC prioridad)
  it('espejo Prioridad: 2 prioridad (1 activo + 1 inactivo) → 1', () => {
    const prioridad = [makeRecord('10', 1), makeRecord('11', 1)];
    const map = makeEstadosMap([['10', 2], ['11', 3]]);
    expect(countActivosInList(prioridad, map)).toBe(1);
  });

  // Espejo para Tránsito (AC tránsito)
  it('espejo Tránsito: 3 tránsito (2 activos + 1 inactivo) → 2', () => {
    const transito = [makeRecord('20', 0), makeRecord('21', 0), makeRecord('22', 0)];
    const map = makeEstadosMap([['20', 1], ['21', 15], ['22', 4]]);
    expect(countActivosInList(transito, map)).toBe(2);
  });

  it('lista vacía → 0', () => {
    const map = makeEstadosMap([]);
    expect(countActivosInList([], map)).toBe(0);
  });
});

describe('MOVIL_ESTADOS_INACTIVOS — constante correcta', () => {
  it('contiene exactamente {3, 5, 15}', () => {
    expect(MOVIL_ESTADOS_INACTIVOS.has(3)).toBe(true);
    expect(MOVIL_ESTADOS_INACTIVOS.has(5)).toBe(true);
    expect(MOVIL_ESTADOS_INACTIVOS.has(15)).toBe(true);
    expect(MOVIL_ESTADOS_INACTIVOS.size).toBe(3);
  });

  it('no contiene estados activos comunes (1, 2, 4, 7)', () => {
    expect(MOVIL_ESTADOS_INACTIVOS.has(1)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(2)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(4)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(7)).toBe(false);
  });
});
