/**
 * Tests de la lógica de useScopedZonaIds.
 *
 * El entorno de Vitest es "node" (sin jsdom), por lo que no podemos invocar
 * el hook directamente. Replicamos su contrato:
 *   - Input: shape de user + escenarioIds.
 *   - Output esperado: { scopedZonaIds, error } después de resolver fetch.
 * El compute interno (decisión root/despacho/scoped + parseo de fleteras_zonas)
 * usa los mismos helpers que el hook real (`getScopedEmpresas`, `parseZonasJsonb`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getScopedEmpresas, parseZonasJsonb, shouldScopeByEmpresa } from '../lib/auth-scope';

interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string }>;
  allowedEmpresas?: number[] | null;
}

/**
 * Reproducción de la lógica resolutiva del hook (sin React).
 * Útil para validar la decisión final: { scopedZonaIds, error }.
 */
async function resolveScopedZonaIds(
  user: ScopedUser | null | undefined,
  escenarioIds: number[],
  fetchImpl: typeof fetch,
): Promise<{ scopedZonaIds: Set<number> | null; error: string | null; calledFetch: boolean }> {
  if (!shouldScopeByEmpresa(user)) {
    return { scopedZonaIds: null, error: null, calledFetch: false };
  }
  const empresas = getScopedEmpresas(user);
  if (!empresas || empresas.length === 0) {
    return { scopedZonaIds: new Set(), error: null, calledFetch: false };
  }
  if (escenarioIds.length === 0) {
    return { scopedZonaIds: new Set(), error: null, calledFetch: false };
  }

  const params = new URLSearchParams();
  for (const id of empresas) params.append('empresa_fletera_id', String(id));
  for (const id of escenarioIds) params.append('escenario_id', String(id));

  try {
    const r = await fetchImpl(`/api/fleteras-zonas?${params.toString()}`);
    const res = await r.json();
    if (!res?.success || !Array.isArray(res.data)) {
      return { scopedZonaIds: new Set(), error: 'Respuesta inválida', calledFetch: true };
    }
    const set = new Set<number>();
    for (const row of res.data) {
      for (const z of parseZonasJsonb(row?.zonas)) set.add(z);
    }
    return { scopedZonaIds: set, error: null, calledFetch: true };
  } catch (err) {
    return {
      scopedZonaIds: new Set(),
      error: err instanceof Error ? err.message : 'Error',
      calledFetch: true,
    };
  }
}

describe('useScopedZonaIds — lógica resolutiva', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('root → no llama fetch y retorna scopedZonaIds=null', async () => {
    const result = await resolveScopedZonaIds(
      { isRoot: 'S' },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );
    expect(result.scopedZonaIds).toBeNull();
    expect(result.calledFetch).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('despacho (RolId 49) → no llama fetch y retorna scopedZonaIds=null', async () => {
    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
        allowedEmpresas: [5],
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );
    expect(result.scopedZonaIds).toBeNull();
    expect(result.calledFetch).toBe(false);
  });

  it('distribuidor con allowedEmpresas=[] → no llama fetch y retorna Set vacío', async () => {
    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [],
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );
    expect(result.scopedZonaIds).toBeInstanceOf(Set);
    expect(result.scopedZonaIds!.size).toBe(0);
    expect(result.calledFetch).toBe(false);
  });

  it('distribuidor con allowedEmpresas=null → no llama fetch y retorna Set vacío (fail-closed)', async () => {
    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: null,
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );
    expect(result.scopedZonaIds!.size).toBe(0);
    expect(result.calledFetch).toBe(false);
  });

  it('distribuidor con [5,7] → fetch resuelve set unión deduplicado', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          success: true,
          data: [
            { zonas: [12, 14] },
            { zonas: [14, 19] },
            { zonas: ['21', null, 'abc'] },
          ],
        }),
    });

    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [5, 7],
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );

    expect(result.calledFetch).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.scopedZonaIds).toEqual(new Set([12, 14, 19, 21]));
    expect(result.error).toBeNull();
  });

  it('distribuidor con escenarioIds vacío → no llama fetch (espera datos)', async () => {
    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [5],
      },
      [],
      fetchSpy as unknown as typeof fetch,
    );
    expect(result.calledFetch).toBe(false);
    expect(result.scopedZonaIds!.size).toBe(0);
  });

  it('distribuidor: fetch falla (rejected) → Set vacío + error no nulo', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('500'));

    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [5],
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );

    expect(result.scopedZonaIds!.size).toBe(0);
    expect(result.error).toBe('500');
  });

  it('distribuidor: response sin success=true → Set vacío + error', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: () => Promise.resolve({ success: false }),
    });

    const result = await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [5],
      },
      [1000],
      fetchSpy as unknown as typeof fetch,
    );

    expect(result.scopedZonaIds!.size).toBe(0);
    expect(result.error).toBe('Respuesta inválida');
  });

  it('distribuidor: la URL incluye empresa_fletera_id repetido por cada empresa', async () => {
    fetchSpy.mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await resolveScopedZonaIds(
      {
        isRoot: 'N',
        roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
        allowedEmpresas: [5, 7],
      },
      [1000, 2000],
      fetchSpy as unknown as typeof fetch,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('empresa_fletera_id=5');
    expect(url).toContain('empresa_fletera_id=7');
    expect(url).toContain('escenario_id=1000');
    expect(url).toContain('escenario_id=2000');
  });
});
