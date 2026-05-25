/**
 * Tests para POST /api/import/puntos-interes — lógica de upsert por (usuario_email, nombre).
 *
 * Cubre los 7 casos especificados en el request:
 *  1. Insert puro — filas nuevas, BD vacía → todos creados
 *  2. Update sobre público — match existe con tipo='publico' → update con id de BD
 *  3. Skip de privado — match existe con tipo='privado' → skip, reportar
 *  4. Mix — 2 nuevas + 1 update + 1 skip → creados=2, updated=1, skipped=1
 *  5. Dedup interno — Excel con 2 filas mismo (email, nombre) → tratado como 1
 *  6. Id del Excel ignorado en UPDATE — row updateado mantiene id de BD
 *  7. Response shape — verifica contrato ImportPoiResponse
 *
 * Estrategia: mockear getServerSupabaseClient() para no necesitar Supabase real.
 * Los mocks replican el comportamiento de la tabla puntos_interes.
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

/** Fila existente en BD (lo que devolvería el SELECT). */
function dbRow(id: number, nombre: string, tipo: string, usuario_email: string) {
  return { id, nombre, tipo, usuario_email };
}

// ─── mock de Supabase ─────────────────────────────────────────────────────────

/**
 * Construye un mock del cliente Supabase para controlar las respuestas.
 * Simula:
 *   - .from('puntos_interes').select(...).in(...)   → SELECT inicial
 *   - .from('puntos_interes').insert([...]).select('id') → INSERT batch
 *   - .from('puntos_interes').upsert([...], ...).select('id') → UPDATE batch
 */
function buildSupabaseMock({
  selectRows = [] as object[],
  insertedIds = [] as number[],
  updatedIds = [] as number[],
  selectError = null as null | { message: string },
  insertError = null as null | { message: string },
  updateError = null as null | { message: string },
} = {}) {
  const insertChain = {
    select: vi.fn().mockResolvedValue({
      data: insertedIds.map((id) => ({ id })),
      error: insertError,
    }),
  };
  const upsertChain = {
    select: vi.fn().mockResolvedValue({
      data: updatedIds.map((id) => ({ id })),
      error: updateError,
    }),
  };
  const selectChain = {
    in: vi.fn().mockResolvedValue({ data: selectRows, error: selectError }),
  };
  const fromMock = vi.fn((table: string) => {
    if (table !== 'puntos_interes') throw new Error('unexpected table: ' + table);
    return {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
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

describe('POST /api/import/puntos-interes — upsert por (usuario_email, nombre)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── caso 1: Insert puro ───────────────────────────────────────────────────
  it('1. Insert puro — 3 filas nuevas → 3 creados, 0 updated, 0 skipped', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'Casa', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 2, nombre: 'Trabajo', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 3, nombre: 'Gym', usuario_email: 'jdoe@x.com' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [],         // BD vacía — ningún match
      insertedIds: [10, 11, 12],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.created).toHaveLength(3);
    expect(json.updated).toHaveLength(0);
    expect(json.skipped).toHaveLength(0);
    expect(json.count).toBe(3);
  });

  // ─── caso 2: Update sobre público ─────────────────────────────────────────
  it('2. Update sobre público — match con tipo=publico → 1 updated con id de BD (99)', async () => {
    const rows = [
      baseRow({ id: 5000, nombre: 'Casa', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [dbRow(99, 'Casa', 'publico', 'jdoe@x.com')],  // id 99 en BD
      updatedIds: [99],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toHaveLength(0);
    expect(json.updated).toEqual([99]);
    expect(json.skipped).toHaveLength(0);
    expect(json.count).toBe(1);
  });

  // ─── caso 3: Skip de privado ───────────────────────────────────────────────
  it('3. Skip de privado — match con tipo=privado → 0 created, 0 updated, 1 skipped', async () => {
    const rows = [
      baseRow({ id: 9000, nombre: 'Casa', usuario_email: 'jdoe@x.com' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [dbRow(88, 'Casa', 'privado', 'jdoe@x.com')],  // existente privado
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toHaveLength(0);
    expect(json.updated).toHaveLength(0);
    expect(json.skipped).toHaveLength(1);
    expect(json.skipped[0]).toMatchObject({ nombre: 'Casa', usuario_email: 'jdoe@x.com', motivo: 'privado' });
    expect(json.count).toBe(0);
  });

  // ─── caso 4: Mix ─────────────────────────────────────────────────────────────
  it('4. Mix — 2 nuevas + 1 update sobre publico + 1 skip privado → created=2, updated=1, skipped=1', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'Nueva1', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 2, nombre: 'Nueva2', usuario_email: 'jdoe@x.com' }),
      baseRow({ id: 3, nombre: 'Publico', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
      baseRow({ id: 4, nombre: 'Privado', usuario_email: 'jdoe@x.com', tipo: 'privado' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [
        dbRow(200, 'Publico', 'publico', 'jdoe@x.com'),
        dbRow(300, 'Privado', 'privado', 'jdoe@x.com'),
      ],
      insertedIds: [20, 21],
      updatedIds: [200],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.created).toHaveLength(2);
    expect(json.updated).toEqual([200]);
    expect(json.skipped).toHaveLength(1);
    expect(json.skipped[0].nombre).toBe('Privado');
    expect(json.count).toBe(3);
  });

  // ─── caso 5: Dedup interno ────────────────────────────────────────────────
  it('5. Dedup interno — 2 filas con mismo (email, nombre) → procesado como 1, sin error', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'Casa', usuario_email: 'jdoe@x.com', latitud: -34.0 }),
      baseRow({ id: 2, nombre: 'Casa', usuario_email: 'jdoe@x.com', latitud: -35.0 }), // duplicado, este gana
    ];

    const mock = buildSupabaseMock({
      selectRows: [],
      insertedIds: [50],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Solo 1 fila efectiva después de dedup
    expect(json.created).toHaveLength(1);
    expect(json.updated).toHaveLength(0);
    expect(json.skipped).toHaveLength(0);
    expect(json.count).toBe(1);

    // Verificar que insert recibió exactamente 1 row (después de dedup)
    const fromCall = mock.from.mock.calls.find((c: any[]) => c[0] === 'puntos_interes');
    expect(fromCall).toBeDefined();
  });

  // ─── caso 6: Id del Excel ignorado en UPDATE ──────────────────────────────
  it('6. Id del Excel ignorado en UPDATE — row actualizado usa id de BD (no del Excel)', async () => {
    const EXCEL_ID = 9999;
    const BD_ID = 42;

    const rows = [
      baseRow({ id: EXCEL_ID, nombre: 'Oficina', usuario_email: 'jdoe@x.com', tipo: 'publico' }),
    ];

    let upsertCalledWith: any[] = [];
    // Custom mock to capture upsert args
    const upsertChain = {
      select: vi.fn().mockResolvedValue({ data: [{ id: BD_ID }], error: null }),
    };
    const upsertFn = vi.fn((rows: any[]) => {
      upsertCalledWith = rows;
      return upsertChain;
    });
    const insertChain = { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const insertFn = vi.fn(() => insertChain);
    const selectChain = {
      in: vi.fn().mockResolvedValue({
        data: [dbRow(BD_ID, 'Oficina', 'publico', 'jdoe@x.com')],
        error: null,
      }),
    };

    const mock = {
      from: vi.fn(() => ({
        select: vi.fn(() => selectChain),
        insert: insertFn,
        upsert: upsertFn,
      })),
    };
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated).toEqual([BD_ID]);

    // El upsert debe haber recibido el id de BD, no el del Excel
    expect(upsertCalledWith.length).toBe(1);
    expect(upsertCalledWith[0].id).toBe(BD_ID);
    expect(upsertCalledWith[0].id).not.toBe(EXCEL_ID);
  });

  // ─── caso 7: Response shape ───────────────────────────────────────────────
  it('7. Response shape — verifica contrato ImportPoiResponse', async () => {
    const rows = [
      baseRow({ id: 1, nombre: 'X', usuario_email: 'u@e.com' }),
    ];

    const mock = buildSupabaseMock({ selectRows: [], insertedIds: [77] });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    // Verificar todos los campos del contrato
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('created');
    expect(json).toHaveProperty('updated');
    expect(json).toHaveProperty('skipped');
    expect(json).toHaveProperty('count');
    expect(Array.isArray(json.created)).toBe(true);
    expect(Array.isArray(json.updated)).toBe(true);
    expect(Array.isArray(json.skipped)).toBe(true);
    expect(typeof json.count).toBe('number');
    expect(json.count).toBe(json.created.length + json.updated.length);
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

  // ─── caso extra: OSM update ────────────────────────────────────────────────
  it('Update sobre osm — match con tipo=osm → updated (osm no es privado)', async () => {
    const rows = [
      baseRow({ id: 500, nombre: 'Hospital', usuario_email: 'a@b.com', tipo: 'publico' }),
    ];

    const mock = buildSupabaseMock({
      selectRows: [dbRow(77, 'Hospital', 'osm', 'a@b.com')],
      updatedIds: [77],
    });
    vi.mocked(getServerSupabaseClient).mockReturnValue(mock as any);

    const res = await POST(makeRequest(rows));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated).toEqual([77]);
    expect(json.skipped).toHaveLength(0);
  });
});
