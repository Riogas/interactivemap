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
});
