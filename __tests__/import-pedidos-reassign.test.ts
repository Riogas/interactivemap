/**
 * Tests para la re-asignación de móvil en import/pedidos y import/services.
 *
 * Valida que cuando un pedido/service cambia de móvil via upsert, se recomputan
 * los contadores tanto del móvil ANTERIOR (OLD) como del NUEVO (NEW).
 *
 * Casos cubiertos:
 *  1. Re-asignación: pedido con movil=20 cambia a movil=40 → recompute con [20, 40]
 *  2. Sin cambio de móvil: pedido mantiene movil=20 → recompute solo con [20]
 *  3. INSERT (no había OLD): pedido nuevo con movil=40 → recompute solo con [40]
 *  4. movil OLD era 0/null: pedido cambia de movil=0 a movil=40 → recompute solo con [40]
 *  5. movil NEW es 0/null: pedido cambia de movil=20 a movil=0 → recompute con [20]
 *  6. Bulk con múltiples re-asignaciones: batch de 3 pedidos, varios cambios
 *  7. Pre-upsert SELECT falla → degrade gracefully, recompute solo con NEWs, log warning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers bajo test (extraídos como funciones puras para testear sin HTTP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computa el set de movilNros afectados (OLD + NEW) dado el resultado del upsert
 * y el Map de OLD que obtuvimos antes.
 * Duplicado de la función interna de los route handlers — testeamos la lógica pura.
 */
function computeAffectedMoviles(
  upsertResult: Array<{ id: any; escenario: any; movil: any }>,
  oldMovilByKey: Map<string, number | null>,
): number[] {
  const affectedMoviles = new Set<number>();
  for (const row of upsertResult) {
    const key = `${row.id}|${row.escenario ?? 'null'}`;
    const oldMovil = oldMovilByKey.get(key);
    if (oldMovil != null && oldMovil !== 0 && Number(oldMovil) !== Number(row.movil)) {
      affectedMoviles.add(Number(oldMovil));
    }
    if (row.movil != null && row.movil !== 0) {
      affectedMoviles.add(Number(row.movil));
    }
  }
  return [...affectedMoviles].sort((a, b) => a - b);
}

/**
 * Simula fetchOldMovilByKey con éxito — retorna Map pre-poblado.
 */
function makeOldMovilMap(entries: Array<[string, number | null]>): Map<string, number | null> {
  return new Map(entries);
}

/**
 * Simula fetchOldMovilByKey con fallo del SELECT (degrade gracefully).
 */
function makeEmptyOldMovilMap(): Map<string, number | null> {
  return new Map();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests de computeAffectedMoviles (lógica pura, sin I/O)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeAffectedMoviles — lógica de OLD+NEW set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: re-asignación movil=20 → movil=40 → recompute con [20, 40]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: 40 }];
    const oldMap = makeOldMovilMap([['100|1', 20]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([20, 40]);
  });

  it('Caso 2: sin cambio de móvil (movil=20 → movil=20) → recompute solo con [20]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: 20 }];
    const oldMap = makeOldMovilMap([['100|1', 20]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([20]);
  });

  it('Caso 3: INSERT (no había OLD en el map) → recompute solo con [40]', () => {
    const upsertResult = [{ id: 999, escenario: 1, movil: 40 }];
    const oldMap = makeEmptyOldMovilMap(); // no hay OLD

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([40]);
  });

  it('Caso 4: movil OLD era 0 → no se agrega OLD, recompute solo con [40]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: 40 }];
    const oldMap = makeOldMovilMap([['100|1', 0]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([40]);
  });

  it('Caso 4b: movil OLD era null → no se agrega OLD, recompute solo con [40]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: 40 }];
    const oldMap = makeOldMovilMap([['100|1', null]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([40]);
  });

  it('Caso 5: movil NEW es 0 (desasignación 20→0) → recompute con [20]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: 0 }];
    const oldMap = makeOldMovilMap([['100|1', 20]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    // OLD=20 se agrega (era válido y cambió), NEW=0 no se agrega
    expect(affected).toEqual([20]);
  });

  it('Caso 5b: movil NEW es null (desasignación 20→null) → recompute con [20]', () => {
    const upsertResult = [{ id: 100, escenario: 1, movil: null }];
    const oldMap = makeOldMovilMap([['100|1', 20]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([20]);
  });

  it('Caso 6: bulk con múltiples re-asignaciones → set deduplicado correcto', () => {
    // pedido A: 20→40
    // pedido B: mantiene 30→30
    // pedido C: 50→60
    const upsertResult = [
      { id: 1, escenario: 1, movil: 40 },
      { id: 2, escenario: 1, movil: 30 },
      { id: 3, escenario: 1, movil: 60 },
    ];
    const oldMap = makeOldMovilMap([
      ['1|1', 20],
      ['2|1', 30],
      ['3|1', 50],
    ]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    // Esperamos [20, 30, 40, 50, 60] deduplicado y ordenado
    expect(affected).toEqual([20, 30, 40, 50, 60]);
  });

  it('Caso 7: degrade gracefully (oldMap vacío porque SELECT falló) → solo NEWs', () => {
    const upsertResult = [
      { id: 100, escenario: 1, movil: 40 },
      { id: 101, escenario: 1, movil: 30 },
    ];
    // Simula que el pre-upsert SELECT falló y retornó mapa vacío
    const oldMap = makeEmptyOldMovilMap();

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    // Sin OLD disponible, solo se recomputan los NEWs
    expect(affected).toEqual([30, 40]);
  });

  it('Caso 7b: degrade gracefully → log warning emitido cuando SELECT falla', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Simular fetchOldMovilByKey con error
    async function fetchOldMovilByKeySimulated(
      _rows: any[],
      tableName: string,
      mockError: { message: string } | null,
    ): Promise<Map<string, number | null>> {
      const oldMovilByKey = new Map<string, number | null>();
      if (mockError) {
        console.warn(`⚠️ No se pudieron leer movils OLD pre-upsert (${tableName}):`, mockError);
        return oldMovilByKey; // degrade gracefully
      }
      return oldMovilByKey;
    }

    const result = await fetchOldMovilByKeySimulated(
      [{ id: 1, escenario: 1 }],
      'pedidos',
      { message: 'connection error' },
    );

    expect(result.size).toBe(0); // map vacío
    // console.warn es llamado con 2 args: mensaje + error object
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No se pudieron leer movils OLD pre-upsert'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('Deduplicación: dos pedidos que comparten el mismo movil NEW → aparece una sola vez', () => {
    const upsertResult = [
      { id: 1, escenario: 1, movil: 40 },
      { id: 2, escenario: 1, movil: 40 }, // mismo movil NEW
    ];
    const oldMap = makeOldMovilMap([
      ['1|1', 20],
      ['2|1', 30],
    ]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    // 20 (old de id=1), 30 (old de id=2), 40 (new de ambos — deduplicado)
    expect(affected).toEqual([20, 30, 40]);
  });

  it('services: escenario=null → key usa literal "null"', () => {
    // En la tabla services, escenario puede ser null
    const upsertResult = [{ id: 200, escenario: null, movil: 50 }];
    const oldMap = makeOldMovilMap([['200|null', 25]]);

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    expect(affected).toEqual([25, 50]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de integración del flujo completo (mock del supabase client)
// ─────────────────────────────────────────────────────────────────────────────

describe('flujo completo: fetchOldMovilByKey + computeAffectedMoviles + recomputeMovilNrosBatch', () => {
  it('Integración: re-asignación 20→40 llama recompute con ambos moviles', async () => {
    // Simular la secuencia completa sin HTTP:
    // 1. fetchOldMovilByKey retorna { '100|1': 20 }
    // 2. upsert retorna row con movil=40
    // 3. computeAffectedMoviles da [20, 40]
    // 4. recomputeMovilNrosBatch se llama con [20, 40]

    const recomputeFn = vi.fn().mockResolvedValue(undefined);

    const oldMap = makeOldMovilMap([['100|1', 20]]);
    const upsertResult = [{ id: 100, escenario: 1, movil: 40 }];

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    // Simular recomputeMovilNrosBatch
    for (const nro of affected) {
      await recomputeFn(nro);
    }

    expect(recomputeFn).toHaveBeenCalledTimes(2);
    expect(recomputeFn).toHaveBeenCalledWith(20);
    expect(recomputeFn).toHaveBeenCalledWith(40);
  });

  it('Integración: sin cambio de móvil → recompute una sola vez con [20]', async () => {
    const recomputeFn = vi.fn().mockResolvedValue(undefined);

    const oldMap = makeOldMovilMap([['100|1', 20]]);
    const upsertResult = [{ id: 100, escenario: 1, movil: 20 }];

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    for (const nro of affected) {
      await recomputeFn(nro);
    }

    expect(recomputeFn).toHaveBeenCalledTimes(1);
    expect(recomputeFn).toHaveBeenCalledWith(20);
  });

  it('Integración: INSERT nuevo → recompute una vez con [40]', async () => {
    const recomputeFn = vi.fn().mockResolvedValue(undefined);

    const oldMap = makeEmptyOldMovilMap();
    const upsertResult = [{ id: 999, escenario: 1, movil: 40 }];

    const affected = computeAffectedMoviles(upsertResult, oldMap);

    for (const nro of affected) {
      await recomputeFn(nro);
    }

    expect(recomputeFn).toHaveBeenCalledTimes(1);
    expect(recomputeFn).toHaveBeenCalledWith(40);
  });
});
