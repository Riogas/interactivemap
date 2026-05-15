/**
 * Tests unitarios para el prorrateo con peso en lib/zonas-cap-entrega.ts
 *
 * Casos cubiertos:
 *  1. Movil con 1 zona prioridad => lote completo asignado a esa zona
 *  2. Movil con 3 zonas prioridad iguales, lote=5 => ceil(5/3)=2 cada una (suma 6, sobreestima 1)
 *  3. Movil con 2 prioridad + 3 transito, lote=5, α=0.3 => prioridad ~2 c/u, transito ~1 c/u
 *  4. Movil con solo transito (sin prioridad), α=0.3, lote=5, 3 zonas => ceil(5/3)=2 (α se cancela)
 *  5. Movil con α=0, transito solo recibe 0 (W=0, sin upserts)
 *  6. Movil con α=1, prioridad y transito iguales
 *  7. Movil con lote_libre = 0 => todas las porciones 0
 *  8. Movil con lote_libre < 0 (sobrecupo) => todas las porciones 0
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
// Tests de prorrateo
// ─────────────────────────────────────────────────────────────────────────────

describe('syncMovilZonasCapEntrega — prorrateo con peso alpha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: movil con 1 zona prioridad => lote completo asignado a esa zona', async () => {
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
    // lote_libre = 5, W = 1, porcion = ceil(5 * 1 / 1) = 5
    expect(upserted[0].lote_disponible).toBe(5);
    expect(upserted[0].zona).toBe(10);
  });

  it('Caso 2: movil con 3 zonas prioridad iguales, lote=5 => ceil(5/3)=2 cada una', async () => {
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
    // lote_libre = 5, W = 3, porcion = ceil(5 * 1 / 3) = ceil(1.67) = 2
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(2);
    }
    // Suma total = 6 (sobreestima 1 — aceptable con ceiling)
    const suma = upserted.reduce((acc: number, r: any) => acc + r.lote_disponible, 0);
    expect(suma).toBe(6);
  });

  it('Caso 3: movil con 2 prioridad + 3 transito, lote=5, α=0.3 => distribución correcta', async () => {
    // W = 2*1 + 3*0.3 = 2 + 0.9 = 2.9
    // porcion_prioridad = ceil(5 * 1 / 2.9) = ceil(1.724) = 2
    // porcion_transito = ceil(5 * 0.3 / 2.9) = ceil(0.517) = 1
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
      expect(p.lote_disponible).toBe(2);
    }
    for (const t of transitos) {
      expect(t.lote_disponible).toBe(1);
    }
  });

  it('Caso 4: movil con solo transito, α=0.3, lote=5, 3 zonas => ceil(5/3)=2 (alpha se cancela)', async () => {
    // W = 3*0.3 = 0.9
    // porcion = ceil(5 * 0.3 / 0.9) = ceil(5/3) = ceil(1.67) = 2
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
      expect(row.lote_disponible).toBe(2);
    }
  });

  it('Caso 5: movil con α=0, solo transito => W=0, sin upserts', async () => {
    // W = 3*0 = 0 => no se generan filas
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
    // W = 0 => calcularPorciones retorna [] => sin upserts
    expect(upserted).toHaveLength(0);
  });

  it('Caso 6: movil con α=1, prioridad y transito iguales', async () => {
    // W = 2*1 + 2*1 = 4
    // porcion = ceil(8 * 1 / 4) = ceil(2) = 2
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
    for (const row of upserted) {
      expect(row.lote_disponible).toBe(2);
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
});
