import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerSupabaseClient: vi.fn() }));

import { requireAuth } from '@/lib/auth-middleware';
import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockDb = vi.mocked(getServerSupabaseClient);

/** `sin_capacidad: false` en las filas base: son corridas con capacidad real. */
const FILAS = [
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 45, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' },
  { corrida_at: '2026-07-29T10:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 40, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' },
  { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 200, tipo_servicio: 'URGENTE', demora_informada: 30, demora_as400: null, sin_capacidad: false, clampeado: 'MIN', ritmo_origen: 'GLOBAL' },
];

/** Config sembrada: el escenario 1000 tiene fila operativa por tipo. */
const CONFIG_1000 = [{ tipo_servicio: 'URGENTE' }, { tipo_servicio: 'NOCTURNO' }, { tipo_servicio: 'SERVICE' }];

/**
 * `demoras_modelo`: el gate REAL de si el motor calcula un escenario (I6,
 * review final de rama) — `demoras_calcular_run` recorre `FOR m IN SELECT *
 * FROM demoras_modelo ...`, no `demoras_config`. Una fila por escenario.
 */
const MODELO_1000 = [{ escenario_id: 1000 }];

/**
 * Mock del cliente Supabase, por tabla. `.in('zona_id', ids)` FILTRA de
 * verdad las filas configuradas — necesario para que los tests de scope
 * (fix round 1) prueben la respuesta real del endpoint, no solo con qué
 * argumentos se llamó `.in()`.
 *
 * B1 — el mock reproduce el TECHO DE 1000 FILAS de Supabase/PostgREST, que es
 * el bug entero: sin `.range()`, la respuesta se trunca en 1000 filas y el
 * cliente no se entera. Si el mock devolviera siempre todo, el test de
 * paginación pasaría igual con un endpoint sin paginar — un test que no puede
 * fallar. Acá, un endpoint que no llame `.range()` recibe 1000 filas y punto;
 * uno que pagine recibe cada bloque como en producción.
 *
 * El resto de los métodos son passthrough.
 */
const SUPABASE_MAX_ROWS = 1000;

function makeDb(tables: Partial<Record<string, unknown[]>> = {}) {
  const fixtures: Record<string, unknown[]> = {
    demoras_calculadas: FILAS,
    demoras_config: CONFIG_1000,
    demoras_modelo: MODELO_1000,
    fleteras_zonas: [],
    zonas: [],
    demoras: [],
    ...tables,
  };
  // Qué columnas pidió cada `.select()`, por tabla. Existe porque el mock
  // devuelve las filas ENTERAS del fixture ignorando el select: un FILA_COLS
  // al que le falte una columna de auditoría pasaría todos los tests de
  // mapeo igual (el fixture trae la key, producción no) — un test que no
  // puede fallar. Con esto, el test de columnas inspecciona el string real.
  const selects: Record<string, string[]> = {};
  const from = vi.fn((table: string) => {
    let rows = fixtures[table] ?? [];
    let ranged = false;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'lte', 'order']) {
      q[m] = vi.fn(() => q);
    }
    q.select = vi.fn((cols: string) => {
      (selects[table] ??= []).push(cols);
      return q;
    });
    q.in = vi.fn((col: string, vals: unknown[]) => {
      if (col === 'zona_id') {
        const set = new Set(vals.map((v) => Number(v)));
        rows = (rows as { zona_id: number }[]).filter((r) => set.has(r.zona_id));
      }
      return q;
    });
    q.range = vi.fn((from_: number, to: number) => {
      ranged = true;
      // Ni con un .range() enorme PostgREST devuelve más de 1000 filas.
      rows = rows.slice(from_, Math.min(to + 1, from_ + SUPABASE_MAX_ROWS));
      return q;
    });
    q.then = (res: (v: unknown) => unknown) =>
      res({ data: ranged ? rows : rows.slice(0, SUPABASE_MAX_ROWS), error: null });
    return q;
  });
  return { from, selects };
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
      expect(body.data.serie).toEqual([]);
      expect(body.data.zonas).toEqual([]);
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('no-root con empresaIds que no parsean a numero -> payload vacio, sin tocar la base', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=abc,', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.serie).toEqual([]);
      expect(body.data.zonas).toEqual([]);
      expect(mockDb).not.toHaveBeenCalled();
    });

    it('no-root cuyas empresas no cubren ninguna zona en fleteras_zonas -> payload vacio', async () => {
      mockDb.mockReturnValue(makeDb({ fleteras_zonas: [] }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&empresaIds=5', NON_ROOT_OK));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.serie).toEqual([]);
      expect(body.data.zonas).toEqual([]);
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

  // ─── B1 — paginacion: Supabase corta en 1000 filas SIN avisar ────────────
  // Un dia entero son ~10.500 filas solo de URGENTE (106 zonas x 99 corridas).
  // Sin .range(), el endpoint recibia las primeras 1000 y no se enteraba; y
  // como el .order('corrida_at') va ANTES del corte, las que sobrevivian eran
  // las corridas MAS VIEJAS: el grafico terminaba a las 08:30 y la brecha
  // promediaba solo la primera hora y media del dia.

  describe('paginacion (mas de 1000 filas por dia)', () => {
    /** N corridas de 2 zonas, ordenadas por corrida_at como las devuelve la BD. */
    function filasMasivas(corridas: number) {
      const filas: Record<string, unknown>[] = [];
      for (let i = 0; i < corridas; i += 1) {
        const t = new Date(Date.UTC(2026, 6, 29, 10, 0, 0) + i * 600_000).toISOString();
        filas.push({ corrida_at: t, zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 40, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' });
        filas.push({ corrida_at: t, zona_id: 200, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' });
      }
      return filas;
    }

    it('trae TODAS las filas cuando hay mas de 1000 (no se corta en la primera pagina)', async () => {
      const filas = filasMasivas(1500); // 3000 filas: 3 paginas (1000 + 1000 + 1000)
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);

      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.total_filas).toBe(3000);
      expect(body.data.serie).toHaveLength(3000);
    });

    it('la ultima corrida del dia llega al payload (el truncado se comia la tarde)', async () => {
      const filas = filasMasivas(1500);
      const ultima = filas[filas.length - 1].corrida_at as string;
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);

      const res = await GET(req('escenario=1000&tipo=URGENTE&zona=100'));
      const body = await res.json();

      const horas = body.data.serie.map((p: { corrida_at: string }) => p.corrida_at);
      expect(horas).toContain(ultima);
      expect(body.data.serie).toHaveLength(1500);
    });

    it('un dia con exactamente 1000 filas no dispara una pagina extra vacia', async () => {
      const filas = filasMasivas(500); // exactamente 1000
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);

      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();

      expect(body.data.total_filas).toBe(1000);
    });

    it('el promedio por zona usa todo el dia, no solo la primera pagina', async () => {
      // 1500 corridas: la zona 100 informa 40 en las primeras 1000 filas
      // (las primeras 500 corridas) y 100 de ahi en adelante. Con truncado en
      // 1000 filas el promedio daria 40; con todo el dia, 60.
      const filas: Record<string, unknown>[] = [];
      for (let i = 0; i < 1500; i += 1) {
        const t = new Date(Date.UTC(2026, 6, 29, 10, 0, 0) + i * 600_000).toISOString();
        filas.push({ corrida_at: t, zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: i < 500 ? 40 : 100, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' });
        filas.push({ corrida_at: t, zona_id: 200, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' });
      }
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);

      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);

      // (500*40 + 1000*100) / 1500 = 80
      expect(z100.prom_calculada).toBe(80);
      expect(z100.muestras).toBe(1500);
    });
  });

  // ─── B2 — las filas sin capacidad no promedian ───────────────────────────
  // A las 07:00 el 72% de la flota esta inactiva: capacidad<=0 y la fila
  // informa el techo (120) por definicion, no por calculo. Promediarlas
  // arruina la calibracion contra el AS400.

  describe('filas sin capacidad (sin_capacidad = true)', () => {
    const CON_SIN_CAP = [
      { corrida_at: '2026-07-29T07:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 120, demora_as400: 35, sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' },
      { corrida_at: '2026-07-29T07:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 120, demora_as400: 35, sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' },
      { corrida_at: '2026-07-29T10:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 45, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' },
      { corrida_at: '2026-07-29T10:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 55, demora_as400: 45, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA' },
    ];

    it('el promedio y la brecha ignoran las corridas sin capacidad', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: CON_SIN_CAP }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);

      // Con las 4 filas el promedio daria (120+120+45+55)/4 = 85; con solo
      // las 2 que tienen capacidad, 50.
      expect(z100.prom_calculada).toBe(50);
      expect(z100.prom_as400).toBe(40); // (35+45)/2, NO (35+35+35+45)/4
      expect(z100.brecha).toBe(10);
    });

    it('informa cuantas corridas se excluyeron, por zona y en total', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: CON_SIN_CAP }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);

      expect(z100.excluidas_sin_capacidad).toBe(2);
      expect(z100.muestras).toBe(2);
      expect(body.data.excluidas_sin_capacidad).toBe(2);
      expect(body.data.total_filas).toBe(4);
    });

    it('una zona con TODAS las corridas sin capacidad queda con promedio null (no con 120)', async () => {
      const filas = [
        { corrida_at: '2026-07-29T07:00:00-03:00', zona_id: 300, tipo_servicio: 'URGENTE', demora_informada: 120, demora_as400: 35, sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' },
        { corrida_at: '2026-07-29T07:10:00-03:00', zona_id: 300, tipo_servicio: 'URGENTE', demora_informada: 120, demora_as400: 35, sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' },
      ];
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z300 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 300);

      expect(z300.prom_calculada).toBeNull();
      expect(z300.brecha).toBeNull();
      expect(z300.muestras).toBe(0);
      expect(z300.excluidas_sin_capacidad).toBe(2);
    });

    it('la SERIE conserva los puntos sin capacidad, marcados (la card los dibuja)', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: CON_SIN_CAP }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&zona=100'));
      const body = await res.json();

      expect(body.data.serie).toHaveLength(4);
      expect(body.data.serie.map((p: { sin_capacidad: boolean }) => p.sin_capacidad)).toEqual([true, true, false, false]);
    });

    it('la serie trae las banderas que explican un 120 (clampeado y ritmo_origen)', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: CON_SIN_CAP }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE&zona=100'));
      const body = await res.json();

      expect(body.data.serie[0].clampeado).toBe('MAX');
      expect(body.data.serie[0].ritmo_origen).toBe('DEFECTO');
      expect(body.data.serie[2].clampeado).toBeNull();
      expect(body.data.serie[2].ritmo_origen).toBe('ZONA');
    });

    it('sin ninguna fila sin capacidad, el contador es 0 (no se inventa exclusion)', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE')); // FILAS base
      const body = await res.json();
      expect(body.data.excluidas_sin_capacidad).toBe(0);
      expect(body.data.total_filas).toBe(3);
    });
  });

  // ─── Desglose por zona: zonas[].ultima ───────────────────────────────────
  // La card expande cada zona de la tabla de brecha con "el porqué" de su
  // última corrida (modelo CONSUMO_TRAMOS): cruda, capacidad inicial→final,
  // tramos, cola, móviles, ritmo con origen y muestras, banderas.

  describe('zonas[].ultima (desglose de la última corrida)', () => {
    /** Dos corridas con auditoría completa y valores DISTINTOS en todo: si el
     * endpoint devolviera la primera en vez de la última, todos los asserts
     * de mapeo fallan. */
    const CON_AUDITORIA = [
      { corrida_at: '2026-08-03T10:00:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 45, demora_as400: 35, sin_capacidad: false, clampeado: null, ritmo_origen: 'ZONA', demora_cruda: 44.1, capacidad_inicial: 0.02, capacidad_final: 0.02, tramos: 1, cola_por_delante: 1, moviles_considerados: 2, ritmo_usado: 18.2, ritmo_muestras: 60, suavizado_aplicado: false },
      // Valores TODOS distintos entre sí (tramos 3 vs moviles 5, etc.): un
      // mutante que intercambie el mapeo de dos campos en toUltima no puede
      // pasar el toEqual de abajo.
      { corrida_at: '2026-08-03T10:10:00-03:00', zona_id: 100, tipo_servicio: 'URGENTE', demora_informada: 60, demora_as400: 40, sin_capacidad: false, clampeado: 'MAX', ritmo_origen: 'CHOFER', demora_cruda: 55.3, capacidad_inicial: 0.01, capacidad_final: 0.03, tramos: 3, cola_por_delante: 4, moviles_considerados: 5, ritmo_usado: 15.3, ritmo_muestras: 214, suavizado_aplicado: true },
    ];

    it('ultima es la ÚLTIMA corrida del día, con toda la auditoría mapeada', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: CON_AUDITORIA }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
      expect(z100.ultima).toEqual({
        corrida_at: '2026-08-03T10:10:00-03:00',
        demora_informada: 60,
        demora_cruda: 55.3,
        as400: 40,
        capacidad_inicial: 0.01,
        capacidad_final: 0.03,
        tramos: 3,
        cola_por_delante: 4,
        moviles_considerados: 5,
        ritmo_usado: 15.3,
        ritmo_origen: 'CHOFER',
        ritmo_muestras: 214,
        sin_capacidad: false,
        clampeado: 'MAX',
        suavizado_aplicado: true,
      });
    });

    it('corridas del modelo viejo (sin columnas de auditoría) -> null explícitos, no undefined ni ceros', async () => {
      // FILAS (fixture base) no trae ninguna columna nueva: simula filas
      // escritas antes de la migración TRAMOS.
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z100 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 100);
      expect(z100.ultima.corrida_at).toBe('2026-07-29T10:10:00-03:00');
      // Claves PRESENTES con null (JSON omite undefined: 'in' distingue).
      for (const k of ['demora_cruda', 'capacidad_inicial', 'capacidad_final', 'tramos', 'cola_por_delante', 'moviles_considerados', 'ritmo_usado', 'ritmo_muestras']) {
        expect(k in z100.ultima).toBe(true);
        expect(z100.ultima[k]).toBeNull();
      }
      expect(z100.ultima.suavizado_aplicado).toBe(false);
    });

    it('una zona con TODAS las corridas sin capacidad igual trae su ultima (el desglose explica el techo)', async () => {
      const filas = [
        { corrida_at: '2026-08-03T07:00:00-03:00', zona_id: 300, tipo_servicio: 'URGENTE', demora_informada: 120, demora_as400: 35, sin_capacidad: true, clampeado: 'MAX', ritmo_origen: 'DEFECTO' },
      ];
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: filas }) as never);
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      const z300 = body.data.zonas.find((z: { zona_id: number }) => z.zona_id === 300);
      expect(z300.prom_calculada).toBeNull();
      expect(z300.ultima.sin_capacidad).toBe(true);
      expect(z300.ultima.demora_informada).toBe(120);
    });

    it('el select a demoras_calculadas pide las columnas de auditoría (guarda de FILA_COLS)', async () => {
      const db = makeDb();
      mockDb.mockReturnValue(db as never);
      await GET(req('escenario=1000&tipo=URGENTE'));
      const cols = db.selects.demoras_calculadas?.[0] ?? '';
      for (const c of ['demora_cruda', 'capacidad_inicial', 'capacidad_final', 'tramos', 'cola_por_delante', 'moviles_considerados', 'ritmo_usado', 'ritmo_muestras', 'suavizado_aplicado']) {
        expect(cols).toContain(c);
      }
    });
  });

  // ─── B3 — el motor solo calcula escenarios con fila en demoras_modelo ────
  // I6 (review final de rama): el gate REAL paso a ser demoras_modelo desde
  // que el orquestador (v3) recorre TODOS los escenarios con fila ahi. El
  // endpoint miraba demoras_config, que es el gate VIEJO (de la epoca del
  // escenario 1000 clavado) -- con cualquier escenario que tuviera
  // demoras_config pero NO demoras_modelo, la card quedaba vacia PARA
  // SIEMPRE diciendo "todavia no hay corridas", que es exactamente el
  // mensaje falso que este flag existe para evitar.

  describe('escenario_configurado', () => {
    it('true cuando el escenario tiene fila en demoras_modelo', async () => {
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      expect(body.data.escenario_configurado).toBe(true);
    });

    it('false cuando el escenario no tiene NINGUNA fila en demoras_modelo', async () => {
      mockDb.mockReturnValue(makeDb({ demoras_calculadas: [], demoras_modelo: [] }) as never);
      const res = await GET(req('escenario=2000&tipo=URGENTE'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.serie).toEqual([]);
      expect(body.data.escenario_configurado).toBe(false);
    });

    it('false cuando el escenario tiene demoras_config pero NO demoras_modelo (I6 -- el motor nunca lo va a calcular)', async () => {
      mockDb.mockReturnValue(
        makeDb({ demoras_calculadas: [], demoras_config: CONFIG_1000, demoras_modelo: [] }) as never,
      );
      const res = await GET(req('escenario=1000&tipo=URGENTE'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.escenario_configurado).toBe(false);
    });
  });
});
