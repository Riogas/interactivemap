import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { todayMontevideo } from '@/lib/date-utils';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

const RPC_DATA = { rango: { desde: '2026-07-05', hasta: '2026-08-03' }, kpis: null, franjas: [] };

function makeDb() {
  const rpc = vi.fn(async () => ({ data: RPC_DATA, error: null }));
  return { rpc };
}

const FUNC = 'Estadisticas Cumplimiento';

function req(qs: string, headers: Record<string, string> = { 'x-track-isroot': 'S' }) {
  return new NextRequest(`http://localhost/api/metricas/desfasaje?${qs}`, { method: 'GET', headers });
}

describe('GET /api/metricas/desfasaje', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ session: {}, user: { id: 'u1' } } as never);
    db = makeDb();
    mockDb.mockReturnValue(db as never);
  });

  it('401 sin sesión, sin tocar la base', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const res = await GET(req('escenario=1000'));
    expect(res.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('400 sin escenario', async () => {
    const res = await GET(req('dias=30'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_ESCENARIO');
  });

  it('400 con tipo inválido (SERVICE está fuera del universo a propósito)', async () => {
    const res = await GET(req('escenario=1000&tipo=SERVICE'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TIPO');
  });

  it('400 con dias fuera de 7|30|90 (no hay default silencioso para valores raros)', async () => {
    const res = await GET(req('escenario=1000&dias=15'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DIAS');
  });

  it('llama la RPC con desde/hasta del rango pedido (dias=7 -> 7 días inclusive)', async () => {
    const res = await GET(req('escenario=1000&dias=7'));
    expect(res.status).toBe(200);
    const [fn, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(fn).toBe('metricas_desfasaje');
    const hasta = todayMontevideo();
    expect(args.p.hasta).toBe(hasta);
    const d1 = new Date(`${args.p.desde as string}T00:00:00Z`).getTime();
    const d2 = new Date(`${hasta}T00:00:00Z`).getTime();
    expect((d2 - d1) / 86_400_000).toBe(6);
  });

  it('root sin empresa elegida -> empresas null (sin restricción)', async () => {
    await GET(req('escenario=1000'));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toBeNull();
    expect(args.p.tipo).toBeNull();
  });

  it('p.escenario es EL del request (la clave por la que nada se cruza)', async () => {
    // Mutante cazado en el review: un escenario hardcodeado en la llamada
    // RPC pasaba los 14 tests originales.
    await GET(req('escenario=2000'));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.escenario).toBe(2000);
  });

  it('sin dias -> default 30 (rango de 30 días inclusive)', async () => {
    await GET(req('escenario=1000'));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    const d1 = new Date(`${args.p.desde as string}T00:00:00Z`).getTime();
    const d2 = new Date(`${args.p.hasta as string}T00:00:00Z`).getTime();
    expect((d2 - d1) / 86_400_000).toBe(29);
  });

  it('root con empresa elegida -> empresas [esa]', async () => {
    await GET(req('escenario=1000&empresa=7'));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toEqual([7]);
  });

  it('no-root SIN header de empresas -> payload vacío sin tocar la RPC (fail-closed)', async () => {
    const res = await GET(req('escenario=1000', { 'x-track-funcs': FUNC }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.kpis).toBeNull();
    expect(body.data.franjas).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('no-root con scope -> empresas del header', async () => {
    await GET(req('escenario=1000', { 'x-track-funcs': FUNC, 'x-track-empresas-ids': '5, 9' }));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toEqual([5, 9]);
  });

  it('no-root que elige una empresa FUERA de su scope -> intersección vacía (nunca amplía)', async () => {
    await GET(req('escenario=1000&empresa=99', { 'x-track-funcs': FUNC, 'x-track-empresas-ids': '5,9' }));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    // [] viaja a la RPC, que es fail-closed con [] (asserts del harness).
    expect(args.p.empresas).toEqual([]);
  });

  it('tipo válido viaja a la RPC', async () => {
    await GET(req('escenario=1000&tipo=NOCTURNO'));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.tipo).toBe('NOCTURNO');
  });

  it('403 NO_FUNCIONALIDAD para no-root sin x-track-funcs, sin tocar la RPC', async () => {
    const res = await GET(req('escenario=1000', {}));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_FUNCIONALIDAD');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('error de la RPC -> 500 con detalle', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);
    const res = await GET(req('escenario=1000'));
    expect(res.status).toBe(500);
    expect((await res.json()).details).toBe('boom');
  });

  describe('allowlist por email (misma env que metricas/dashboard)', () => {
    const ENV_KEY = 'METRICAS_DASHBOARD_ALLOWED_EMAILS';
    const prev = process.env[ENV_KEY];
    afterEach(() => {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    });

    it('email fuera de la lista -> 403 aunque forje headers root', async () => {
      process.env[ENV_KEY] = 'admin@riogas.com.uy';
      mockAuth.mockResolvedValue({ session: {}, user: { id: 'u2', email: 'intruso@gmail.com' } } as never);
      const res = await GET(req('escenario=1000', { 'x-track-isroot': 'S', 'x-track-funcs': FUNC }));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('NOT_ALLOWLISTED');
      expect(db.rpc).not.toHaveBeenCalled();
    });
  });
});
