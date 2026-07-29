import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

const FILAS = [
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 45, demora_as400: 35 },
  { corrida_at: '2026-07-29T10:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 40 },
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 200, tipo_servicio: 'URGENTE', demora_informada: 30, demora_as400: null },
];

/**
 * Mock del cliente Supabase, por tabla. `.in('zona_id', ids)` FILTRA de
 * verdad las filas configuradas — necesario para que los tests de scope
 * (fix round 1) prueben la respuesta real del endpoint, no solo con qué
 * argumentos se llamó `.in()`. El resto de los métodos son passthrough.
 */
function makeDb(tables: Partial<Record<string, unknown[]>> = {}) {
  const fixtures: Record<string, unknown[]> = {
    demoras_calculadas: FILAS,
    fleteras_zonas: [],
    zonas: [],
    demoras: [],
    ...tables,
  };
  const from = vi.fn((table: string) => {
    let rows = fixtures[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'lte', 'order']) {
      q[m] = vi.fn(() => q);
    }
    q.in = vi.fn((col: string, vals: unknown[]) => {
      if (col === 'zona_id') {
        const set = new Set(vals.map((v) => Number(v)));
        rows = (rows as { zona_id: number }[]).filter((r) => set.has(r.zona_id));
      }
      return q;
    });
    q.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
    return q;
  });
  return { from };
}

/** Headers root por default: preserva el comportamiento de los tests que no
 * ejercitan auth-scope. Pasar `{}` explícito para simular un caller no-root. */
function req(qs: string, headers: Record<string, string> = { 'x-track-isroot': 'S' }) {
  return new NextRequest(`http://localhost/api/demoras/comparativa?${qs}`, { method: 'GET', headers });
}

/** Funcionalidad requerida por el gate server-side (`lib/api-auth-gates.ts`),
 * mismo nombre que exige app/api/metricas/dashboard/route.ts. */
const FUNC = 'Estadisticas Cumplimiento';

/** Headers de un caller no-root que YA pasó el gate de funcionalidad — usar
 * en los tests de scope por empresa, que quieren ejercitar la lógica de
 * `fleteras_zonas` y no el gate en sí (ese se cubre aparte). */
const NON_ROOT_OK: Record<string, string> = { 'x-track-funcs': FUNC };

describe('GET /api/demoras/comparativa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ session: {}, user: { id: 'u1' } } as never);
    mockDb.mockReturnValue(makeDb() as never);
  });

  it('401 sin sesion, sin tocar la base', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const res = await GET(req('escenario=1000'));
    expect(res.status).toBe(401);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('400 cuando falta escenario', async () => {
    const res = await GET(req('fecha=2026-07-29'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_ESCENARIO');
  });

  it('400 con tipo invalido', async () => {
    const res = await GET(req('escenario=1000&tipo=FRUTA'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TIPO');
  });

  it('calcula la brecha por zona y ordena de mayor a menor', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
    expect(z100.prom_calculada).toBe(52.5);
    expect(z100.prom_as400).toBe(37.5);
    expect(z100.brecha).toBe(15);
  });

  it('brecha null cuando el AS400 no informa ese tipo', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    const z200 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 200);
    expect(z200.prom_as400).toBeNull();
    expect(z200.brecha).toBeNull();
  });

  it('la serie de una zona sale ordenada por corrida', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE&zona=100'));
    const body = await res.json();
    expect(body.data.serie).toHaveLength(2);
    expect(body.data.serie[0].calculada).toBe(45);
    expect(body.data.serie[1].calculada).toBe(60);
  });

  // ─── Fix round 1: PuntoComparativa trae zona_id ──────────────────────────
  // Sin esto, la serie sin filtro de zona mezcla puntos de TODAS las zonas
  // ordenados solo por hora — un LineChart con eso zigzaguea.

  it('cada punto de la serie trae su zona_id', async () => {
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    expect(body.data.serie.map((p: { zona_id: number }) => p.zona_id)).toEqual([100, 100, 200]);
  });

  // ─── Fix round 1: orden con null al final (no como "brecha grande") ─────

  it('el orden empuja los null al final; entre brechas reales, mayor |brecha| primero', async () => {
    const filas = [
      { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 1, tipo_servicio: 'URGENTE', demora_informada: 50, demora_as400: 45 }, // brecha 5
      { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 2, tipo_servicio: 'URGENTE', demora_informada: 30, demora_as400: 29.5 }, // brecha 0.5
      { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 3, tipo_servicio: 'URGENTE', demora_informada: 30, demora_as400: null }, // brecha null
    ];
    mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);
    const res = await GET(req('escenario=1000&tipo=URGENTE'));
    const body = await res.json();
    // Con el comparador viejo (abs(null??-1)=1) el orden salia [1, 3, 2]:
    // la zona sin dato colaba ANTES que la de brecha real 0.5.
    expect(body.data.zonas.map((z: { zona_id: number }) => z.zona_id)).toEqual([1, 2, 3]);
  });

  // ─── Fix round 1: nombre real de zona ────────────────────────────────────

  describe('nombre real de zona', () => {
    it('usa zonas.nombre cuando esta disponible', async () => {
      mockDb.mockReturnValue(makeDb({ zonas: [{ zona_id: 100, nombre: 'IBERICA I VILLA MUÑOZ' }] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
      expect(z100.zona_nombre).toBe('IBERICA I VILLA MUÑOZ');
    });

    it('si zonas.nombre viene vacio (string vacio, no null) cae a demoras.zona_nombre (AS400)', async () => {
      mockDb.mockReturnValue(
        makeDb({
          zonas: [{ zona_id: 100, nombre: '' }],
          demoras: [{ zona_id: 100, zona_nombre: 'Nombre AS400' }],
        }) as never,
      );
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
      expect(z100.zona_nombre).toBe('Nombre AS400');
    });

    it('sin nombre en ninguna fuente, usa el placeholder "Zona N"', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE')); // zonas/demoras vacios por default
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
      expect(z100.zona_nombre).toBe('Zona 100');
    });
  });

  // ─── Fix round 1 — CRITICAL: auth-scope por empresa ──────────────────────
  // El endpoint no acotaba por empresa (getServerSupabaseClient usa
  // service_role, bypass total de RLS): cualquier usuario logueado podia
  // pedir cualquier escenario/zona. Mismo patron que app/api/demoras/route.ts
  // y app/api/zonas/route.ts (empresaIds CSV -> fleteras_zonas), con el
  // bypass de root vía header x-track-isroot (como metricas/dashboard).

  describe('auth-scope por empresa', () => {
    it('no-root SIN empresaIds -> payload vacio, sin tocar la base', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ serie: [], zonas: [] });
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('no-root con empresaIds que no parsean a numero -> payload vacio, sin tocar la base', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=abc,', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ serie: [], zonas: [] });
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('no-root cuyas empresas no cubren ninguna zona en fleteras_zonas -> payload vacio', async () => {
      mockDb.mockReturnValue(makeDb({ fleteras_zonas: [] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=5', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ serie: [], zonas: [] });
    });

    it('no-root con empresas validas -> solo ve las zonas de su scope', async () => {
      mockDb.mockReturnValue(makeDb({ fleteras_zonas: [{ zonas: [100] }] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=5', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.zonas.map((z: { zona_id: number }) => z.zona_id)).toEqual([100]);
      expect(body.data.serie).toHaveLength(2);
      expect(body.data.serie.every((p: { zona_id: number }) => p.zona_id === 100)).toBe(true);
    });

    it('root ve todas las zonas sin necesitar empresaIds', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE')); // header root por default
      const body = await res.json();
      expect(body.data.zonas.map((z: { zona_id: number }) => z.zona_id).sort()).toEqual([100, 200]);
    });

    it('pedir una zona fuera del scope no la devuelve', async () => {
      mockDb.mockReturnValue(makeDb({ fleteras_zonas: [{ zonas: [100] }] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&zona=200&empresaIds=5', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.serie).toEqual([]);
      expect(body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 200)).toBeUndefined();
    });
  });

  // ─── Task 8 — gates compartidos con app/api/metricas/dashboard/route.ts ──
  // Los headers x-track-isroot / empresaIds (query) que resuelven el scope de
  // zonas son forjables por el cliente. Estos dos gates (mismo orden, mismos
  // helpers de lib/api-auth-gates.ts que metricas/dashboard) son la defensa
  // real: email de sesión verificado server-side + funcionalidad requerida.

  describe('gate de funcionalidad (Estadisticas Cumplimiento)', () => {
    it('403 NO_FUNCIONALIDAD: no-root sin la funcionalidad, sin tocar la base', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=5', {})); // sin x-track-funcs
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.code).toBe('NO_FUNCIONALIDAD');
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('200: no-root CON la funcionalidad pasa el gate y llega a la lógica de scope', async () => {
      mockDb.mockReturnValue(makeDb({ fleteras_zonas: [{ zonas: [100] }] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=5', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('200: isRoot pasa el gate aunque no tenga la funcionalidad (bypass de root)', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE')); // header root por default, sin x-track-funcs
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('allowlist por email (METRICAS_DASHBOARD_ALLOWED_EMAILS, compartida con metricas/dashboard)', () => {
    const ENV_KEY = 'METRICAS_DASHBOARD_ALLOWED_EMAILS';
    const prev = process.env[ENV_KEY];
    afterEach(() => {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    });

    it('email autenticado en la lista pasa (200), aunque el scope venga por header root', async () => {
      process.env[ENV_KEY] = 'admin@riogas.com.uy, otro@riogas.com.uy';
      mockAuth.mockResolvedValue({ session: {}, user: { id: 'u1', email: 'Admin@Riogas.com.uy' } } as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });

    it('email FUERA de la lista -> 403 NOT_ALLOWLISTED aunque forje x-track-isroot + funcionalidad, sin tocar la base', async () => {
      process.env[ENV_KEY] = 'admin@riogas.com.uy';
      mockAuth.mockResolvedValue({ session: {}, user: { id: 'u2', email: 'intruso@gmail.com' } } as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE', { 'x-track-isroot': 'S', 'x-track-funcs': FUNC }));
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.code).toBe('NOT_ALLOWLISTED');
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('sesión sin email + allowlist seteada -> 403 NOT_ALLOWLISTED', async () => {
      process.env[ENV_KEY] = 'admin@riogas.com.uy';
      mockAuth.mockResolvedValue({ session: {}, user: { id: 'u3' } } as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('NOT_ALLOWLISTED');
    });

    it('sin allowlist (env ausente): no bloquea, cae al gate por headers (comportamiento previo)', async () => {
      delete process.env[ENV_KEY];
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      expect(res.status).toBe(200);
    });
  });
});
