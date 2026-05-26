/**
 * Tests unitarios para el prorrateo con peso en lib/zonas-cap-entrega.ts
 *
 * MODELO B (confirmado por el usuario):
 *  - Prioridad: ceil(loteLibre / W_prio)  donde W_prio = cantidad de zonas prioridad
 *  - Tránsito:  ceil(loteLibre * alpha)   — alpha como descuento absoluto, sin prorrateo
 *
 * Casos cubiertos:
 *  1. Movil con 1 zona prioridad => lote completo (ceil(lote/1))
 *  2. Movil con 3 zonas prioridad iguales, lote=5 => ceil(5/3)=2 cada una
 *  3. Movil con 2 prioridad + 3 transito, lote=5, α=0.3 => prioridad ceil(5/2)=3 c/u, transito ceil(5*0.3)=2 c/u
 *  4. Movil con solo transito (sin prioridad), α=0.3, lote=5, 3 zonas => ceil(5*0.3)=2 c/u
 *  5. Movil con α=0, transito solo => cada zona recibe 0 (rows con lote_disponible=0)
 *  6. Movil con α=1, prioridad y transito => prioridad ceil(8/2)=4, transito ceil(8*1)=8
 *  7. Movil con lote_libre = 0 => todas las porciones 0
 *  8. Movil con lote_libre < 0 (sobrecupo) => todas las porciones 0
 *  9. [Modelo B] lote=10, alpha=0.3, 1 zona transito => ceil(10*0.3)=3
 * 10. [Modelo B] lote=10, alpha=0.3, 2 zonas transito + 1 prio => prio ceil(10/1)=10, transito ceil(10*0.3)=3
 * 11. [Modelo B] movil lote=10, en 2 zonas transito + 1 prio (alpha=0.3) — suma de aportes supera lote (intencional)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de recomputeMovilCounters
// ─────────────────────────────────────────────────────────────────────────────

const { recomputeMock } = vi.hoisted(() => ({
  recomputeMock: vi.fn(),
}));

vi.mock('../lib/movil-counters', () => ({
  recomputeMovilCounters: recomputeMock,
}));

import { syncMovilZonasCapEntrega } from '../lib/zonas-cap-entrega';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un mock de Supabase configurado para el prorrateo.
 * Incluye soporte para escenario_settings.peso_transito_alpha.
 */
function makeSupabaseMockProrrateo({
  movilRow,
  zonaRows,
  alpha = 0.3,
  existingData = [],
}: {
  movilRow: { escenario_id: number; empresa_fletera_id: number; tamano_lote: number; capacidad: number };
  zonaRows: Array<{ zona_id: number; escenario_id: number; tipo_de_servicio: string; prioridad_o_transito: number }>;
  alpha?: number;
  existingData?: Array<{ escenario: number; zona: number; tipo_servicio: string }>;
}) {
  const upsertedRows: any[] = [];

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

  const zonaChain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  const zonaRes = Promise.resolve({ data: zonaRows, error: null });
  zonaChain.then = zonaRes.then.bind(zonaRes);
  zonaChain.catch = zonaRes.catch.bind(zonaRes);
  zonaChain.finally = zonaRes.finally.bind(zonaRes);

  const mockFrom = vi.fn((table: string) => {
    if (table === 'moviles') return movilChain;
    if (table === 'escenario_settings') return settingsChain;
    if (table === 'moviles_zonas') return zonaChain;
    if (table === 'zonas_cap_entrega') {
      return {
        upsert: vi.fn((rows: any[]) => {
          upsertedRows.push(...rows);
          return { select: vi.fn().mockResolvedValue({ data: rows, error: null }) };
        }),
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: existingData, error: null }),
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
  });

  return { from: mockFrom, getUpserted: () => upsertedRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests de prorrateo — MODELO B
// ─────────────────────────────────────────────────────────────────────────────

describe('syncMovilZonasCapEntrega — modelo B (alpha como descuento absoluto)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: movil con 1 zona prioridad => ceil(lote/1) = lote completo', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(1);
    // lote_libre = 5, W_prio = 1, porcion = ceil(5 / 1) = 5
    expect(upserted[0].lote_disponible).toBe(5);
    expect(upserted[0].zona).toBe(10);
  });

  it('Caso 2: movil con 3 zonas prioridad, lote=5 => ceil(5/3)=2 cada una', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(3);
    // lote_libre = 5, W_prio = 3, porcion = ceil(5 / 3) = ceil(1.67) = 2
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(2);
    }
  });

  it('Caso 3 (Modelo B): 2 prioridad + 3 transito, lote=5, α=0.3 => prioridad ceil(5/2)=3, transito ceil(5*0.3)=2', async () => {
    // Prioridad: ceil(5 / 2) = ceil(2.5) = 3
    // Tránsito:  ceil(5 * 0.3) = ceil(1.5) = 2
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 13, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 14, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(5);

    const prioridades = upserted.filter((r: any) => r.zona === 10 || r.zona === 11);
    const transitos = upserted.filter((r: any) => r.zona === 12 || r.zona === 13 || r.zona === 14);

    expect(prioridades).toHaveLength(2);
    expect(transitos).toHaveLength(3);

    for (const p of prioridades) {
      expect(p.lote_disponible).toBe(3); // ceil(5/2) = 3
    }
    for (const t of transitos) {
      expect(t.lote_disponible).toBe(2); // ceil(5*0.3) = ceil(1.5) = 2
    }
  });

  it('Caso 4: movil con solo transito, α=0.3, lote=5, 3 zonas => cada zona ceil(5*0.3)=2', async () => {
    // Tránsito: ceil(5 * 0.3) = ceil(1.5) = 2 por zona (independiente de cuantas zonas hay)
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(3);
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(2); // ceil(5 * 0.3) = 2
    }
  });

  it('Caso 5: movil con α=0, solo transito => cada zona recibe 0 (rows generados con lote_disponible=0)', async () => {
    // Tránsito con alpha=0: ceil(loteLibre * 0) = 0 => rows con lote_disponible=0
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
      ],
      alpha: 0,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    // Modelo B: se generan filas con porcion=0 (a diferencia del modelo A que omitia rows con W=0)
    expect(upserted).toHaveLength(2);
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(0);
    }
  });

  it('Caso 6 (Modelo B): α=1, 2 prioridad + 2 transito, lote=8 => prioridad ceil(8/2)=4, transito ceil(8*1)=8', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 8, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
        { zona_id: 13, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
      ],
      alpha: 1,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(4);

    const prioridades = upserted.filter((r: any) => r.zona === 10 || r.zona === 11);
    const transitos = upserted.filter((r: any) => r.zona === 12 || r.zona === 13);

    for (const p of prioridades) {
      expect(p.lote_disponible).toBe(4); // ceil(8 / 2) = 4
    }
    for (const t of transitos) {
      expect(t.lote_disponible).toBe(8); // ceil(8 * 1) = 8
    }
  });

  it('Caso 7: movil con lote_libre = 0 => todas las porciones son 0', async () => {
    // tamano_lote = 5, capacidad = 5 => lote_libre = 0
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 5 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'TRANSITO', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(2);
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(0);
    }
  });

  it('Caso 8: movil con lote_libre < 0 (sobrecupo) => todas las porciones son 0', async () => {
    // tamano_lote = 3, capacidad = 6 => lote_libre = -3 => clamp a 0
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 3, capacidad: 6 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(2);
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(0);
    }
  });

  it('Caso 9 [Modelo B]: lote=10, alpha=0.3, 1 zona transito => ceil(10*0.3)=3', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 10, capacidad: 0 },
      zonaRows: [
        { zona_id: 20, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(1);
    // ceil(10 * 0.3) = ceil(3) = 3
    expect(upserted[0].lote_disponible).toBe(3);
    expect(upserted[0].zona).toBe(20);
  });

  it('Caso 10 [Modelo B]: lote=10, alpha=0.3, 2 zonas transito + 1 prio => prio ceil(10/1)=10, transito ceil(10*0.3)=3 c/u', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 10, capacidad: 0 },
      zonaRows: [
        { zona_id: 30, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 31, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 2 },
        { zona_id: 32, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(3);

    const prio = upserted.find((r: any) => r.zona === 30);
    const t1 = upserted.find((r: any) => r.zona === 31);
    const t2 = upserted.find((r: any) => r.zona === 32);

    expect(prio?.lote_disponible).toBe(10); // ceil(10 / 1) = 10
    expect(t1?.lote_disponible).toBe(3);    // ceil(10 * 0.3) = 3
    expect(t2?.lote_disponible).toBe(3);    // ceil(10 * 0.3) = 3
  });

  it('Caso 11 [Modelo B]: suma de aportes de transito puede superar tamano_lote (doble-cuenta intencional)', async () => {
    // lote=4, alpha=0.3, 1 prio + 2 transito
    // prio:    ceil(4 / 1) = 4
    // transito: ceil(4 * 0.3) = ceil(1.2) = 2 c/u => total transito = 4
    // Suma total aportes = 4 + 2 + 2 = 8 > tamano_lote=4 (esperado en Modelo B)
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 0 },
      zonaRows: [
        { zona_id: 40, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 },
        { zona_id: 41, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 2 },
        { zona_id: 42, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 2 },
      ],
      alpha: 0.3,
    });

    await syncMovilZonasCapEntrega(sb as any, 42);

    const upserted = sb.getUpserted();
    expect(upserted).toHaveLength(3);

    const prio = upserted.find((r: any) => r.zona === 40);
    const t1   = upserted.find((r: any) => r.zona === 41);
    const t2   = upserted.find((r: any) => r.zona === 42);

    expect(prio?.lote_disponible).toBe(4);  // ceil(4 / 1) = 4
    expect(t1?.lote_disponible).toBe(2);    // ceil(4 * 0.3) = ceil(1.2) = 2
    expect(t2?.lote_disponible).toBe(2);    // ceil(4 * 0.3) = ceil(1.2) = 2

    const suma = upserted.reduce((acc: number, r: any) => acc + r.lote_disponible, 0);
    // 4 + 2 + 2 = 8 > tamano_lote=4: doble-cuenta intencional del modelo B
    expect(suma).toBeGreaterThan(4);
    expect(suma).toBe(8);
  });
});
