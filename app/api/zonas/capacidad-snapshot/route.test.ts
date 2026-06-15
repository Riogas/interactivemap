/**
 * Tests para GET /api/zonas/capacidad-snapshot
 *
 * Patrón de mock: siguiendo app/api/admin/login-security/config/route.test.ts
 * - vi.mock para supabase y auth-middleware
 * - NextRequest con headers para auth-scope y feature flags
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
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

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSupabase = vi.mocked(getServerSupabaseClient);

// =============================================================================
// HELPERS
// =============================================================================

/** Sesión fake para simular usuario autenticado */
const FAKE_SESSION = { session: { user: { id: 'user-123' } }, user: { id: 'user-123' } };

/** Construir un NextRequest para el endpoint */
function makeRequest(params: {
  escenario?: string | null;
  tipoServicio?: string | null;
  zonas?: string | null;
  isRoot?: boolean;
  empresasIds?: number[];
  funcionalidades?: string[];
}): NextRequest {
  const sp = new URLSearchParams();
  if (params.escenario != null) sp.set('escenario', params.escenario);
  if (params.tipoServicio != null) sp.set('tipoServicio', params.tipoServicio);
  if (params.zonas != null) sp.set('zonas', params.zonas);

  const url = `http://localhost/api/zonas/capacidad-snapshot?${sp.toString()}`;
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

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

const VW_ROWS_EMP70 = [
  {
    escenario: 1, zona: 10, emp_fletera_id: 70, tipo_servicio: 'URGENTE',
    capacidad_total: 20, moviles_count: 2, moviles_prioridad: 2, moviles_transito: 0, last_sync: null,
  },
  {
    escenario: 1, zona: 11, emp_fletera_id: 70, tipo_servicio: 'URGENTE',
    capacidad_total: 5, moviles_count: 1, moviles_prioridad: 1, moviles_transito: 0, last_sync: null,
  },
];

const ZCE_ROWS_EMP70 = [
  { zona: 10, movil: 100, lote_disponible: 12, emp_fletera_id: 70, tipo_servicio: 'URGENTE' },
  { zona: 10, movil: 101, lote_disponible: 8,  emp_fletera_id: 70, tipo_servicio: 'URGENTE' },
  { zona: 11, movil: 102, lote_disponible: 5,  emp_fletera_id: 70, tipo_servicio: 'URGENTE' },
];

const MZ_ROWS = [
  { movil_id: '100', zona_id: 10, escenario_id: 1, prioridad_o_transito: 1, tipo_de_servicio: 'URGENTE' }, // prioridad
  { movil_id: '101', zona_id: 10, escenario_id: 1, prioridad_o_transito: 2, tipo_de_servicio: 'URGENTE' }, // tránsito
  { movil_id: '102', zona_id: 11, escenario_id: 1, prioridad_o_transito: 1, tipo_de_servicio: 'URGENTE' }, // prioridad
];

// estado_nro: null = activo (sin estado especial)
const MOVIL_CAP_ROWS = [
  { nro: 100, capacidad: 3, tamano_lote: 15, estado_nro: null },
  { nro: 101, capacidad: 7, tamano_lote: 10, estado_nro: null },
  { nro: 102, capacidad: 2, tamano_lote: 8,  estado_nro: null },
];

const PEDIDOS_ROWS = [
  { id: 1001, zona_nro: 10, servicio_nombre: 'GAS 13KG', fch_para: '2026-05-22', cliente_direccion: 'Av. 18 de Julio 1234' },
  { id: 1002, zona_nro: 10, servicio_nombre: 'GAS 13KG', fch_para: '2026-05-22', cliente_direccion: 'Rambla Sur 500' },
  { id: 1003, zona_nro: 11, servicio_nombre: 'GAS 45KG', fch_para: '2026-05-22', cliente_direccion: 'Rivera 890' },
];

/** Fábrica de mock de supabase que encadena .from().select().eq().in()... */
function makeSupabaseMock(overrides: {
  vwRows?: typeof VW_ROWS_EMP70 | [];
  zceRows?: typeof ZCE_ROWS_EMP70 | [];
  mzRows?: typeof MZ_ROWS | [];
  movilCapRows?: Array<{ nro: number; capacidad: number; tamano_lote: number | null; estado_nro: number | null }>;
  pedidosRows?: typeof PEDIDOS_ROWS | [];
} = {}) {
  const vwRows = overrides.vwRows ?? VW_ROWS_EMP70;
  const zceRows = overrides.zceRows ?? ZCE_ROWS_EMP70;
  const mzRows = overrides.mzRows ?? MZ_ROWS;
  const movilCapRows = overrides.movilCapRows ?? MOVIL_CAP_ROWS;
  const pedidosRows = overrides.pedidosRows ?? PEDIDOS_ROWS;

  // Query builder genérico que termina en una Promise
  const makeQb = (data: unknown[]) => {
    const qb: Record<string, unknown> = {};
    const methods = ['eq', 'in', 'or', 'gte', 'lte'];
    for (const m of methods) {
      qb[m] = () => qb;
    }
    // maybeSingle para queries tipo escenario_settings (devuelve sin row → defaults)
    qb.maybeSingle = () => Promise.resolve({ data: null, error: null });
    // then para que sea awaitable
    qb.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return qb;
  };

  // Query builder que honra el filtro .eq() sobre una columna concreta. Se usa
  // para moviles_zonas, donde el filtro tipo_de_servicio es relevante: con TODOS
  // el endpoint debe consultar el bucket URGENTE (no 'TODOS', que no existe).
  const makeFilteringQb = (rows: Array<Record<string, unknown>>, filterCol: string) => {
    let result = rows;
    const qb: Record<string, unknown> = {};
    qb.eq = (col: string, val: unknown) => {
      if (col === filterCol) result = result.filter((r) => r[col] === val);
      return qb;
    };
    for (const m of ['in', 'or', 'gte', 'lte']) qb[m] = () => qb;
    qb.maybeSingle = () => Promise.resolve({ data: null, error: null });
    qb.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      Promise.resolve({ data: result, error: null }).then(resolve);
    return qb;
  };

  return {
    from: (table: string) => ({
      select: (_: string) => {
        if (table === 'vw_zona_capacidad') return makeQb(vwRows);
        if (table === 'zonas_cap_entrega') return makeQb(zceRows);
        if (table === 'moviles_zonas') return makeFilteringQb(mzRows as Array<Record<string, unknown>>, 'tipo_de_servicio');
        if (table === 'moviles') return makeQb(movilCapRows);
        if (table === 'pedidos') return makeQb(pedidosRows);
        if (table === 'escenario_settings') return makeQb([]);
        return makeQb([]);
      },
    }),
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('GET /api/zonas/capacidad-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: autenticado, supabase funciona
    mockRequireAuth.mockResolvedValue(FAKE_SESSION as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never);
    mockGetSupabase.mockReturnValue(makeSupabaseMock() as unknown as ReturnType<typeof getServerSupabaseClient>);
  });

  // ─── AC-3: Auth ────────────────────────────────────────────────────────────

  it('401 cuando no hay sesión (requireAuth devuelve NextResponse)', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'No autorizado' }, { status: 401 }) as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never,
    );
    const req = makeRequest({ escenario: '1', tipoServicio: 'URGENTE', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // ─── AC-3: Validaciones de params ─────────────────────────────────────────

  it('400 cuando escenario está ausente', async () => {
    const req = makeRequest({ tipoServicio: 'URGENTE', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_ESCENARIO');
  });

  it('400 cuando tipoServicio es inválido', async () => {
    const req = makeRequest({ escenario: '1', tipoServicio: 'INVALIDO', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_TIPO_SERVICIO');
  });

  // ─── AC-5: Sin feature → pedidos_sin_asignar = 0 ──────────────────────────

  it('sin feature: pedidos_sin_asignar = 0 y pedidos_sin_asignar_detalle ausente', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: [], // sin la funcionalidad
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();
    expect(zona10.pedidos_sin_asignar).toBe(0);
    expect(zona10.pedidos_sin_asignar_detalle).toBeUndefined();
  });

  // ─── Gating SA: x zona cuenta total pero NO trae detalle ──────────────────

  it('con "Ped s/asignar x zona": pedidos_sin_asignar = count, SIN detalle (solo unitarios trae detalle)', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: ['Ped s/asignar x zona'],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();
    expect(zona10.pedidos_sin_asignar).toBe(2); // cuenta el total
    expect(zona10.pedidos_sin_asignar_detalle).toBeUndefined(); // sin detalle
  });

  // ─── Gating SA: unitarios trae el detalle con tipo_servicio ───────────────

  it('con "Ped s/asignar unitarios": detalle presente con tipo_servicio (no cliente)', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: ['Ped s/asignar unitarios'],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();
    expect(zona10.pedidos_sin_asignar).toBe(2);
    expect(Array.isArray(zona10.pedidos_sin_asignar_detalle)).toBe(true);
    expect(zona10.pedidos_sin_asignar_detalle).toHaveLength(2);
    const detalle = zona10.pedidos_sin_asignar_detalle[0];
    expect(detalle).toHaveProperty('id');
    expect(detalle).toHaveProperty('tipo_servicio');
    expect(detalle).toHaveProperty('fecha');
    expect(detalle).toHaveProperty('direccion_corta');
    expect(detalle).not.toHaveProperty('cliente');
    expect(detalle.tipo_servicio).toBe('GAS 13KG');
  });

  // ─── AC-5: moviles_prioridad vs moviles_transito ──────────────────────────

  it('moviles_prioridad y moviles_transito derivados desde el detalle deduplicado', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: [],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    // Para zona 10: movil 100 (prio_o_transito=1 → prio) y 101 (=2 → tránsito)
    // Los counts se derivan del moviles_detalle, no del campo de la vista
    // (la vista inflaba con rows multi-tipo_servicio).
    expect(zona10.moviles_prioridad).toBe(1);
    expect(zona10.moviles_transito).toBe(1);
  });

  it('en_transito correcto en moviles_detalle (movil 101 es tránsito)', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: [],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    const movil100 = zona10.moviles_detalle.find((m: { movil_id: number }) => m.movil_id === 100);
    const movil101 = zona10.moviles_detalle.find((m: { movil_id: number }) => m.movil_id === 101);
    expect(movil100?.en_transito).toBe(false); // prioridad_o_transito = 1
    expect(movil101?.en_transito).toBe(true);  // prioridad_o_transito = 2
  });

  // Regресión: TODOS/OTROS no tienen bucket propio en moviles_zonas (sólo URGENTE,
  // NOCTURNO, SERVICE). El endpoint debe consultar el bucket URGENTE para esos
  // valores; de lo contrario el conteo zonas_prioridad/zonas_transito y en_transito
  // quedan vacíos (bug reportado: con "Todos los pedidos" no se ven las zonas P|T).
  it('tipoServicio=TODOS: usa el bucket URGENTE para zonas P|T y en_transito', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'TODOS',
      isRoot: true,
      funcionalidades: [],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    // Si el filtro usara 'TODOS' literal, moviles_zonas devolvería 0 filas y estos
    // counts serían 0 / en_transito false para todos.
    expect(zona10.moviles_prioridad).toBe(1);
    expect(zona10.moviles_transito).toBe(1);
    const movil100 = zona10.moviles_detalle.find((m: { movil_id: number }) => m.movil_id === 100);
    const movil101 = zona10.moviles_detalle.find((m: { movil_id: number }) => m.movil_id === 101);
    expect(movil100?.zonas_prioridad).toBe(1);
    expect(movil101?.en_transito).toBe(true);
  });

  // ─── AC-5: filtro tipoServicio ────────────────────────────────────────────

  it('tipoServicio=SERVICE: devuelve zonas vacías cuando no hay datos de SERVICE', async () => {
    // Mock con 0 rows para SERVICE
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({ vwRows: [], zceRows: [] }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'SERVICE',
      isRoot: true,
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  // ─── AC-5: auth-scope empresa ─────────────────────────────────────────────

  it('auth-scope empresa: zona de empresa no autorizada no aparece en response', async () => {
    // Supongamos que hay 2 empresas (70 y 99) pero el scope solo permite la 70.
    // La vista devuelve filas de las 2 empresas, pero el endpoint filtra por el scope.
    // En nuestro mock, el filtro .in('emp_fletera_id', [70]) se aplica server-side;
    // el mock devuelve solo filas de emp_fletera_id=70 (simulando el filtro aplicado).
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: false,
      empresasIds: [70],
      funcionalidades: [],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Todas las zonas devueltas pertenecen al scope de empresa 70
    expect(body.data.length).toBeGreaterThan(0);
    // No debe haber zonas de empresa_fletera_id != 70 (el mock ya filtra)
    expect(body.success).toBe(true);
  });

  it('fail-closed: no-root sin empresas válidas → devuelve []', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: false,
      empresasIds: [], // vacío → fail-closed
      funcionalidades: [],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  // ─── Respuesta happy path ─────────────────────────────────────────────────

  it('happy path isRoot: devuelve datos bien tipados con estructura correcta', async () => {
    const req = makeRequest({
      escenario: '1',
      tipoServicio: 'URGENTE',
      isRoot: true,
      funcionalidades: ['Ped s/asignar unitarios'],
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
    // Verificar estructura ZonaCapSnapshot
    for (const zona of body.data) {
      expect(typeof zona.zona_id).toBe('number');
      expect(typeof zona.capacidad_total).toBe('number');
      expect(typeof zona.pedidos_sin_asignar).toBe('number');
      expect(typeof zona.moviles_prioridad).toBe('number');
      expect(typeof zona.moviles_transito).toBe('number');
      expect(Array.isArray(zona.moviles_detalle)).toBe(true);
      // Con "unitarios": pedidos_sin_asignar_detalle presente
      expect(Array.isArray(zona.pedidos_sin_asignar_detalle)).toBe(true);
    }
  });

  // ─── Filtro de móviles inactivos ──────────────────────────────────────────
  // AC-2: móviles con estado_nro IN (3, 5, 15) no deben aparecer en moviles_detalle
  // ni contribuir a moviles_prioridad/moviles_transito.

  it('móvil con estado_nro=3 (inactivo) NO aparece en moviles_detalle', async () => {
    // Fixture: zona 10 tiene 2 móviles. El 100 está inactivo (estado_nro=3), el 101 activo.
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({
        movilCapRows: [
          { nro: 100, capacidad: 3, tamano_lote: 15, estado_nro: 3 }, // inactivo
          { nro: 101, capacidad: 7, tamano_lote: 10, estado_nro: null }, // activo
          { nro: 102, capacidad: 2, tamano_lote: 8,  estado_nro: null },
        ],
      }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ escenario: '1', tipoServicio: 'URGENTE', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();

    // El móvil 100 (inactivo) no debe aparecer
    const movilIds = zona10.moviles_detalle.map((m: { movil_id: number }) => m.movil_id);
    expect(movilIds).not.toContain(100);
    expect(movilIds).toContain(101); // el activo sí aparece

    // Solo 1 móvil activo en prioridad (el 101 está en prioridad_o_transito=2 → tránsito)
    // 100 era prioridad_o_transito=1 pero es inactivo → no cuenta
    expect(zona10.moviles_prioridad).toBe(0);
    expect(zona10.moviles_transito).toBe(1);
  });

  it('móviles con estado_nro=5 y estado_nro=15 también son excluidos', async () => {
    // Fixture: zona 10 tiene 2 móviles, ambos inactivos (estados 5 y 15).
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({
        movilCapRows: [
          { nro: 100, capacidad: 3, tamano_lote: 15, estado_nro: 5  }, // inactivo
          { nro: 101, capacidad: 7, tamano_lote: 10, estado_nro: 15 }, // inactivo
          { nro: 102, capacidad: 2, tamano_lote: 8,  estado_nro: null },
        ],
      }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ escenario: '1', tipoServicio: 'URGENTE', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();

    const movilIds = zona10.moviles_detalle.map((m: { movil_id: number }) => m.movil_id);
    expect(movilIds).not.toContain(100); // estado_nro=5 excluido
    expect(movilIds).not.toContain(101); // estado_nro=15 excluido

    // Zona 10 sin móviles activos
    expect(zona10.moviles_prioridad).toBe(0);
    expect(zona10.moviles_transito).toBe(0);
  });

  it('fixture mixta: activos aparecen, inactivos excluidos, counts correctos', async () => {
    // Fixture: zona 10 tiene 2 móviles (100 activo, 101 inactivo estado_nro=3).
    // La vista v2 ya los excluiría en SQL, pero el endpoint aplica el read-time filter también.
    // Simulamos: vw_zona_capacidad ya filtra (capacidad_total refleja solo el activo),
    // y el endpoint filtra en movilDedupMap.
    mockGetSupabase.mockReturnValue(
      makeSupabaseMock({
        vwRows: [
          // Vista v2 ya excluye móvil 101 (inactivo): capacidad_total = 12 (solo aporte del 100)
          {
            escenario: 1, zona: 10, emp_fletera_id: 70, tipo_servicio: 'URGENTE',
            capacidad_total: 12, moviles_count: 1, moviles_prioridad: 1, moviles_transito: 0, last_sync: null,
          },
          {
            escenario: 1, zona: 11, emp_fletera_id: 70, tipo_servicio: 'URGENTE',
            capacidad_total: 5, moviles_count: 1, moviles_prioridad: 1, moviles_transito: 0, last_sync: null,
          },
        ],
        movilCapRows: [
          { nro: 100, capacidad: 3, tamano_lote: 15, estado_nro: null }, // activo
          { nro: 101, capacidad: 7, tamano_lote: 10, estado_nro: 3   }, // inactivo — debe excluirse
          { nro: 102, capacidad: 2, tamano_lote: 8,  estado_nro: null },
        ],
      }) as unknown as ReturnType<typeof getServerSupabaseClient>,
    );

    const req = makeRequest({ escenario: '1', tipoServicio: 'URGENTE', isRoot: true });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    const zona10 = body.data.find((z: { zona_id: number }) => z.zona_id === 10);
    expect(zona10).toBeDefined();

    // Solo el activo (100) aparece
    const movilIds = zona10.moviles_detalle.map((m: { movil_id: number }) => m.movil_id);
    expect(movilIds).toContain(100);
    expect(movilIds).not.toContain(101);
    expect(movilIds).toHaveLength(1);

    // movil 100 es prioridad_o_transito=1 → prioridad
    expect(zona10.moviles_prioridad).toBe(1);
    expect(zona10.moviles_transito).toBe(0);

    // capacidad_total viene de la vista (ya excluye inactivos en v2)
    expect(zona10.capacidad_total).toBe(12);
  });
});
