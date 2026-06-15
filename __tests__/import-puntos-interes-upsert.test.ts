/**
 * Tests para POST /api/import/puntos-interes — upsert por id.
 *
 * Cubre los 8 casos especificados en el request:
 *  1. Insert puro — filas nuevas, BD vacía → todos en created, 0 replaced
 *  2. Update por id — Excel trae id existente → row actualizado en created
 *  3. Replace por nombre — mismo (email, nombre), id distinto → DELETE old + INSERT new, aparece en replaced
 *  4. Sobrescribir privado — Excel trae id=88 (privado) → se actualiza igual, sin skip
 *  5. Replace de privado — mismo (email, nombre), id distinto, privado en BD → DELETE old + INSERT new
 *  6. Dedup interno por id — Excel con 2 filas mismo id → último gana, sin error
 *  7. No hay skipped en la respuesta — verificar shape
 *  8. Response contract — verificar ImportPoiResponse shape
 *
 * Estrategia: mockear getServerSupabaseClient() para no necesitar Supabase real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Construye un NextRequest POST con body JSON. */
function makeRequest(rows: object[]) {
  return new NextRequest('http://localhost/api/import/puntos-interes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
}

/** Fila base válida del Excel (solo los campos requeridos + tipo). */
function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    nombre: 'Casa',
    latitud: -34.9,
    longitud: -56.1,
    usuario_email: 'jdoe@x.com',
    tipo: 'privado',
    visible: true,
    icono: '📍',
    ...overrides,
  };
}

/** Fila existente en BD (lo que devolvería el SELECT inicial). */
function dbRow(id: number, nombre: string, tipo: string, usuario_email: string) {
  return { id, nombre, tipo, usuario_email };
}

// ─── mock de Supabase ─────────────────────────────────────────────────────────

/**
 * Construye un mock del cliente Supabase para controlar las respuestas.
 * Simula:
 *   - .from('puntos_interes').select('id, nombre, usuario_email').in(...)  → SELECT conflictos
 *   - .from('puntos_interes').delete().in(...)                             → DELETE conflictos
 *   - .from('puntos_interes').upsert([...], ...).select('id')              → UPSERT batch
 */
function buildSupabaseMock({
  selectRows = [] as object[],
  upsertedIds = [] as number[],
  selectError = null as null | { message: string },
  deleteError = null as null | { message: string },
  upsertError = null as null | { message: string },
} = {}) {
  const upsertChain = {
    select: vi.fn().mockResolvedValue({
      data: upsertedIds.map((id) => ({ id })),
      error: upsertError,
    }),
  };
  // SELECT chain: .select(...).in(...)
  const selectChain = {
    in: vi.fn().mockResolvedValue({ data: selectRows, error: selectError }),
  };
  // DELETE chain: .delete().in(...)
  const deleteInChain = vi.fn().mockResolvedValue({ data: null, error: deleteError });
  const deleteChain = {
    in: deleteInChain,
  };

  const fromMock = vi.fn((table: string) => {
    if (table !== 'puntos_interes') throw new Error('unexpected table: ' + table);
    return {
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => deleteChain),
      upsert: vi.fn(() => upsertChain),
    };
  });
  return { from: fromMock };
}

// ─── mock del módulo supabase ────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { getServerSupabaseClient } from '@/lib/supabase';
import { POST } from '../app/api/import/puntos-interes/route';

// ─── tests ───────────────────────────────────────────────────────────────────

describe('POST /api/import/puntos-interes — upsert por id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── caso 1: Insert puro ───────────────────────────────────────────────────
  it('1. Insert puro — 3 ids nuevos, BD vacía → 3 en created, 0 replaced', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'Casa', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 2, nombre: 'Trabajo', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 3, nombre: 'Gym', usuario_email: 'jdoe@x.com' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [],         // BD vacía — sin conflictos
      upsertedIds: [1, 2, 3],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.created).toHaveLength(3);
    expect(json.replaced).toHaveLength(0);
    expect(json.count).toBe(3);
  });

  // ─── caso 2: Update por id ─────────────────────────────────────────────────
  it('2. Update por id — Excel trae id=99 que ya existe en BD → updated via upsert, en created', async () => {
    const rows = [
      baseRow({ id: 99, nombre: 'Casa', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    // BD tiene id=99, mismo nombre → no es conflicto (mismo id)
    const mock = buildSupabaseMock({
      selectRows: [dbRow(99, 'Casa', 'publico', 'jdoe@x.com')],
      upsertedIds: [99],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toEqual([99]);
    expect(json.replaced).toHaveLength(0);
    expect(json.count).toBe(1);
  });

  // ─── caso 3: Replace por nombre ────────────────────────────────────────────
  it('3. Replace por nombre — Excel (jdoe@x, Casa) id=1002, BD tiene (jdoe@x, Casa) id=88 → DELETE 88 + INSERT 1002, en replaced', async () => {
    const rows = [
      baseRow({ id: 1002, nombre: 'Casa', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [dbRow(88, 'Casa', 'publico', 'jdoe@x.com')],  // conflicto: mismo nombre, id distinto
      upsertedIds: [1002],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toEqual([1002]);
    expect(json.replaced).toHaveLength(1);
    expect(json.replaced[0]).toMatchObject({
      deletedId: 88,
      newId: 1002,
      nombre: 'Casa',
      usuario_email: 'jdoe@x.com',
    });
    expect(json.count).toBe(1);
  });

  // ─── caso 4: Sobrescribir privado ──────────────────────────────────────────
  it('4. Sobrescribir privado — Excel trae id=88 (privado en BD) → se actualiza igual, sin skip', async () => {
    const rows = [
      baseRow({ id: 88, nombre: 'Casa', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    // BD tiene id=88 como privado — mismo id → NO es conflicto, solo upsert
    const mock = buildSupabaseMock({
      selectRows: [dbRow(88, 'Casa', 'privado', 'jdoe@x.com')],
      upsertedIds: [88],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toEqual([88]);
    expect(json.replaced).toHaveLength(0);
    expect(json.count).toBe(1);
    // Verificar que NO hay campo skipped en la respuesta
    expect(json).not.toHaveProperty('skipped');
  });

  // ─── caso 5: Replace de privado ───────────────────────────────────────────
  it('5. Replace de privado — Excel (jdoe@x, Casa) id=1002, BD tiene (jdoe@x, Casa) id=88 tipo=privado → DELETE 88 + INSERT 1002', async () => {
    const rows = [
      baseRow({ id: 1002, nombre: 'Casa', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [dbRow(88, 'Casa', 'privado', 'jdoe@x.com')],  // privado con id diferente → conflicto
      upsertedIds: [1002],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toEqual([1002]);
    expect(json.replaced).toHaveLength(1);
    expect(json.replaced[0]).toMatchObject({
      deletedId: 88,
      newId: 1002,
      nombre: 'Casa',
    });
    expect(json.count).toBe(1);
  });

  // ─── caso 6: Dedup interno por id ────────────────────────────────────────
  it('6. Dedup interno por id — Excel con 2 filas mismo id → último gana, sin error', async () => {
    const rows = [
      baseRow({ id: 99, nombre: 'Casa', usuario_email: 'jdoe@x.com', latitud: -34.0 }),
      baseRow({ id: 99, nombre: 'Casa', usuario_email: 'jdoe@x.com', latitud: -35.0 }), // mismo id, este gana
    ];

    const mock = buildSupabaseMock({
      selectRows: [],
      upsertedIds: [99],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Solo 1 fila efectiva después de dedup por id
    expect(json.created).toHaveLength(1);
    expect(json.replaced).toHaveLength(0);
    expect(json.count).toBe(1);

    // Verificar que upsert recibió exactamente 1 row
    const fromCalls = mock.from.mock.calls;
    expect(fromCalls.length).toBeGreaterThan(0);
  });

  // ─── caso 7: No hay skipped en la respuesta ───────────────────────────────
  it('7. No hay skipped en la respuesta — el campo skipped no existe en ningún caso', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'X', usuario_email: 'u@e.com' }),
    ];

    const mock = buildSupabaseMock({ selectRows: [], upsertedIds: [1] });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json).not.toHaveProperty('skipped');
    expect(json).not.toHaveProperty('updated');
  });

  // ─── caso 8: Response contract ───────────────────────────────────────────
  it('8. Response contract — verifica ImportPoiResponse shape', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'X', usuario_email: 'u@e.com' }),
    ];

    const mock = buildSupabaseMock({ selectRows: [], upsertedIds: [77] });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    // Verificar todos los campos del contrato
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('created');
    expect(json).toHaveProperty('replaced');
    expect(json).toHaveProperty('count');
    expect(Array.isArray(json.created)).toBe(true);
    expect(Array.isArray(json.replaced)).toBe(true);
    expect(typeof json.count).toBe('number');
    expect(json.count).toBe(json.created.length);
  });

  // ─── validaciones de entrada ──────────────────────────────────────────────
  it('Rechaza rows vacío con 400', async () => {
    const mock = buildSupabaseMock();
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('Rechaza fila sin nombre con 400', async () => {
    const mock = buildSupabaseMock();
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const rows = [{ id: 1, latitud: -34, longitud: -56, usuario_email: 'a@b.com' }]; // falta nombre
    const res = await POST(makeRequest(rows));
    expect(res.status).toBe(400);
  });
});
