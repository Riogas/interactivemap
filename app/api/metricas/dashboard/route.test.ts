/**
 * Tests route-level para GET /api/metricas/dashboard.
 *
 * Patrón de mock: app/api/zonas/capacidad-snapshot/route.test.ts /
 * app/api/metricas/cumplimiento/run/route.test.ts — Supabase y requireAuth
 * mockeados, sin red/BD real.
 *
 * Cubre: 401 sin auth (AC13), 403 sin la funcionalidad 'Estadisticas
 * Cumplimiento' (gate server-side, `lib/api-auth-gates.ts`), scope
 * fail-closed sin llamar la RPC (AC11/AC13), shape de la respuesta,
 * intersección server-side del filtro de empresa (AC11, riesgo de seguridad
 * alto), y 400 ante params inválidos (AC13).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// MOCKS
// =============================================================================

vi.mock('@/lib/auth-middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSupabase = vi.mocked(getServerSupabaseClient);

// =============================================================================
// HELPERS
// =============================================================================

const FAKE_SESSION = { session: { user: { id: 'user-123' } }, user: { id: 'user-123' } };

/** Funcionalidad requerida por el gate server-side (`lib/api-auth-gates.ts`). */
const FUNC = 'Estadisticas Cumplimiento';

const FIXTURE_PAYLOAD = {
  rango: { min_fecha: '2026-06-24', max_fecha: '2026-07-23' },
  periodo_sel: { desde: '2026-07-23', hasta: '2026-07-23' },
  kpis: { cantidad: 120, promedio: 28.4, mediana: 24, p90: 58, min: 3, max: 120, promedio_atraso: 6.8, on_time_pct: 0.72 },
  kpis_prev: { cantidad: 110, promedio: 31.6, mediana: 25.9, p90: 60, min: 2, max: 115, promedio_atraso: 7.5, on_time_pct: 0.68 },
  serie: [{ periodo: '2026-07-23', promedio: 28.4, p90: 58, cantidad: 120 }],
  por_tipo: [{ tipo_servicio: 'URGENTE', promedio: 27.5, cantidad: 60 }],
  ranking: [{ valor: 'LUIS ITORBURO 671', promedio: 15.5, mediana: 14, p90: 22, cantidad: 30, atraso: -1.2 }],
};

function makeRequest(params: {
  escenario?: string | null;
  ventana?: string | null;
  dimension?: string | null;
  desde?: string | null;
  hasta?: string | null;
  tipos?: string | null;
  empresa?: string | null;
  isRoot?: boolean;
  empresasIds?: number[];
  funcionalidades?: string[];
}): NextRequest {
  const sp = new URLSearchParams();
  if (params.escenario !== undefined && params.escenario !== null) sp.set('escenario', params.escenario);
  if (params.ventana != null) sp.set('ventana', params.ventana);
  if (params.dimension != null) sp.set('dimension', params.dimension);
  if (params.desde != null) sp.set('desde', params.desde);
  if (params.hasta != null) sp.set('hasta', params.hasta);
  if (params.tipos != null) sp.set('tipos', params.tipos);
  if (params.empresa != null) sp.set('empresa', params.empresa);

  const url = `http://localhost/api/metricas/dashboard?${sp.toString()}`;
  const headers: Record<string, string> = {};
  if (params.isRoot) headers['x-track-isroot'] = 'S';
  if (params.empresasIds?.length) headers['x-track-empresas-ids'] = params.empresasIds.join(',');
  if (params.funcionalidades) {
    headers['x-track-funcs'] = params.funcionalidades
      .map((f) => f.trim())
      .filter(Boolean)
      .join(',');
  }

  return new NextRequest(url, { method: 'GET', headers });
}

function makeSupabaseMock(rpcData: unknown = FIXTURE_PAYLOAD, rpcError: { message: string } | null = null) {
  const rpcMock = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError });
  return { rpc: rpcMock };
}

// =============================================================================
// TESTS
// =============================================================================

describe('GET /api/metricas/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(FAKE_SESSION as never);
    mockGetSupabase.mockReturnValue(makeSupabaseMock() as unknown as ReturnType<typeof getServerSupabaseClient>);
  });

  // ─── 401 sin auth ──────────────────────────────────────────────────────

  it('401 sin sesión (requireAuth corta), sin tocar la RPC', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: 'No autorizado', code: 'NO_SESSION' }, { status: 401 }),
    );
    const req = makeRequest({ escenario: '1000', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  // ─── Gate de funcionalidad server-side ('Estadisticas Cumplimiento') ────

  it('403 NO_FUNCIONALIDAD: no-root sin la funcionalidad, sin tocar la RPC', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [70] }); // sin funcionalidades
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NO_FUNCIONALIDAD');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('200: no-root CON la funcionalidad pasa el gate', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [70], funcionalidades: [FUNC] });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('200: isRoot pasa el gate aunque no tenga la funcionalidad (bypass de root)', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: true }); // sin funcionalidades
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // ─── Scope fail-closed ──────────────────────────────────────────────────

  it('scope fail-closed: no-root sin x-track-empresas-ids -> payload vacío SIN llamar la RPC', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, funcionalidades: [FUNC] }); // sin empresasIds
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.kpis.cantidad).toBe(0);
    expect(body.data.serie).toEqual([]);
    expect(body.data.por_tipo).toEqual([]);
    expect(body.data.ranking).toEqual([]);
    expect(body.data.rango).toBeNull();
    // La RPC (y el cliente de Supabase que la ejecuta) nunca debe invocarse.
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('scope fail-closed: no-root con x-track-empresas-ids vacío -> payload vacío', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [], funcionalidades: [FUNC] });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kpis.cantidad).toBe(0);
  });

  it('scope fail-closed: no-root con header x-track-empresas-ids presente pero string vacío ("") -> payload vacío SIN llamar la RPC', async () => {
    // makeRequest() nunca setea el header a '' (solo lo omite cuando empresasIds
    // está vacío) — se arma el NextRequest a mano para cubrir la rama
    // `empresasHeader !== null && empresasHeader.trim() !== ''` de route.ts,
    // distinta de la rama "header ausente" ya cubierta arriba.
    const url = 'http://localhost/api/metricas/dashboard?escenario=1000';
    const req = new NextRequest(url, {
      method: 'GET',
      headers: { 'x-track-empresas-ids': '', 'x-track-funcs': FUNC },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kpis.cantidad).toBe(0);
    expect(body.data.rango).toBeNull();
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('scope fail-closed: no-root con header x-track-empresas-ids solo espacios ("   ") -> payload vacío SIN llamar la RPC', async () => {
    const url = 'http://localhost/api/metricas/dashboard?escenario=1000';
    const req = new NextRequest(url, {
      method: 'GET',
      headers: { 'x-track-empresas-ids': '   ', 'x-track-funcs': FUNC },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kpis.cantidad).toBe(0);
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  // ─── Shape OK (root) ────────────────────────────────────────────────────

  it('200 root: shape completo (rango/kpis/kpis_prev/serie/por_tipo/ranking), empresas=null en la RPC', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: true, ventana: 'diario', dimension: 'chofer' });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('rango');
    expect(body.data).toHaveProperty('kpis');
    expect(body.data).toHaveProperty('kpis_prev');
    expect(body.data).toHaveProperty('serie');
    expect(body.data).toHaveProperty('por_tipo');
    expect(body.data).toHaveProperty('ranking');
    expect(body.data).toEqual(FIXTURE_PAYLOAD);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mock.rpc.mock.calls[0];
    expect(fnName).toBe('metricas_dashboard');
    expect((args as { p: Record<string, unknown> }).p.empresas).toBeNull();
    expect((args as { p: Record<string, unknown> }).p.escenario).toBe(1000);
  });

  it('root: ventana/dimension/desde/hasta (E1, período elegido) viajan intactos a la RPC', async () => {
    const req = makeRequest({
      escenario: '1000',
      isRoot: true,
      ventana: 'semanal',
      dimension: 'movil',
      desde: '2026-07-06',
      hasta: '2026-07-12',
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    const p = (args as { p: Record<string, unknown> }).p;
    expect(p.ventana).toBe('semanal');
    expect(p.dimension).toBe('movil');
    expect(p.desde).toBe('2026-07-06');
    expect(p.hasta).toBe('2026-07-12');
  });

  it('root sin desde/hasta -> viajan null a la RPC (1ra carga; la RPC resuelve el último período disponible)', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: true });
    await GET(req);
    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    const p = (args as { p: Record<string, unknown> }).p;
    expect(p.desde).toBeNull();
    expect(p.hasta).toBeNull();
  });

  // ─── Intersección server-side (riesgo de seguridad alto) ───────────────

  it('intersección: no-root con empresasIds=[70,80] y empresa=70 -> RPC recibe empresas=[70]', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [70, 80], empresa: '70', funcionalidades: [FUNC] });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    expect((args as { p: Record<string, unknown> }).p.empresas).toEqual([70]);
  });

  it('intersección: no-root con empresasIds=[70,80] y empresa=999 (no permitida) -> RPC recibe empresas=[] (no 999)', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [70, 80], empresa: '999', funcionalidades: [FUNC] });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    const empresasEnviadas = (args as { p: Record<string, unknown> }).p.empresas as number[];
    expect(empresasEnviadas).not.toContain(999);
    expect(empresasEnviadas).toEqual([]);
  });

  it('no-root sin empresa seleccionada -> RPC recibe el scope completo del header', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: false, empresasIds: [70, 80], funcionalidades: [FUNC] });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    expect((args as { p: Record<string, unknown> }).p.empresas).toEqual([70, 80]);
  });

  // ─── 400 params inválidos ────────────────────────────────────────────────

  it('400 INVALID_ESCENARIO cuando "escenario" no es numérico', async () => {
    const req = makeRequest({ escenario: 'no-numero', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_ESCENARIO');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('400 INVALID_ESCENARIO cuando "escenario" falta directamente (sin el param)', async () => {
    const req = makeRequest({ isRoot: true }); // sin escenario
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_ESCENARIO');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('400 INVALID_VENTANA con valor fuera de diario|semanal|mensual', async () => {
    const req = makeRequest({ escenario: '1000', ventana: 'fruta', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_VENTANA');
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('400 INVALID_DIMENSION con valor fuera de chofer|movil|zona', async () => {
    const req = makeRequest({ escenario: '1000', dimension: 'fruta', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_DIMENSION');
  });

  it('400 INVALID_DATE con formato de fecha inválido', async () => {
    const req = makeRequest({ escenario: '1000', desde: '23-07-2026', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_DATE');
  });

  // ─── Errores de la RPC ────────────────────────────────────────────────────

  it('500 cuando la RPC devuelve error', async () => {
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock(null, { message: 'boom' }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );
    const req = makeRequest({ escenario: '1000', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  // ─── tipos CSV ────────────────────────────────────────────────────────────

  it('tipos CSV se parsean a array y viajan a la RPC', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: true, tipos: 'urgente,nocturno' });
    await GET(req);
    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    expect((args as { p: Record<string, unknown> }).p.tipos).toEqual(['URGENTE', 'NOCTURNO']);
  });

  it('sin tipos -> null (todos) viaja a la RPC', async () => {
    const req = makeRequest({ escenario: '1000', isRoot: true });
    await GET(req);
    const mock = mockGetSupabase.mock.results[0].value as ReturnType<typeof makeSupabaseMock>;
    const [, args] = mock.rpc.mock.calls[0];
    expect((args as { p: Record<string, unknown> }).p.tipos).toBeNull();
  });
});
