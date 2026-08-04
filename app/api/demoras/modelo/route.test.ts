import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { getServerSupabaseClient } from '@/lib/supabase';
import { GET, PUT } from './route';

const mockDb = vi.mocked(getServerSupabaseClient);

const MODELO = { escenario_id: 1000, modelo: 'CONSUMO_TRAMOS', version: 6, min_minutos: 30, arranque_sin_movil_modo: 'DESPACHO_MAS_COLA' };
const CONFIG = [
  { escenario_id: 1000, tipo_servicio: 'NOCTURNO', motor_activo: true, hora_inicio: '18:00:00', hora_fin: '23:30:00' },
  { escenario_id: 1000, tipo_servicio: 'URGENTE', motor_activo: true, hora_inicio: '07:00:00', hora_fin: '23:30:00' },
];
const HISTORIAL = [{ version: 6, cambiado_at: '2026-08-04T15:00:00-03:00', cambiado_por: 'jgomez' }];

/** Mock por tabla que registra los update() y sus filtros eq(). */
function makeDb() {
  const updates: Array<{ table: string; vals: Record<string, unknown>; eqs: Array<[string, unknown]> }> = [];
  const fixtures: Record<string, unknown[]> = {
    demoras_modelo: [MODELO],
    demoras_config: CONFIG,
    demoras_modelo_historial: HISTORIAL,
  };
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    let pendingUpdate: Record<string, unknown> | null = null;
    const eqs: Array<[string, unknown]> = [];
    for (const m of ['select', 'order', 'limit']) q[m] = vi.fn(() => q);
    q.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val]);
      return q;
    });
    q.update = vi.fn((vals: Record<string, unknown>) => {
      pendingUpdate = vals;
      return q;
    });
    q.then = (res: (v: unknown) => unknown) => {
      if (pendingUpdate) {
        updates.push({ table, vals: pendingUpdate, eqs });
        const inyectado = (fixtures[`__error_${table}`] as { message: string }[] | undefined)?.[0];
        return res({ data: null, error: inyectado ?? null });
      }
      return res({ data: fixtures[table] ?? [], error: null });
    };
    return q;
  });
  return { from, updates, fixtures };
}

const OK_HEADERS = { 'x-track-isroot': 'S', 'x-track-user': 'jgomez' };

function getReq(qs: string, headers: Record<string, string> = OK_HEADERS) {
  return new NextRequest(`http://localhost/api/demoras/modelo?${qs}`, { method: 'GET', headers });
}
function putReq(body: unknown, headers: Record<string, string> = OK_HEADERS) {
  return new NextRequest('http://localhost/api/demoras/modelo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('/api/demoras/modelo', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    mockDb.mockReturnValue(db as never);
  });

  it('403 sin root ni funcionalidad Preferencias Globales, sin tocar la base', async () => {
    const res = await GET(getReq('escenario=1000', {}));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_FUNCIONALIDAD');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('la funcionalidad Preferencias Globales alcanza (mismo gate que realtime-config)', async () => {
    const res = await GET(getReq('escenario=1000', { 'x-track-funcs': 'Otra,Preferencias Globales' }));
    expect(res.status).toBe(200);
  });

  it('GET arma el payload completo: modelo, config, historial y escenarios', async () => {
    const res = await GET(getReq('escenario=1000'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.modelo.version).toBe(6);
    expect(body.data.config).toHaveLength(2);
    expect(body.data.historial[0].cambiado_por).toBe('jgomez');
    expect(body.data.escenarios).toEqual([1000]);
  });

  it('GET sin escenario -> 400', async () => {
    const res = await GET(getReq(''));
    expect(res.status).toBe(400);
  });

  it('PUT aplica SOLO campos whitelisteados y estampa updated_by del header', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      modelo: {
        bajada_max: 45,
        arranque_sin_movil_modo: 'DESPACHO_MAS_COLA',
        version: 99,            // fuera de whitelist: lo maneja el trigger
        escenario_id: 2000,     // fuera de whitelist: jamas se pisa la PK
        hackeo: 'x',            // desconocido: se ignora sin error
      },
    }));
    expect(res.status).toBe(200);
    const up = db.updates.find((u) => u.table === 'demoras_modelo');
    expect(up).toBeDefined();
    expect(up!.vals).toEqual({
      bajada_max: 45,
      arranque_sin_movil_modo: 'DESPACHO_MAS_COLA',
      updated_by: 'jgomez',
    });
    expect(up!.eqs).toContainEqual(['escenario_id', 1000]);
  });

  it('PUT de config actualiza por (escenario, tipo) con whitelist propia', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      config: [
        { tipo_servicio: 'URGENTE', motor_activo: false, hora_inicio: '08:00', intruso: 1 },
        { tipo_servicio: 'FRUTA', motor_activo: false },
      ],
    }));
    expect(res.status).toBe(200);
    const ups = db.updates.filter((u) => u.table === 'demoras_config');
    expect(ups).toHaveLength(1);
    expect(ups[0].vals).toEqual({ motor_activo: false, hora_inicio: '08:00', updated_by: 'jgomez' });
    expect(ups[0].eqs).toContainEqual(['tipo_servicio', 'URGENTE']);
  });

  it('un CHECK de la base que rechaza vuelve como 400, no 500', async () => {
    db.fixtures['__error_demoras_modelo'] = [{ message: 'new row violates check constraint "demoras_modelo_arranque_chk"' }];
    const res = await PUT(putReq({ escenario: 1000, modelo: { arranque_sin_movil_modo: 'CUALQUIERA' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/arranque_chk/);
  });

  it('PUT sin escenario -> 400 sin tocar la base', async () => {
    const res = await PUT(putReq({ modelo: { bajada_max: 45 } }));
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});
