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
const VENTANAS = [
  { escenario_id: 1000, tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', hora_inicio: '07:00:00', hora_fin: '23:30:00' },
];
const ESPERA = [
  { id: 1, escenario_id: 1000, tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: null, hora_max: '09:00:00' },
];

interface Op {
  table: string;
  op: 'update' | 'insert' | 'upsert' | 'delete';
  vals?: Record<string, unknown>;
  opts?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
}

/** Mock por tabla que registra escrituras (update/insert/upsert/delete) con sus filtros. */
function makeDb() {
  const ops: Op[] = [];
  const fixtures: Record<string, unknown[]> = {
    demoras_modelo: [MODELO],
    demoras_config: CONFIG,
    demoras_modelo_historial: HISTORIAL,
    demoras_ventanas: VENTANAS,
    demoras_espera_max: ESPERA,
  };
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    let pending: Op | null = null;
    const eqs: Array<[string, unknown]> = [];
    const iss: Array<[string, unknown]> = [];
    for (const m of ['select', 'order', 'limit']) q[m] = vi.fn(() => q);
    q.eq = vi.fn((col: string, val: unknown) => { eqs.push([col, val]); return q; });
    q.is = vi.fn((col: string, val: unknown) => { iss.push([col, val]); return q; });
    q.update = vi.fn((vals: Record<string, unknown>) => { pending = { table, op: 'update', vals, eqs, iss }; return q; });
    q.insert = vi.fn((vals: Record<string, unknown>) => { pending = { table, op: 'insert', vals, eqs, iss }; return q; });
    q.upsert = vi.fn((vals: Record<string, unknown>, opts: Record<string, unknown>) => { pending = { table, op: 'upsert', vals, opts, eqs, iss }; return q; });
    q.delete = vi.fn(() => { pending = { table, op: 'delete', eqs, iss }; return q; });
    q.then = (res: (v: unknown) => unknown) => {
      if (pending) {
        ops.push(pending);
        const inyectado = (fixtures[`__error_${table}`] as { message: string }[] | undefined)?.[0];
        // Un update devuelve las filas afectadas (el PUT decide insert si 0).
        const data = pending.op === 'update' ? (fixtures[`__updrows_${table}`] ?? [{}]) : null;
        return res({ data, error: inyectado ?? null });
      }
      return res({ data: fixtures[table] ?? [], error: null });
    };
    return q;
  });
  return { from, ops, fixtures, get updates() {
    return ops.filter((o) => o.op === 'update').map((o) => ({ table: o.table, vals: o.vals!, eqs: o.eqs }));
  } };
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

  it('GET arma el payload completo: modelo, config, historial, escenarios, ventanas y espera máxima', async () => {
    const res = await GET(getReq('escenario=1000'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.modelo.version).toBe(6);
    expect(body.data.config).toHaveLength(2);
    expect(body.data.historial[0].cambiado_por).toBe('jgomez');
    expect(body.data.escenarios).toEqual([1000]);
    expect(body.data.ventanas).toHaveLength(1);
    expect(body.data.esperaMax[0].hora_max).toBe('09:00:00');
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

  it('las perillas de activación están whitelisteadas', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      modelo: { activacion_gracia_minutos: 25, activacion_percentil: 0.75 },
    }));
    expect(res.status).toBe(200);
    const up = db.updates.find((u) => u.table === 'demoras_modelo');
    expect(up!.vals).toEqual({ activacion_gracia_minutos: 25, activacion_percentil: 0.75, updated_by: 'jgomez' });
  });

  it('PUT de ventanas upsertea por PK y descarta tipos o días inválidos', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      ventanas: [
        { tipo_servicio: 'URGENTE', dia_tipo: 'SABADO', hora_inicio: '08:00', hora_fin: '13:00' },
        { tipo_servicio: 'FRUTA', dia_tipo: 'HABIL', hora_inicio: '08:00' },
        { tipo_servicio: 'URGENTE', dia_tipo: 'FERIADO', hora_fin: '13:00' },
      ],
    }));
    expect(res.status).toBe(200);
    const ups = db.ops.filter((o) => o.table === 'demoras_ventanas' && o.op === 'upsert');
    expect(ups).toHaveLength(1);
    expect(ups[0].vals).toMatchObject({
      escenario_id: 1000, tipo_servicio: 'URGENTE', dia_tipo: 'SABADO',
      hora_inicio: '08:00', hora_fin: '13:00', updated_by: 'jgomez',
    });
    expect(ups[0].opts).toEqual({ onConflict: 'escenario_id,tipo_servicio,dia_tipo' });
  });

  it('PUT de espera máxima: la default (zona null) se actualiza con is(zona_id, null)', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      esperaMax: [{ tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: null, hora_max: '10:00' }],
    }));
    expect(res.status).toBe(200);
    const up = db.ops.find((o) => o.table === 'demoras_espera_max' && o.op === 'update');
    expect(up!.vals).toMatchObject({ hora_max: '10:00', updated_by: 'jgomez' });
    expect(up!.iss).toContainEqual(['zona_id', null]);
    // La fila existía (el update devolvió filas): no hay insert.
    expect(db.ops.some((o) => o.table === 'demoras_espera_max' && o.op === 'insert')).toBe(false);
  });

  it('PUT de espera máxima: un override nuevo cae a insert cuando el update no encontró fila', async () => {
    db.fixtures['__updrows_demoras_espera_max'] = [];
    const res = await PUT(putReq({
      escenario: 1000,
      esperaMax: [{ tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: 72, hora_max: '11:00' }],
    }));
    expect(res.status).toBe(200);
    const ins = db.ops.find((o) => o.table === 'demoras_espera_max' && o.op === 'insert');
    expect(ins!.vals).toMatchObject({
      escenario_id: 1000, tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: 72, hora_max: '11:00',
    });
  });

  it('PUT de espera máxima: hora_max null borra el override de zona (nunca la default)', async () => {
    const res = await PUT(putReq({
      escenario: 1000,
      esperaMax: [
        { tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: 72, hora_max: null },
        { tipo_servicio: 'URGENTE', dia_tipo: 'HABIL', zona_id: null, hora_max: null },
      ],
    }));
    expect(res.status).toBe(200);
    const dels = db.ops.filter((o) => o.table === 'demoras_espera_max' && o.op === 'delete');
    expect(dels).toHaveLength(1);
    expect(dels[0].eqs).toContainEqual(['zona_id', 72]);
  });
});
