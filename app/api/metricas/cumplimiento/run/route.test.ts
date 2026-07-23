/**
 * Tests de integración route-level para POST /api/metricas/cumplimiento/run.
 *
 * Complementa los tests de lógica pura de __tests__/metricas-*.test.ts (que
 * cubren buildFact/computeDemora/atribuirChofer/dedupByPk aislados). Acá se
 * ejercita el handler completo con Supabase y fetchSessionHistorial mockeados
 * (nunca red/BD real), siguiendo el patrón de
 * app/api/zonas/capacidad-snapshot/route.test.ts.
 *
 * Cubre: token gate (401 sin header / 401 inválido / 500 sin env, AC4),
 * validación de rango (400), happy path con excluidos/purga/upsert/cache
 * movil+fecha, y el resumen JSON (AC7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// =============================================================================
// MOCKS
// =============================================================================

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/metricas/movil-session-fetch', () => ({
  fetchSessionHistorial: vi.fn(),
}));

import { getServerSupabaseClient } from '@/lib/supabase';
import { fetchSessionHistorial } from '@/lib/metricas/movil-session-fetch';
import { POST } from './route';

const mockGetSupabase = vi.mocked(getServerSupabaseClient);
const mockFetchSession = vi.mocked(fetchSessionHistorial);

const TOKEN = 'test-metricas-token-123';

// =============================================================================
// HELPERS
// =============================================================================

function makeRequest(opts: { desde?: string; hasta?: string; token?: string | null } = {}): NextRequest {
  const sp = new URLSearchParams();
  if (opts.desde) sp.set('desde', opts.desde);
  if (opts.hasta) sp.set('hasta', opts.hasta);
  const qs = sp.toString();
  const url = `http://localhost/api/metricas/cumplimiento/run${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {};
  if (opts.token !== undefined && opts.token !== null) headers['x-metricas-token'] = opts.token;
  return new NextRequest(url, { method: 'POST', headers });
}

type SourceRowFixture = {
  id: number;
  escenario: number | null;
  servicio_nombre: string | null;
  movil: number | null;
  zona_nro: number | null;
  empresa_fletera_id: number | null;
  orden_cancelacion: string | null;
  estado_nro: number | null;
  sub_estado_nro: number | null;
  fch_hora_asignado: string | null;
  fch_hora_finalizacion: string | null;
  demora_movil_desde_asignacion_mins: number | null;
};

function baseRow(overrides: Partial<SourceRowFixture> = {}): SourceRowFixture {
  return {
    id: 5001,
    escenario: 10,
    servicio_nombre: 'URGENTE',
    movil: 100,
    zona_nro: 7,
    empresa_fletera_id: 70,
    orden_cancelacion: 'N',
    estado_nro: 2,
    sub_estado_nro: 3,
    fch_hora_asignado: '2026-07-20T14:00:00Z',
    fch_hora_finalizacion: '2026-07-20T14:45:00Z',
    demora_movil_desde_asignacion_mins: null,
    ...overrides,
  };
}

type ExistenteFixture = { origen: string; pedido_id: number; escenario: number };

/**
 * Construye un mock del cliente Supabase que soporta las 3 formas de query que
 * usa el endpoint:
 *  - fetchCumplidos:  from(pedidos|services).select().eq().not().gte().lt().range() -> {data,error}
 *  - fetchExistentes: from(metricas_cumplimiento).select().gte().lte().range()      -> {data,error}
 *  - purga:           from(metricas_cumplimiento).delete().or()                    -> {error}
 *  - upsert:          from(metricas_cumplimiento).upsert(chunk, opts)              -> {error}
 */
function makeSupabaseMock(opts: {
  pedidosRows?: SourceRowFixture[];
  servicesRows?: SourceRowFixture[];
  existentesRows?: ExistenteFixture[];
  upsertError?: { message: string } | null;
  deleteError?: { message: string } | null;
} = {}) {
  const pedidosRows = opts.pedidosRows ?? [];
  const servicesRows = opts.servicesRows ?? [];
  const existentesRows = opts.existentesRows ?? [];

  const upsertCalls: Array<{ chunk: unknown[]; options: unknown }> = [];
  const deleteOrCalls: string[] = [];

  function rowsForTable(table: string) {
    if (table === 'pedidos') return pedidosRows;
    if (table === 'services') return servicesRows;
    if (table === 'metricas_cumplimiento') return existentesRows;
    return [];
  }

  function makeSelectQb(table: string) {
    const qb: Record<string, unknown> = {};
    for (const m of ['eq', 'not', 'gte', 'lte', 'lt']) {
      qb[m] = () => qb;
    }
    qb.range = (from: number, to: number) => {
      const rows = rowsForTable(table);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    };
    return qb;
  }

  const fromMock = vi.fn((table: string) => ({
    select: (_: string) => makeSelectQb(table),
    delete: () => ({
      or: (orExpr: string) => {
        deleteOrCalls.push(orExpr);
        return Promise.resolve({ error: opts.deleteError ?? null });
      },
    }),
    upsert: (chunk: unknown[], options: unknown) => {
      upsertCalls.push({ chunk, options });
      return Promise.resolve({ error: opts.upsertError ?? null });
    },
  }));

  return { from: fromMock, __upsertCalls: upsertCalls, __deleteOrCalls: deleteOrCalls };
}

// =============================================================================
// TESTS
// =============================================================================

describe('POST /api/metricas/cumplimiento/run', () => {
  const originalToken = process.env.METRICAS_CRON_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.METRICAS_CRON_TOKEN = TOKEN;
    mockGetSupabase.mockReturnValue(makeSupabaseMock() as unknown as ReturnType<typeof getServerSupabaseClient>);
    mockFetchSession.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.METRICAS_CRON_TOKEN;
    else process.env.METRICAS_CRON_TOKEN = originalToken;
  });

  // ─── AC4: token gate, PRIMER paso ─────────────────────────────────────────

  it('401 sin header x-metricas-token, sin tocar la BD', async () => {
    const req = makeRequest({ token: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('INVALID_TOKEN');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('401 con token inválido, sin tocar la BD', async () => {
    const req = makeRequest({ token: 'token-incorrecto' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('INVALID_TOKEN');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('500 SERVER_MISCONFIGURED cuando METRICAS_CRON_TOKEN no está configurado, sin tocar la BD', async () => {
    delete process.env.METRICAS_CRON_TOKEN;
    const req = makeRequest({ token: 'cualquier-cosa' });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('SERVER_MISCONFIGURED');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('200 con token válido (gate pasa)', async () => {
    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // ─── AC5: validación de rango ──────────────────────────────────────────────

  it('400 INVALID_RANGE cuando solo viene "desde" sin "hasta"', async () => {
    const req = makeRequest({ token: TOKEN, desde: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_RANGE');
  });

  it('400 INVALID_RANGE con formato de fecha inválido', async () => {
    const req = makeRequest({ token: TOKEN, desde: '20-07-2026', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 RANGE_TOO_LARGE cuando el rango excede 35 días', async () => {
    const req = makeRequest({ token: TOKEN, desde: '2026-01-01', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('RANGE_TOO_LARGE');
  });

  it('sin params usa defaultRunRange() (día cerrado anterior + 3 días de reproceso)', async () => {
    const req = makeRequest({ token: TOKEN });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rango.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.rango.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ─── Happy path: clasificación + demora + atribución + resumen (AC7) ──────

  it('happy path: procesa PEDIDO (CAMPO) + SERVICE (DERIVADO), atribuye chofer, resumen correcto', async () => {
    const pedidoRow = baseRow({
      id: 5001,
      servicio_nombre: 'URGENTE',
      fch_hora_asignado: '2026-07-20T14:00:00Z',
      fch_hora_finalizacion: '2026-07-20T14:45:00Z', // 45 min CAMPO
    });
    const serviceRow = baseRow({
      id: 6001,
      servicio_nombre: null,
      fch_hora_asignado: null,
      fch_hora_finalizacion: '2026-07-20T15:00:00Z',
      demora_movil_desde_asignacion_mins: 20, // DERIVADO
    });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [pedidoRow], servicesRows: [serviceRow] }) as unknown as ReturnType<
        typeof getServerSupabaseClient
      >,
    );
    mockFetchSession.mockResolvedValue([{ chofer: 'Juan Perez', inicio: '2026-07-20T10:00:00Z' }]);

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.procesados).toBe(2);
    expect(body.excluidos).toEqual({});
    expect(body.moviles_sin_chofer).toBe(0);
    expect(body.cumplidos_sin_movil).toBe(0);

    // El upsert recibió los 2 hechos con los campos calculados correctamente.
    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    expect(mock.__upsertCalls).toHaveLength(1);
    const chunk = mock.__upsertCalls[0].chunk as Array<Record<string, unknown>>;
    expect(chunk).toHaveLength(2);

    const pedidoFact = chunk.find((f) => f.pedido_id === 5001 && f.origen === 'PEDIDO');
    expect(pedidoFact).toMatchObject({
      demora_mins: 45,
      asignado_source: 'CAMPO',
      tipo_servicio: 'URGENTE',
      chofer: 'Juan Perez',
    });

    const serviceFact = chunk.find((f) => f.pedido_id === 6001 && f.origen === 'SERVICE');
    expect(serviceFact).toMatchObject({
      demora_mins: 20,
      asignado_source: 'DERIVADO',
      tipo_servicio: 'SERVICE',
      chofer: 'Juan Perez',
      fch_hora_asignado: null,
    });

    expect(mock.__upsertCalls[0].options).toMatchObject({ onConflict: 'origen,pedido_id,escenario' });
  });

  it('cache movil+fecha: 2 filas del mismo movil+fecha llaman fetchSessionHistorial UNA sola vez', async () => {
    const pedidoRow = baseRow({ id: 5001, movil: 100, fch_hora_finalizacion: '2026-07-20T14:45:00Z' });
    const serviceRow = baseRow({ id: 6001, movil: 100, fch_hora_finalizacion: '2026-07-20T15:00:00Z' });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [pedidoRow], servicesRows: [serviceRow] }) as unknown as ReturnType<
        typeof getServerSupabaseClient
      >,
    );
    mockFetchSession.mockResolvedValue([{ chofer: 'Juan Perez', inicio: '2026-07-20T10:00:00Z' }]);

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Mismo movil (100) + misma fecha derivada (2026-07-20) → 1 sola llamada cacheada.
    expect(mockFetchSession).toHaveBeenCalledTimes(1);
    expect(mockFetchSession).toHaveBeenCalledWith(100, '2026-07-20');
  });

  it('exclusiones: cancelado + demora_negativa se cuentan por motivo y no entran en procesados', async () => {
    const ok = baseRow({ id: 1, movil: 200 });
    const cancelado = baseRow({ id: 2, movil: 200, orden_cancelacion: 'S' });
    const demoraNegativa = baseRow({
      id: 3,
      movil: 200,
      fch_hora_asignado: '2026-07-20T15:00:00Z', // posterior a la finalización
      fch_hora_finalizacion: '2026-07-20T14:45:00Z',
    });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [ok, cancelado, demoraNegativa] }) as unknown as ReturnType<
        typeof getServerSupabaseClient
      >,
    );
    mockFetchSession.mockResolvedValue(null);

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.procesados).toBe(1);
    expect(body.excluidos).toEqual({ cancelado: 1, demora_negativa: 1 });
  });

  it('exclusiones: sub_estado_nro != 3 se cuenta como no_cumplido y no entra en procesados', async () => {
    const ok = baseRow({ id: 1, movil: 200 });
    const fruta = baseRow({ id: 2, movil: 200, estado_nro: 2, sub_estado_nro: 5 });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [ok, fruta] }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );
    mockFetchSession.mockResolvedValue(null);

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.procesados).toBe(1);
    expect(body.excluidos).toEqual({ no_cumplido: 1 });
  });

  it('movil null/0: se registra el hecho (OQ7), sin llamar fetchSessionHistorial, cuenta cumplidos_sin_movil', async () => {
    const sinMovil = baseRow({ id: 1, movil: 0 });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [sinMovil] }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.procesados).toBe(1);
    expect(body.cumplidos_sin_movil).toBe(1);
    expect(body.moviles_sin_chofer).toBe(0);
    expect(mockFetchSession).not.toHaveBeenCalled();
  });

  it('historial vacío/no encontrado: chofer=NULL, hecho se registra igual, incrementa moviles_sin_chofer (AC10)', async () => {
    const row = baseRow({ id: 1, movil: 300 });
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ pedidosRows: [row] }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );
    mockFetchSession.mockResolvedValue(null); // endpoint externo caído/sin dato

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.procesados).toBe(1);
    expect(body.moviles_sin_chofer).toBe(1);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const chunk = mock.__upsertCalls[0].chunk as Array<Record<string, unknown>>;
    expect(chunk[0].chofer).toBeNull();
  });

  // ─── OQ5: purga de hechos que dejaron de calificar ─────────────────────────

  it('purga: un hecho previo que ya no califica se borra (DELETE con su PK), uno que sigue calificando no', async () => {
    const stillQualifies = baseRow({ id: 1, escenario: 10, movil: 100 });

    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({
        pedidosRows: [stillQualifies],
        existentesRows: [
          { origen: 'PEDIDO', pedido_id: 1, escenario: 10 }, // sigue calificando → NO debe purgarse
          { origen: 'PEDIDO', pedido_id: 9999, escenario: 10 }, // ya no calificaría (p.ej. canceló) → purgar
        ],
      }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    expect(mock.__deleteOrCalls).toHaveLength(1);
    expect(mock.__deleteOrCalls[0]).toContain('pedido_id.eq.9999');
    expect(mock.__deleteOrCalls[0]).not.toContain('pedido_id.eq.1,');
    expect(mock.__deleteOrCalls[0]).not.toMatch(/pedido_id\.eq\.1\)/);
  });

  it('sin stale keys: no se llama DELETE', async () => {
    const row = baseRow({ id: 1, escenario: 10, movil: 100 });
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({
        pedidosRows: [row],
        existentesRows: [{ origen: 'PEDIDO', pedido_id: 1, escenario: 10 }],
      }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    await POST(req);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    expect(mock.__deleteOrCalls).toHaveLength(0);
  });

  // ─── AC6: idempotencia — correr 2 veces da el mismo resultado ─────────────

  it('idempotencia: correr el run 2 veces sobre el mismo mock da el mismo resumen', async () => {
    const row = baseRow({ id: 1, movil: 100 });
    const supa = makeSupabaseMock({ pedidosRows: [row] });
    mockGetSupabase.mockReturnValue(supa as unknown as ReturnType<typeof getServerSupabaseClient>);
    mockFetchSession.mockResolvedValue([{ chofer: 'Juan Perez', inicio: '2026-07-20T10:00:00Z' }]);

    const req1 = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res1 = await POST(req1);
    const body1 = await res1.json();

    const req2 = makeRequest({ token: TOKEN, desde: '2026-07-20', hasta: '2026-07-20' });
    const res2 = await POST(req2);
    const body2 = await res2.json();

    expect(body1.procesados).toBe(body2.procesados);
    expect(body1.excluidos).toEqual(body2.excluidos);
    expect(body1.moviles_sin_chofer).toBe(body2.moviles_sin_chofer);
    // Cada corrida hace su propio upsert (2 llamadas acumuladas), pero el
    // contenido de cada upsert individual es idéntico (mismo PK, mismos valores).
    expect(supa.__upsertCalls).toHaveLength(2);
    expect(supa.__upsertCalls[0].chunk).toEqual(supa.__upsertCalls[1].chunk);
  });
});
