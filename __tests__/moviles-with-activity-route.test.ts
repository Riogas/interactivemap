/**
 * Tests para GET /api/moviles-with-activity
 *
 * Mockea getServerSupabaseClient y requireAuth para aislar la lógica del route.
 * Cubre las tres fuentes de actividad: pedidos, services y GPS (vía RPC).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- helpers de mock ----------

type MockSupabaseQuery = {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

/** Construye un cliente Supabase simulado cuyo comportamiento se configura por test */
function buildMockSupabase(overrides: Partial<MockSupabaseQuery> = {}): MockSupabaseQuery {
  const chainable = () => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
  });

  return {
    from: vi.fn(() => chainable()),
    rpc: vi.fn(),
    ...overrides,
  };
}

// ---------- mocks de módulos ----------

vi.mock('@/lib/auth-middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

// ---------- importar DESPUÉS de vi.mock ----------

import { getServerSupabaseClient } from '@/lib/supabase';
import { GET } from '@/app/api/moviles-with-activity/route';

// ---------- utilidades ----------

function makeRequest(date: string, empresaIds?: string): NextRequest {
  const url = new URL(`http://localhost/api/moviles-with-activity?date=${date}${empresaIds ? `&empresaIds=${empresaIds}` : ''}`);
  return new NextRequest(url.toString());
}

/** Configura el mock de supabase para un test dado */
function setupSupabase(opts: {
  pedidos?: Array<{ movil: number }>;
  services?: Array<{ movil: number }>;
  gpsRpc?: Array<{ movil_id: number }> | null; // null = error (activa fallback)
  movilesFilter?: Array<{ nro: number }>;
}) {
  const mockClient: any = {
    from: vi.fn(),
    rpc: vi.fn(),
  };

  // Configurar rpc
  if (opts.gpsRpc === null) {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'function not found' },
    });
  } else {
    mockClient.rpc = vi.fn().mockResolvedValue({
      data: opts.gpsRpc ?? [],
      error: null,
    });
  }

  // Configurar from() para pedidos, services y moviles
  mockClient.from = vi.fn((table: string) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };

    if (table === 'pedidos') {
      chain.not = vi.fn().mockResolvedValue({ data: opts.pedidos ?? [], error: null });
    } else if (table === 'services') {
      chain.not = vi.fn().mockResolvedValue({ data: opts.services ?? [], error: null });
    } else if (table === 'moviles') {
      // El último .in() resuelve la promesa
      chain.in = vi.fn()
        .mockReturnValueOnce(chain) // primer .in() (empresa_fletera_id)
        .mockResolvedValueOnce({ data: opts.movilesFilter ?? [], error: null }); // segundo .in() (nro)
    } else if (table === 'gps_tracking_history') {
      // Fallback paginación (cuando rpc falla)
      chain.range = vi.fn().mockResolvedValue({ data: [], error: null });
    }

    return chain;
  });

  (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
}

// ---------- tests ----------

describe('GET /api/moviles-with-activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve 400 si falta el parámetro date', async () => {
    const req = new NextRequest('http://localhost/api/moviles-with-activity');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('incluye móvil con GPS pero sin pedidos ni services', async () => {
    setupSupabase({
      pedidos: [],
      services: [],
      gpsRpc: [{ movil_id: 42 }],
    });

    const res = await GET(makeRequest('2026-05-13'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toContain(42);
  });

  it('incluye móvil con pedidos pero sin GPS', async () => {
    setupSupabase({
      pedidos: [{ movil: 7 }],
      services: [],
      gpsRpc: [],
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toContain(7);
  });

  it('incluye móvil con services pero sin GPS', async () => {
    setupSupabase({
      pedidos: [],
      services: [{ movil: 15 }],
      gpsRpc: [],
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toContain(15);
  });

  it('móvil con pedidos + GPS aparece una sola vez (dedup)', async () => {
    setupSupabase({
      pedidos: [{ movil: 10 }],
      services: [],
      gpsRpc: [{ movil_id: 10 }],
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    expect(json.success).toBe(true);
    const count = (json.data as number[]).filter((n) => n === 10).length;
    expect(count).toBe(1);
  });

  it('móvil sin ninguna fuente de actividad NO aparece', async () => {
    setupSupabase({
      pedidos: [{ movil: 5 }],
      services: [],
      gpsRpc: [],
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    // El móvil 99 nunca estuvo en ninguna fuente
    expect((json.data as number[])).not.toContain(99);
    // El móvil 5 sí está
    expect((json.data as number[])).toContain(5);
  });

  it('devuelve lista ordenada numéricamente', async () => {
    setupSupabase({
      pedidos: [{ movil: 20 }, { movil: 3 }],
      services: [{ movil: 11 }],
      gpsRpc: [{ movil_id: 7 }],
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    const data: number[] = json.data;
    expect(data).toEqual([...data].sort((a, b) => a - b));
  });

  it('usa fallback de paginación si RPC falla (gpsRpc=null)', async () => {
    // RPC retorna error → el route activa paginación → gps_tracking_history.range devuelve vacío
    setupSupabase({
      pedidos: [{ movil: 33 }],
      services: [],
      gpsRpc: null, // fuerza fallback
    });

    const res = await GET(makeRequest('2026-05-13'));
    const json = await res.json();
    // Debe seguir respondiendo correctamente con los pedidos
    expect(json.success).toBe(true);
    expect(json.data).toContain(33);
  });
});
