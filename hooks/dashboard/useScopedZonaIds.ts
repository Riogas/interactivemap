import { useEffect, useState } from 'react';
import { getScopedEmpresas, parseZonasJsonb, shouldScopeByEmpresa } from '@/lib/auth-scope';

interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string }>;
  allowedEmpresas?: number[] | null;
}

interface UseScopedZonaIdsResult {
  /** null = sin scope (root o despacho), Set = zonas permitidas (vacío = fail-closed). */
  scopedZonaIds: Set<number> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Calcula el set de zona_id permitido para el usuario actual basado en
 * fleteras_zonas filtrado por user.allowedEmpresas.
 *
 *   - Root o despacho → { scopedZonaIds: null } (sin restricción).
 *   - Distribuidor con allowedEmpresas vacío/null → { scopedZonaIds: new Set() } fail-closed.
 *   - Distribuidor con empresas → fetch a /api/fleteras-zonas y aplana las zonas.
 */
export function useScopedZonaIds(
  user: ScopedUser | null | undefined,
  escenarioIds: number[],
): UseScopedZonaIdsResult {
  const noScope = !shouldScopeByEmpresa(user);
  const empresas = noScope ? null : getScopedEmpresas(user);

  const [state, setState] = useState<UseScopedZonaIdsResult>(() => {
    if (noScope) return { scopedZonaIds: null, loading: false, error: null };
    if (!empresas || empresas.length === 0) {
      return { scopedZonaIds: new Set<number>(), loading: false, error: null };
    }
    return { scopedZonaIds: new Set<number>(), loading: true, error: null };
  });

  // Clave estable para evitar refetch por nueva referencia del array
  const empresasKey = empresas ? empresas.join(',') : '';
  const escenariosKey = escenarioIds.join(',');

  useEffect(() => {
    if (noScope) {
      setState({ scopedZonaIds: null, loading: false, error: null });
      return;
    }
    if (!empresas || empresas.length === 0) {
      setState({ scopedZonaIds: new Set<number>(), loading: false, error: null });
      return;
    }
    if (escenarioIds.length === 0) {
      // Sin escenarios todavía: mantener vacío y loading hasta que aparezcan
      setState({ scopedZonaIds: new Set<number>(), loading: true, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = new URLSearchParams();
    for (const id of empresas) params.append('empresa_fletera_id', String(id));
    for (const id of escenarioIds) params.append('escenario_id', String(id));
    // Solo considerar zonas de servicio URGENTE — las NOCTURNAS quedan excluidas del scope.
    params.append('tipo_de_servicio', 'URGENTE');

    fetch(`/api/fleteras-zonas?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res?.success || !Array.isArray(res.data)) {
          setState({ scopedZonaIds: new Set<number>(), loading: false, error: 'Respuesta inválida' });
          return;
        }
        const set = new Set<number>();
        for (const row of res.data) {
          const zonas = parseZonasJsonb(row?.zonas);
          for (const z of zonas) set.add(z);
        }
        setState({ scopedZonaIds: set, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          scopedZonaIds: new Set<number>(),
          loading: false,
          error: err instanceof Error ? err.message : 'Error al cargar zonas permitidas',
        });
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noScope, empresasKey, escenariosKey]);

  return state;
}
