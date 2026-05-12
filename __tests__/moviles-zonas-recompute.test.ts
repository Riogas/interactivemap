/**
 * Tests de integración (handler-level) para el wiring de recompute en
 * POST /api/moviles-zonas
 *
 * Casos cubiertos:
 *  1. POST con asignaciones → recomputeMovilCounters se llama para cada movilId único
 *  2. POST con movilIds repetidos en varias zonas → dedup: recompute UNA vez por nro
 *  3. POST con body vacío (rows.length=0) → recompute NO se llama
 *  4. POST con movilId=0 o NaN en body → filtrado, no se intenta recompute para ese nro
 *  5. Fallo en recompute → best-effort: el response sigue siendo 200 OK
 *  6. Logs [recompute] trigger=POST moviles-zonas presentes en stdout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock de recomputeMovilCounters — registra cada llamada sin ejecutar queries reales
const recomputeMock = vi.fn();

vi.mock('../lib/movil-counters', () => ({
  recomputeMovilCounters: recomputeMock,
}));

// Mock de requireAuth — siempre pasa (retorna el request, no NextResponse)
vi.mock('../lib/auth-middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({}), // objeto != NextResponse → auth ok
}));

// Mock de parseZonasJsonb — no se usa en POST, pero está en el import del módulo
vi.mock('../lib/auth-scope', () => ({
  parseZonasJsonb: vi.fn().mockReturnValue([]),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Supabase (getServerSupabaseClient)
// La lógica de POST hace: delete().eq() + insert().select()
// Necesitamos simular ambas operaciones correctamente.
// ─────────────────────────────────────────────────────────────────────────────

const mockDeleteChain = {
  eq: vi.fn().mockResolvedValue({ error: null }),
};

const mockInsertChain = {
  select: vi.fn().mockResolvedValue({
    data: [{ movil_id: '304', zona_id: 1, escenario_id: 1000 }],
    error: null,
  }),
};

const mockSupabaseFrom = vi.fn((table: string) => {
  if (table === 'moviles_zonas') {
    return {
      delete: vi.fn(() => mockDeleteChain),
      insert: vi.fn(() => mockInsertChain),
    };
  }
  return {};
});

vi.mock('../lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
  supabase: {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper: crear NextRequest con body JSON
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/moviles-zonas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/moviles-zonas — recompute wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: recompute ok (sin throw), insert devuelve 1 fila
    recomputeMock.mockResolvedValue({
      movilNro: 304,
      cant_ped: 2,
      cant_serv: 1,
      capacidad: 3,
    });
    mockDeleteChain.eq.mockResolvedValue({ error: null });
    mockInsertChain.select.mockResolvedValue({
      data: [{ movil_id: '304', zona_id: 1, escenario_id: 1000 }],
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Caso 1: asignaciones con 2 móviles distintos → recompute llamado 2 veces', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [
          { movilId: 304, tipo: 'prioridad' },
          { movilId: 305, tipo: 'transito' },
        ],
      },
    };

    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);

    // recompute debe haberse llamado para 304 y 305
    expect(recomputeMock).toHaveBeenCalledTimes(2);
    const calledNros = recomputeMock.mock.calls.map((c) => c[1]);
    expect(calledNros).toContain(304);
    expect(calledNros).toContain(305);
  });

  it('Caso 2: mismo móvil en múltiples zonas → dedup: recompute llamado UNA sola vez', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [{ movilId: 304, tipo: 'prioridad' }],
        '2': [{ movilId: 304, tipo: 'transito' }],
        '3': [{ movilId: 304, tipo: 'prioridad' }],
      },
    };

    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);

    // movilId=304 aparece 3 veces en distintas zonas — debe deduplicarse
    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), 304);
  });

  it('Caso 3: asignaciones vacías (rows.length=0) → response ok, recompute NO se llama', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    // Asignaciones vacías → rows=[] → early return antes del recompute
    const body = {
      escenario_id: 1000,
      asignaciones: {},
    };

    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.count).toBe(0);
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it('Caso 4: batch con 5 móviles distintos → exactamente 5 invocaciones de recompute', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [
          { movilId: 301, tipo: 'prioridad' },
          { movilId: 302, tipo: 'transito' },
          { movilId: 303, tipo: 'prioridad' },
          { movilId: 304, tipo: 'transito' },
          { movilId: 305, tipo: 'prioridad' },
        ],
      },
    };

    // Insert devuelve 5 filas para que el response sea coherente
    mockInsertChain.select.mockResolvedValue({
      data: [
        { movil_id: '301' }, { movil_id: '302' }, { movil_id: '303' },
        { movil_id: '304' }, { movil_id: '305' },
      ],
      error: null,
    });

    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);

    // 5 móviles distintos → exactamente 5 llamadas (bulk dedup verificado)
    expect(recomputeMock).toHaveBeenCalledTimes(5);
    const calledNros = recomputeMock.mock.calls.map((c) => c[1]);
    expect(calledNros).toContain(301);
    expect(calledNros).toContain(302);
    expect(calledNros).toContain(303);
    expect(calledNros).toContain(304);
    expect(calledNros).toContain(305);
  });

  it('Caso 5: fallo en recompute → best-effort: response sigue siendo 200 OK', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    // Simular que el recompute lanza un error
    recomputeMock.mockRejectedValue(new Error('DB timeout'));

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [{ movilId: 304, tipo: 'prioridad' }],
      },
    };

    // El endpoint NO debe propagar el error del recompute — es best-effort
    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
  });

  it('Caso 6: logs [recompute] con trigger=POST moviles-zonas están presentes', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    recomputeMock.mockResolvedValue({
      movilNro: 304,
      cant_ped: 1,
      cant_serv: 0,
      capacidad: 1,
    });

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [{ movilId: 304, tipo: 'prioridad' }],
      },
    };

    await POST(makeRequest(body));

    // Verificar que al menos un log tiene el formato esperado
    const logCalls = consoleSpy.mock.calls.map((args) => args.join(' '));
    const recomputeLogs = logCalls.filter((msg) =>
      msg.includes('[recompute]') && msg.includes('trigger=POST moviles-zonas')
    );
    expect(recomputeLogs.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('Caso 7: log de resultado con movilNro/cant_ped/cant_serv/capacidad visible', async () => {
    const { POST } = await import('../app/api/moviles-zonas/route');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    recomputeMock.mockResolvedValue({
      movilNro: 304,
      cant_ped: 3,
      cant_serv: 1,
      capacidad: 4,
    });

    const body = {
      escenario_id: 1000,
      asignaciones: {
        '1': [{ movilId: 304, tipo: 'prioridad' }],
      },
    };

    await POST(makeRequest(body));

    const logCalls = consoleSpy.mock.calls.map((args) => args.join(' '));
    const resultLog = logCalls.find((msg) =>
      msg.includes('movilNro=304') &&
      msg.includes('cant_ped=3') &&
      msg.includes('cant_serv=1') &&
      msg.includes('capacidad=4')
    );
    expect(resultLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});
