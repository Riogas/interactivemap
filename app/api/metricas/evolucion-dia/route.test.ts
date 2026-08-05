import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

const RPC_DATA = { fecha: '2026-08-05', corridas: [], resumen: null };

function makeDb() {
  const rpc = vi.fn(async () => ({ data: RPC_DATA, error: null }));
  return { rpc };
}

const FUNC = 'Estadisticas Cumplimiento';

function req(qs: string, headers: Record<string, string> = { 'x-track-isroot': 'S' }) {
  return new NextRequest(`http://localhost/api/metricas/evolucion-dia?${qs}`, { method: 'GET', headers });
}

describe('GET /api/metricas/evolucion-dia', () => {
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

  it('400 sin escenario / fecha mal formada / tipo inválido', async () => {
    expect((await GET(req(''))).status).toBe(400);
    expect((await GET(req('escenario=1000&fecha=05-08-2026'))).status).toBe(400);
    expect((await GET(req('escenario=1000&tipo=SERVICE'))).status).toBe(400);
  });

  it('llama la RPC con fecha null (hoy) por defecto y los filtros dados', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    expect(res.status).toBe(200);
    const [fn, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(fn).toBe('metricas_evolucion_dia');
    expect(args.p.escenario).toBe(1000);
    expect(args.p.fecha).toBeNull();
    expect(args.p.tipo).toBe('URGENTE');
  });

  it('no-root sin header de empresas: payload vacío sin tocar la RPC', async () => {
    const res = await GET(req('escenario=1000', { 'x-track-funcs': FUNC }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.corridas).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('empresa elegida se intersecta con el scope (nunca amplía)', async () => {
    await GET(req('escenario=1000&empresa=99', { 'x-track-funcs': FUNC, 'x-track-empresas-ids': '7,9' }));
    const [, args] = db.rpc.mock.calls[0] as unknown as [string, { p: Record<string, unknown> }];
    expect(args.p.empresas).toEqual([]);
  });
});
