/**
 * Tests para getScopedZonasForEmpresas (lib/scoped-zonas-server.ts).
 *
 * Este helper resuelve las zonas que trabajan las empresas del usuario, usado por
 * /api/pedidos y /api/services para incluir los SIN ASIGNAR (empresa_fletera_id=0)
 * que caen en esas zonas. Sin esto, el contador de SA daba 0 para usuarios no-root.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { getScopedZonasForEmpresas } from '@/lib/scoped-zonas-server';
import { getServerSupabaseClient } from '@/lib/supabase';

/** Mock de la cadena .from().select().eq().in().ilike() que resuelve a {data,error}. */
function makeSupabaseMock(result: { data: unknown; error: unknown }) {
  const qb: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'ilike']) {
    qb[m] = () => qb;
  }
  qb.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return { from: () => qb };
}

describe('getScopedZonasForEmpresas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve [] si empresaIds está vacío (no consulta)', async () => {
    const res = await getScopedZonasForEmpresas(1, []);
    expect(res).toEqual([]);
    expect(getServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('devuelve [] si escenarioId no es finito', async () => {
    const res = await getScopedZonasForEmpresas(NaN, [70]);
    expect(res).toEqual([]);
  });

  it('une y deduplica las zonas de varias filas de fleteras_zonas', async () => {
    (getServerSupabaseClient as any).mockReturnValue(
      makeSupabaseMock({ data: [{ zonas: [10, 20, 30] }, { zonas: [20, 40] }], error: null }),
    );
    const res = await getScopedZonasForEmpresas(1, [70, 71]);
    expect(res.sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it('ignora valores no numéricos y filas sin array zonas', async () => {
    (getServerSupabaseClient as any).mockReturnValue(
      makeSupabaseMock({ data: [{ zonas: [5, 'x', null] }, { zonas: null }, {}], error: null }),
    );
    const res = await getScopedZonasForEmpresas(1, [70]);
    expect(res).toEqual([5]);
  });

  it('fail-safe: devuelve [] ante error de la query', async () => {
    (getServerSupabaseClient as any).mockReturnValue(
      makeSupabaseMock({ data: null, error: { message: 'boom' } }),
    );
    const res = await getScopedZonasForEmpresas(1, [70]);
    expect(res).toEqual([]);
  });
});
