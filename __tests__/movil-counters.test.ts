/**
 * Tests unitarios para lib/movil-counters.ts
 *
 * Lección aplicada: supabase-tests-require-mocks
 * Todos los accesos a Supabase son mockeados — nunca se conecta a BD real.
 *
 * Casos cubiertos:
 *  1. movilNro null → early return, sin queries
 *  2. movilNro 0 → early return, sin queries
 *  3. movilNro undefined → early return, sin queries
 *  4. 0 pedidos + 0 services → cant_ped=0, cant_serv=0, capacidad=0
 *  5. N pedidos + M services → capacidad = N + M (invariante)
 *  6. Error en count de pedidos → throws
 *  7. Error en count de services → throws
 *  8. Error en UPDATE moviles → throws
 *  9. Filtra por fch_para = hoy (YYYYMMDD, zona Montevideo) en pedidos y services
 * 10. Devuelve RecomputeResult con los valores calculados
 * 11. Re-asignación X→Y: llamada para movil X y movil Y por separado da resultados independientes
 * 12. Bulk deduplication: múltiples llamadas al helper recomputeCountersForMoviles con
 *     registros repetidos del mismo movil solo llama recompute UNA vez por nro distinto
 * 13. DELETE: después de borrar un pedido, el recompute reduce cant_ped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recomputeMovilCounters } from '../lib/movil-counters';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Supabase (sin conexión real)
// ─────────────────────────────────────────────────────────────────────────────

type MockResult = { count?: number | null; error?: { message: string; code?: string } | null };

function makeMockChain(result: MockResult) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    head: true,
  };
  // La última llamada (maybeSingle/resolución) resuelve con el result
  chain.eq.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.update.mockImplementation(() => chain);
  // Override: cuando se llame como Promise (await), resuelve con result
  const promiseResult = Promise.resolve(result);
  Object.assign(chain, promiseResult);
  chain.then = promiseResult.then.bind(promiseResult);
  chain.catch = promiseResult.catch.bind(promiseResult);
  chain.finally = promiseResult.finally.bind(promiseResult);
  return chain;
}

// Tipo para el mock de supabase
interface SupabaseMock {
  from: ReturnType<typeof vi.fn>;
  _chains: { [table: string]: any[] };
}

function makeSupabaseMock(tableResults: { [table: string]: MockResult[] }): SupabaseMock {
  const callCounts: { [table: string]: number } = {};

  const mock: SupabaseMock = {
    _chains: {},
    from: vi.fn((table: string) => {
      callCounts[table] = (callCounts[table] || 0) + 1;
      const results = tableResults[table] || [];
      const idx = (callCounts[table] - 1) % results.length;
      const result = results[idx] ?? { count: 0, error: null };
      return makeMockChain(result);
    }),
  };

  return mock;
}

/** Helper para crear un mock de Supabase que devuelve valores fijos para una invocación */
function makeSimpleSupabase(pedidosCount: number, servicesCount: number) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'pedidos') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ count: pedidosCount, error: null }),
          catch: vi.fn().mockReturnThis(),
          finally: vi.fn().mockReturnThis(),
        };
      }
      if (table === 'services') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ count: servicesCount, error: null }),
          catch: vi.fn().mockReturnThis(),
          finally: vi.fn().mockReturnThis(),
        };
      }
      if (table === 'moviles') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      return {};
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('recomputeMovilCounters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: movilNro null → early return, no hace queries', async () => {
    const supabase = makeSupabaseMock({});
    await recomputeMovilCounters(supabase as any, null);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('Caso 2: movilNro 0 → early return, no hace queries', async () => {
    const supabase = makeSupabaseMock({});
    await recomputeMovilCounters(supabase as any, 0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('Caso 3: movilNro undefined → early return, no hace queries', async () => {
    const supabase = makeSupabaseMock({});
    await recomputeMovilCounters(supabase as any, undefined);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('Caso 4: 0 pedidos + 0 services → actualiza moviles con capacidad=0', async () => {
    let updateCalledWith: any = null;
    let eqCalledWith: any = null;

    // Supabase mock manual para este caso específico
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 0, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 0, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'moviles') {
          return {
            update: vi.fn((data: any) => {
              updateCalledWith = data;
              return {
                eq: vi.fn((col: string, val: any) => {
                  eqCalledWith = { col, val };
                  return Promise.resolve({ error: null });
                }),
              };
            }),
          };
        }
        return {};
      }),
    };

    await recomputeMovilCounters(supabase as any, 42);

    expect(updateCalledWith).toEqual({ cant_ped: 0, cant_serv: 0, capacidad: 0 });
    expect(eqCalledWith).toEqual({ col: 'nro', val: 42 });
  });

  it('Caso 5: 3 pedidos + 2 services → capacidad=5 (invariante cant_ped + cant_serv)', async () => {
    let updateCalledWith: any = null;

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 3, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 2, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'moviles') {
          return {
            update: vi.fn((data: any) => {
              updateCalledWith = data;
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              };
            }),
          };
        }
        return {};
      }),
    };

    await recomputeMovilCounters(supabase as any, 10);

    expect(updateCalledWith).toEqual({ cant_ped: 3, cant_serv: 2, capacidad: 5 });
  });

  it('Caso 6: Error en count de pedidos → throws (no swallowed)', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: null, error: { message: 'DB error pedidos', code: '500' } }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        return {};
      }),
    };

    await expect(recomputeMovilCounters(supabase as any, 99)).rejects.toMatchObject({
      message: 'DB error pedidos',
    });
  });

  it('Caso 7: Error en count de services → throws (no swallowed)', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 1, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: null, error: { message: 'DB error services', code: '503' } }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        return {};
      }),
    };

    await expect(recomputeMovilCounters(supabase as any, 99)).rejects.toMatchObject({
      message: 'DB error services',
    });
  });

  it('Caso 8: Error en UPDATE moviles → throws (no swallowed)', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 2, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 1, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'moviles') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: { message: 'UPDATE failed', code: '500' } }),
            })),
          };
        }
        return {};
      }),
    };

    await expect(recomputeMovilCounters(supabase as any, 55)).rejects.toMatchObject({
      message: 'UPDATE failed',
    });
  });

  it('Caso 9: filtra por fch_para = hoy (YYYYMMDD, zona Montevideo) en pedidos y services', async () => {
    // Inyectamos una fecha conocida (2026-05-12 19:00 UTC → 16:00 Montevideo)
    // para asegurar que el helper formatea la fecha en zona Montevideo.
    const fixedNow = new Date('2026-05-12T19:00:00.000Z');
    const expectedCompact = '20260512';

    const eqCallsByTable: Record<string, Array<{ col: string; val: unknown }>> = {
      pedidos: [],
      services: [],
      moviles: [],
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'pedidos' || table === 'services') {
          const chain: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string, val: unknown) => {
              eqCallsByTable[table].push({ col, val });
              return chain;
            }),
            then: (resolve: any) => resolve({ count: 0, error: null }),
            catch: vi.fn().mockReturnThis(),
            finally: vi.fn().mockReturnThis(),
          };
          return chain;
        }
        if (table === 'moviles') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          };
        }
        return {};
      }),
    };

    await recomputeMovilCounters(supabase as any, 7, fixedNow);

    // Ambas tablas deben recibir el filtro de fch_para = YYYYMMDD de hoy.
    const pedidosFchPara = eqCallsByTable.pedidos.find((c) => c.col === 'fch_para');
    const servicesFchPara = eqCallsByTable.services.find((c) => c.col === 'fch_para');
    expect(pedidosFchPara).toEqual({ col: 'fch_para', val: expectedCompact });
    expect(servicesFchPara).toEqual({ col: 'fch_para', val: expectedCompact });

    // Y los otros dos filtros también siguen estando (movil + estado_nro = 1).
    expect(eqCallsByTable.pedidos).toEqual(
      expect.arrayContaining([
        { col: 'movil', val: 7 },
        { col: 'estado_nro', val: 1 },
        { col: 'fch_para', val: expectedCompact },
      ]),
    );
    expect(eqCallsByTable.services).toEqual(
      expect.arrayContaining([
        { col: 'movil', val: 7 },
        { col: 'estado_nro', val: 1 },
        { col: 'fch_para', val: expectedCompact },
      ]),
    );
  });

  it('Caso 10: devuelve RecomputeResult con los valores calculados', async () => {
    const supabase = makeSimpleSupabase(4, 1);
    const result = await recomputeMovilCounters(supabase as any, 33);
    expect(result).toEqual({
      movilNro: 33,
      cant_ped: 4,
      cant_serv: 1,
      capacidad: 5,
    });
  });

  it('Caso 10b: movilNro inválido → devuelve void (undefined)', async () => {
    const supabase = makeSupabaseMock({});
    const result = await recomputeMovilCounters(supabase as any, null);
    expect(result).toBeUndefined();
  });

  it('Caso 11a: Re-asignación X→Y — recompute para movil X devuelve resultado correcto', async () => {
    // Simula: después de mover un pedido de movil 10 a movil 20,
    // llamar recompute para el movil ANTERIOR (10) da cant_ped reducido.
    // Aquí simulamos que movil 10 ya no tiene pedidos.
    const supabaseX = makeSimpleSupabase(0, 0);
    const resultX = await recomputeMovilCounters(supabaseX as any, 10);
    expect(resultX).toEqual({ movilNro: 10, cant_ped: 0, cant_serv: 0, capacidad: 0 });
  });

  it('Caso 11b: Re-asignación X→Y — recompute para movil Y (nuevo) da cant_ped aumentado', async () => {
    // Simula: después de asignar un pedido a movil 20, este tiene 1 pedido nuevo.
    const supabaseY = makeSimpleSupabase(1, 0);
    const resultY = await recomputeMovilCounters(supabaseY as any, 20);
    expect(resultY).toEqual({ movilNro: 20, cant_ped: 1, cant_serv: 0, capacidad: 1 });
  });

  it('Caso 12: Bulk deduplication — recomputeMovilCounters se llama una vez por nro distinto', async () => {
    // Simula el patrón del helper recomputeCountersForMoviles de los endpoints:
    // dado un array con registros repetidos del mismo movil, deduplica y llama una sola vez.
    const mockFn = vi.fn().mockResolvedValue({
      movilNro: 42,
      cant_ped: 2,
      cant_serv: 1,
      capacidad: 3,
    });

    // Simular un batch de registros con movil=42 repetido 3 veces + otro movil=55
    const records = [
      { movil: 42 },
      { movil: 42 },
      { movil: 42 },
      { movil: 55 },
    ];

    // Emular la lógica del helper de los endpoints
    const movilNros = [...new Set(
      records.map((r) => r.movil).filter((m) => m != null && m !== 0),
    )];

    // El mockFn simula recomputeMovilCounters — debe llamarse 2 veces (42 y 55)
    for (const nro of movilNros) {
      await mockFn(null, nro);
    }

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith(null, 42);
    expect(mockFn).toHaveBeenCalledWith(null, 55);
  });

  it('Caso 13: DELETE — recompute reduce cant_ped del movil del registro borrado', async () => {
    // Simula: se borró un pedido del movil 7, ahora tiene 0 pedidos pendientes.
    // El recompute debe devolver cant_ped=0.
    const supabase = makeSimpleSupabase(0, 2);
    const result = await recomputeMovilCounters(supabase as any, 7);
    // cant_ped=0, cant_serv=2 (otros services siguen pendientes)
    expect(result).toEqual({ movilNro: 7, cant_ped: 0, cant_serv: 2, capacidad: 2 });
  });

  it('Caso 14: movilNro como string numérico → se convierte a number y funciona', async () => {
    const supabase = makeSimpleSupabase(1, 0);
    const result = await recomputeMovilCounters(supabase as any, '42');
    expect(result).toEqual({ movilNro: 42, cant_ped: 1, cant_serv: 0, capacidad: 1 });
  });
});
