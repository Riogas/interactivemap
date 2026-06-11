/**
 * Tests unitarios para el prorrateo PONDERADO en lib/zonas-cap-entrega.ts
 *
 * Fórmula (CapEntrega.docx 2026-06-11):
 *   aporte(zona) = (loteLibre / W_total) * peso_zona
 *   peso_zona = 1 (prioridad) | alpha (transito)
 *   W_total   = Σ pesos de todas las zonas que cubre el movil
 *
 * Sin ceil — los aportes pueden ser decimales (columna NUMERIC).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recomputeMock } = vi.hoisted(() => ({
  recomputeMock: vi.fn(),
}));

vi.mock('../lib/movil-counters', () => ({
  recomputeMovilCounters: recomputeMock,
}));

import { syncMovilZonasCapEntrega } from '../lib/zonas-cap-entrega';

function makeSupabaseMockProrrateo({
  movilRow,
  zonaRows,
  alpha = 0.5,
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

const PRIO = 1;
const TRANS = 2;

describe('syncMovilZonasCapEntrega — prorrateo ponderado (peso prio=1, transito=alpha)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Ejemplos del documento CapEntrega (alpha = 0.5, lote libre = 6)

  it('Ej A: 6 libres, 1 zona prioridad => aporta 6', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [{ zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO }],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    expect(u).toHaveLength(1);
    expect(u[0].lote_disponible).toBe(6); // (6/1)*1
  });

  it('Ej B: 6 libres, 3 zonas prioridad => 2 c/u', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
      ],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    expect(u).toHaveLength(3);
    for (const r of u) expect(r.lote_disponible).toBe(2); // (6/3)*1
  });

  it('Ej C: 6 libres, 1 zona transito (alpha=0.5) => aporta 6', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [{ zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS }],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    expect(u[0].lote_disponible).toBe(6); // (6/0.5)*0.5
  });

  it('Ej D: 6 libres, 2 zonas transito (alpha=0.5) => 3 c/u', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
      ],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    expect(u).toHaveLength(2);
    for (const r of u) expect(r.lote_disponible).toBe(3); // (6/1)*0.5
  });

  it('Ej E: 6 libres, 2 prioridad + 3 transito (alpha=0.5) => prio 1.7143, transito 0.8571', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 13, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 14, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
      ],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    // W_total = 2*1 + 3*0.5 = 3.5
    const prio = u.filter((r: any) => r.zona === 10 || r.zona === 11);
    const trans = u.filter((r: any) => r.zona >= 12);
    for (const r of prio) expect(r.lote_disponible).toBeCloseTo(1.7143, 3);   // (6/3.5)*1
    for (const r of trans) expect(r.lote_disponible).toBeCloseTo(0.8571, 3);  // (6/3.5)*0.5
  });

  // Edge cases

  it('lote_libre = 0 => todas las porciones 0', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 5, capacidad: 5 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
      ],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    for (const r of u) expect(r.lote_disponible).toBe(0);
  });

  it('lote_libre < 0 (sobrecupo) => todas las porciones 0', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 3, capacidad: 6 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
      ],
      alpha: 0.5,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    for (const r of u) expect(r.lote_disponible).toBe(0);
  });

  it('solo transito con alpha=0 => W_total=0 => porciones 0 (sin div/0)', async () => {
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 6, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
      ],
      alpha: 0,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    expect(u).toHaveLength(2);
    for (const r of u) expect(r.lote_disponible).toBe(0);
  });

  it('alpha=1: prioridad y transito pesan igual => reparto equitativo', async () => {
    // 2 prio + 2 transito, alpha=1, lote=8 => W=4 => (8/4)*1 = 2 cada zona
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 8, capacidad: 0 },
      zonaRows: [
        { zona_id: 10, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 11, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 12, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 13, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
      ],
      alpha: 1,
    });
    await syncMovilZonasCapEntrega(sb as any, 42);
    const u = sb.getUpserted();
    for (const r of u) expect(r.lote_disponible).toBe(2);
  });

  it('prorrateo SEPARADO por tipo de servicio: misma zona en URGENTE y NOCTURNO no diluye el aporte', async () => {
    // Caso real (móvil 558, zona 86): lote_libre=3, cubre zona 86 como PRIORIDAD
    // en URGENTE y en NOCTURNO. Cada tipo se prorratea independiente:
    //   URGENTE:  W=1 => (3/1)*1 = 3
    //   NOCTURNO: W=1 => (3/1)*1 = 3
    // (Antes, al sumar ambos tipos en W=2, daba 1.5 — incorrecto.)
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 1 },
      zonaRows: [
        { zona_id: 86, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 86, escenario_id: 1, tipo_de_servicio: 'NOCTURNO', prioridad_o_transito: PRIO },
      ],
      alpha: 0.3,
    });
    await syncMovilZonasCapEntrega(sb as any, 558);
    const u = sb.getUpserted();
    expect(u).toHaveLength(2);
    for (const r of u) expect(r.lote_disponible).toBe(3);
  });

  it('prorrateo por tipo: zona prio + zona transito repartidas dentro de cada tipo', async () => {
    // Móvil 559: lote_libre=2. URGENTE: zona86(prio)+zona91(trans). NOCTURNO: idem.
    //   W_urgente = 1 + 0.3 = 1.3
    //   zona86 URGENTE = (2/1.3)*1   = 1.5385
    //   zona91 URGENTE = (2/1.3)*0.3 = 0.4615
    const sb = makeSupabaseMockProrrateo({
      movilRow: { escenario_id: 1, empresa_fletera_id: 5, tamano_lote: 4, capacidad: 2 },
      zonaRows: [
        { zona_id: 86, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: PRIO },
        { zona_id: 91, escenario_id: 1, tipo_de_servicio: 'URGENTE', prioridad_o_transito: TRANS },
        { zona_id: 86, escenario_id: 1, tipo_de_servicio: 'NOCTURNO', prioridad_o_transito: PRIO },
        { zona_id: 91, escenario_id: 1, tipo_de_servicio: 'NOCTURNO', prioridad_o_transito: TRANS },
      ],
      alpha: 0.3,
    });
    await syncMovilZonasCapEntrega(sb as any, 559);
    const u = sb.getUpserted();
    const z86 = u.filter((r: any) => r.zona === 86);
    const z91 = u.filter((r: any) => r.zona === 91);
    for (const r of z86) expect(r.lote_disponible).toBeCloseTo(1.5385, 3);
    for (const r of z91) expect(r.lote_disponible).toBeCloseTo(0.4615, 3);
  });
});
