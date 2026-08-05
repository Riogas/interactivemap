import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { todayMontevideo } from '@/lib/date-utils';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

const RPC_DATA = {
  rango: { desde: '2026-07-29', hasta: '2026-08-04' }, fuente: 'informada', fecha: null,
  resumen: null, por_dia: [], por_hora: [], por_zona: [], peores: [],
};

function makeDb() {
  const rpc = vi.fn(async () => ({ data: RPC_DATA, error: null }));
  return { rpc };
}

const FUNC = 'Estadisticas Cumplimiento';

function req(qs: string, headers: Record<string, string> = { 'x-track-isroot': 'S' }) {
  return new NextRequest(`http://localhost/api/metricas/desfasaje/analisis?${qs}`, { method: 'GET', headers });
}

describe('GET /api/metricas/desfasaje/analisis', () => {
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

  it('400 con fuente inválida', async () => {
    const res = await GET(req('escenario=1000&fuente=otra'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_FUENTE');
  });

  it('400 con fecha que no es YYYY-MM-DD', async () => {
    const res = await GET(req('escenario=1000&fecha=03/08/2026'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_FECHA');
  });

  it('llama la RPC con fuente/fecha y el rango de 7 días por defecto', async () => {
    const res = await GET(req('escenario=1000&fuente=calculada&fecha=2026-08-03'));
    expect(res.status).toBe(200);
    const [fn, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(fn).toBe('metricas_desfasaje_analisis');
    expect(args.p.escenario).toBe(1000);
    expect(args.p.fuente).toBe('calculada');
    expect(args.p.fecha).toBe('2026-08-03');
    expect(args.p.hasta).toBe(todayMontevideo());
    expect(args.p.empresas).toBeNull();
  });

  it('no-root sin header de empresas: payload vacío sin tocar la RPC (fail-closed)', async () => {
    const res = await GET(req('escenario=1000', { 'x-track-funcs': FUNC }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.por_dia).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('no-root con scope: las empresas del header viajan a la RPC; la elegida intersecta', async () => {
    await GET(req('escenario=1000&empresa=7', { 'x-track-funcs': FUNC, 'x-track-empresas-ids': '7,9' }));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toEqual([7]);
  });

  it('empresa elegida FUERA del scope no amplía: empresas queda vacío → la RPC devuelve vacío', async () => {
    await GET(req('escenario=1000&empresa=99', { 'x-track-funcs': FUNC, 'x-track-empresas-ids': '7,9' }));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toEqual([]);
  });
});
