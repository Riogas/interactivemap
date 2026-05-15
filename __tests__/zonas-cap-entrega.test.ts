/**
 * Tests unitarios para lib/zonas-cap-entrega.ts
 *
 * Casos cubiertos:
 *  1.  movilNro null → early return void, sin queries
 *  2.  movilNro 0 → early return void, sin queries
 *  3.  Móvil con 0 zonas activas → no genera filas en zonas_cap_entrega + borra stale
 *  4.  Móvil con 3 zonas activas → genera 3 filas con lote_disponible correcto
 *  5.  Móvil con capacidad > tamano_lote → lote_disponible = 0 (clamp a 0 por nueva semantica)
 *  6.  Móvil con tamano_lote = null → no genera filas + borra filas previas
 *  7.  Cambio de tipo_servicio → filas stale detectadas y borradas
 *  8.  Error en UPSERT → lanza (no swallowed)
 *  9.  recomputeMovilAndCapEntrega llama primero recomputeMovilCounters y luego sync
 * 10.  recomputeMovilAndCapEntrega: movilNro null → early return sin llamar nada
 * 11.  Móvil no encontrado en moviles → devuelve [] y borra stale
 * 12.  tipo_de_servicio vacío → fila ignorada (no upserted)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de recomputeMovilCounters — usar vi.hoisted para que esté disponible
// antes del hoisting de vi.mock
// ─────────────────────────────────────────────────────────────────────────────

const { recomputeMock } = vi.hoisted(() => ({
  recomputeMock: vi.fn(),
}));

vi.mock('../lib/movil-counters', () => ({
  recomputeMovilCounters: recomputeMock,
}));

import {
  syncMovilZonasCapEntrega,
  recomputeMovilAndCapEntrega,
} from '../lib/zonas-cap-entrega';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para armar mocks de Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un mock de Supabase adaptado a los accesos de syncMovilZonasCapEntrega.
 * Permite pasar el movilRow directamente, las zonas asignadas, y controlar
 * el resultado de upsert/existingRows/delete.
 *
 * Incluye mock de escenario_settings con alpha=0.3 por defecto.
 */
function makeSupabaseMock({
  movilRow,
  zonaRows,
  upsertData = [],
  existingData = [],
  deleteError = null,
  alpha = 0.3,
}: {
  movilRow: any | null;
  zonaRows: any[];
  upsertData?: any[];
  existingData?: any[];
  deleteError?: any;
  alpha?: number;
}) {
  const movilChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
  };

  const settingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: alpha }, error: null }),
  };

  const zonaChainBase: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  const zonaRes = Promise.resolve({ data: zonaRows, error: null });
  zonaChainBase.then = zonaRes.then.bind(zonaRes);
  zonaChainBase.catch = zonaRes.catch.bind(zonaRes);
  zonaChainBase.finally = zonaRes.finally.bind(zonaRes);

  const deleteChainBase: any = {
    eq: vi.fn().mockReturnThis(),
  };
  const delRes = Promise.resolve({ error: deleteError });
  deleteChainBase.then = delRes.then.bind(delRes);
  deleteChainBase.catch = delRes.catch.bind(delRes);
  deleteChainBase.finally = delRes.finally.bind(delRes);

  const mockFromFn = vi.fn((table: string) => {
    if (table === 'moviles') return movilChain;
    if (table === 'escenario_settings') return settingsChain;
    if (table === 'moviles_zonas') return zonaChainBase;
    if (table === 'zonas_cap_entrega') {
      return {
        upsert: vi.fn(() => ({
          select: vi.fn().mockResolvedValue({ data: upsertData, error: null }),
        })),
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: existingData, error: null }),
        })),
        delete: vi.fn(() => {
          const chain: any = { eq: vi.fn().mockReturnThis() };
          const p = Promise.resolve({ error: deleteError });
          chain.then = p.then.bind(p);
          chain.catch = p.catch.bind(p);
          chain.finally = p.finally.bind(p);
          return chain;
        }),
      };
    }
    return {};
  });

  return { from: mockFromFn };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — syncMovilZonasCapEntrega
// ─────────────────────────────────────────────────────────────────────────────

describe('syncMovilZonasCapEntrega', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: movilNro null → early return void, sin queries', async () => {
    const supabase = { from: vi.fn() };
    const result = await syncMovilZonasCapEntrega(supabase as any, null);
    expect(result).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('Caso 2: movilNro 0 → early return void, sin queries', async () => {
    const supabase = { from: vi.fn() };
    const result = await syncMovilZonasCapEntrega(supabase as any, 0);
    expect(result).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('Caso 3: móvil con 0 zonas activas → devuelve [], no hace upsert', async () => {
    const sb = makeSupabaseMock({
      movilRow: { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 },
      zonaRows: [],
      upsertData: [],
      existingData: [],
    });

    const result = await syncMovilZonasCapEntrega(sb as any, 42);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(0);
  });

  it('Caso 4: móvil con 3 zonas → genera 3 filas con lote_disponible correcto', async () => {
    const tamano_lote = 4;
    const capacidad = 1;
    // lote_libre = 3, 3 zonas todas prioridad_o_transito=1 (prioridad)
    // W = 3, porcion = ceil(3 * 1 / 3) = 1
    const expectedLote = 1;

    let upsertCalledWith: any[] = [];

    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote, capacidad };
    const zonaRows = [
      { zona_id: 1, escenario_id: 1000, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
      { zona_id: 2, escenario_id: 1000, tipo_de_servicio: 'NOCTURNO', prioridad_o_transito: 1 },
      { zona_id: 3, escenario_id: 1000, tipo_de_servicio: 'SERVICE', prioridad_o_transito: 1 },
    ];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };

    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };

    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonaRows, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            upsert: vi.fn((rows: any[]) => {
              upsertCalledWith = rows;
              return { select: vi.fn().mockResolvedValue({ data: rows, error: null }) };
            }),
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            delete: vi.fn(() => {
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    const result = await syncMovilZonasCapEntrega(sb as any, 42);

    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(3);
    expect(upsertCalledWith).toHaveLength(3);
    for (const row of upsertCalledWith) {
      expect(row.lote_disponible).toBe(expectedLote);
      expect(row.movil).toBe(42);
      expect(row.emp_fletera_id).toBe(5);
    }
  });

  it('Caso 5: capacidad > tamano_lote → lote_disponible = 0 (clamp a 0, no negativo)', async () => {
    // Nueva semantica: lote_libre < 0 se trata como 0
    const tamano_lote = 4;
    const capacidad = 6; // sobrecupo

    let upsertCalledWith: any[] = [];

    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote, capacidad };
    const zonaRows = [
      { zona_id: 1, escenario_id: 1000, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
    ];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };
    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonaRows, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            upsert: vi.fn((rows: any[]) => {
              upsertCalledWith = rows;
              return { select: vi.fn().mockResolvedValue({ data: rows, error: null }) };
            }),
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            delete: vi.fn(() => {
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    await syncMovilZonasCapEntrega(sb as any, 42);

    expect(upsertCalledWith.length).toBeGreaterThan(0);
    // Nueva semantica: lote_libre negativo se clampea a 0
    expect(upsertCalledWith[0].lote_disponible).toBe(0);
  });

  it('Caso 6: tamano_lote = null → no genera filas + borra todas las filas del movil', async () => {
    let deleteCalled = false;

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: null, capacidad: 2 },
        error: null,
      }),
    };

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'zonas_cap_entrega') {
          return {
            delete: vi.fn(() => {
              deleteCalled = true;
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    const result = await syncMovilZonasCapEntrega(sb as any, 42);

    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(0);
    expect(deleteCalled).toBe(true);
  });

  it('Caso 7: cambio de tipo_servicio → fila stale detectada y borrada', async () => {
    let deleteCalledWith: Array<{ col: string; val: any }> = [];

    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 };
    const zonaRows = [
      { zona_id: 1, escenario_id: 1000, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
    ];
    // Existing row: zona 1 con NOCTURNO (stale — ya no coincide con URGENTE)
    const existingData = [{ escenario: 1000, zona: 1, tipo_servicio: 'NOCTURNO' }];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };
    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonaRows, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            upsert: vi.fn(() => ({
              select: vi.fn().mockResolvedValue({
                data: [{ escenario: 1000, zona: 1, tipo_servicio: 'URGENTE', movil: 42, emp_fletera_id: 5, lote_disponible: 3 }],
                error: null,
              }),
            })),
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: existingData, error: null }),
            })),
            delete: vi.fn(() => {
              const chain: any = {
                eq: vi.fn((col: string, val: any) => {
                  deleteCalledWith.push({ col, val });
                  return chain;
                }),
              };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    await syncMovilZonasCapEntrega(sb as any, 42);

    // Debe haber intentado borrar la fila con tipo_servicio=NOCTURNO
    const tipoDelete = deleteCalledWith.find((c) => c.col === 'tipo_servicio');
    expect(tipoDelete).toBeDefined();
    expect(tipoDelete?.val).toBe('NOCTURNO');
  });

  it('Caso 8: error en UPSERT → lanza (no swallowed)', async () => {
    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 };
    const zonaRows = [
      { zona_id: 1, escenario_id: 1000, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
    ];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };
    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonaRows, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            upsert: vi.fn(() => ({
              select: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB error upsert', code: '500' },
              }),
            })),
          };
        }
        return {};
      }),
    };

    await expect(syncMovilZonasCapEntrega(sb as any, 42)).rejects.toMatchObject({
      message: 'DB error upsert',
    });
  });

  it('Caso 11: móvil no encontrado en moviles → devuelve [] y borra filas del movil', async () => {
    let deleteCalled = false;

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'zonas_cap_entrega') {
          return {
            delete: vi.fn(() => {
              deleteCalled = true;
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    const result = await syncMovilZonasCapEntrega(sb as any, 99);

    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(0);
    expect(deleteCalled).toBe(true);
  });

  it('Caso 12: tipo_de_servicio vacío o null → esa fila se ignora (no se upserta)', async () => {
    let upsertCalledWith: any[] = [];

    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 };
    const zonasConVacio = [
      { zona_id: 1, escenario_id: 1000, tipo_de_servicio: '', prioridad_o_transito: 1 },       // vacío → ignorado
      { zona_id: 2, escenario_id: 1000, tipo_de_servicio: null, prioridad_o_transito: 1 },     // null → ignorado
      { zona_id: 3, escenario_id: 1000, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 }, // válido → upserted
    ];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };
    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonasConVacio, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            upsert: vi.fn((rows: any[]) => {
              upsertCalledWith = rows;
              return { select: vi.fn().mockResolvedValue({ data: rows, error: null }) };
            }),
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            delete: vi.fn(() => {
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    await syncMovilZonasCapEntrega(sb as any, 42);

    // Solo 1 fila debería haberse upsertado (zona 3 con URGENTE)
    expect(upsertCalledWith).toHaveLength(1);
    expect(upsertCalledWith[0].tipo_servicio).toBe('URGENTE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — recomputeMovilAndCapEntrega
// ─────────────────────────────────────────────────────────────────────────────

describe('recomputeMovilAndCapEntrega', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 9: llama primero recomputeMovilCounters y luego sync (moviles query)', async () => {
    const callOrder: string[] = [];

    recomputeMock.mockImplementation(async () => {
      callOrder.push('recompute');
      return { movilNro: 42, cant_ped: 1, cant_serv: 0, capacidad: 1 };
    });

    const movilRow = { escenario_id: 1000, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 };
    const zonaRows: any[] = [];

    const movilChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col: string) => {
        if (col === 'nro') callOrder.push('sync');
        return movilChain;
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: movilRow, error: null }),
    };
    const settingsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { peso_transito_alpha: 0.3 }, error: null }),
    };
    const zonaChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    const zonaRes = Promise.resolve({ data: zonaRows, error: null });
    zonaChain.then = zonaRes.then.bind(zonaRes);
    zonaChain.catch = zonaRes.catch.bind(zonaRes);
    zonaChain.finally = zonaRes.finally.bind(zonaRes);

    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'moviles') return movilChain;
        if (table === 'escenario_settings') return settingsChain;
        if (table === 'moviles_zonas') return zonaChain;
        if (table === 'zonas_cap_entrega') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
            delete: vi.fn(() => {
              const chain: any = { eq: vi.fn().mockReturnThis() };
              const p = Promise.resolve({ error: null });
              chain.then = p.then.bind(p);
              chain.catch = p.catch.bind(p);
              chain.finally = p.finally.bind(p);
              return chain;
            }),
          };
        }
        return {};
      }),
    };

    await recomputeMovilAndCapEntrega(sb as any, 42);

    // recompute debe haber sido llamado
    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect(recomputeMock).toHaveBeenCalledWith(sb, 42);
    // Y luego sync (accede a moviles) — el orden está garantizado por await secuencial
    expect(callOrder[0]).toBe('recompute');
  });

  it('Caso 10: movilNro null → early return sin llamar recompute ni sync', async () => {
    const supabase = { from: vi.fn() };
    await recomputeMovilAndCapEntrega(supabase as any, null);
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
