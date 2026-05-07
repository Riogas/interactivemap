import { useEffect, useState } from 'react';
import { getScopedEmpresas, isPrivilegedForZonaScope, parseZonasJsonb } from '@/lib/auth-scope';

interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string }>;
  allowedEmpresas?: number[] | null;
}

interface UseScopedZonaIdsResult {
  /** null = sin scope (privilegiado), Set = zonas permitidas (vacío = fail-closed). */
  scopedZonaIds: Set<number> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Calcula el set de zona_id permitido para el usuario actual basado en
 * fleteras_zonas filtrado por empresa.
 *
 * Para roles privilegiados (root/despacho/dashboard/supervisor):
 *   - { scopedZonaIds: null } (sin restricción), selectedEmpresas se ignora.
 *
 * Para roles no privilegiados:
 *   - Si allowedEmpresas vacío/null → { scopedZonaIds: new Set() } fail-closed.
 *   - Si selectedEmpresas tiene elementos → fetch a /api/fleteras-zonas usando
 *     la intersección de selectedEmpresas con allowedEmpresas como filtro de empresa.
 *     Esto permite que el selector de empresas del header restrinja las zonas visibles.
 *   - Si selectedEmpresas está vacío → { scopedZonaIds: new Set() } fail-closed.
 */
export function useScopedZonaIds(
  user: ScopedUser | null | undefined,
  escenarioIds: number[],
  selectedEmpresas: number[] = [],
): UseScopedZonaIdsResult {
  const isPrivileged = isPrivilegedForZonaScope(user);
  // Para privilegiados: sin scope, sin fetch.
  // Para no privilegiados: empresas efectivas = selectedEmpresas ∩ allowedEmpresas.
  // Si selectedEmpresas está vacío (deselección total) → fail-closed (set vacío).
  const allowedEmpresas = isPrivileged ? null : getScopedEmpresas(user);

  // Empresas efectivas para el fetch: intersección de lo seleccionado con lo permitido.
  // Solo aplica para no privilegiados.
  const effectiveEmpresas = (() => {
    if (isPrivileged) return null;
    if (!allowedEmpresas || allowedEmpresas.length === 0) return [];
    if (selectedEmpresas.length === 0) return [];
    // Filtrar selectedEmpresas a solo las que están en allowedEmpresas
    return selectedEmpresas.filter((id) => allowedEmpresas.includes(id));
  })();

  const [state, setState] = useState<UseScopedZonaIdsResult>(() => {
    if (isPrivileged) return { scopedZonaIds: null, loading: false, error: null };
    if (!effectiveEmpresas || effectiveEmpresas.length === 0) {
      return { scopedZonaIds: new Set<number>(), loading: false, error: null };
    }
    return { scopedZonaIds: new Set<number>(), loading: true, error: null };
  });

  // Claves estables para evitar refetch por nueva referencia del array
  const effectiveEmpresasKey = effectiveEmpresas ? effectiveEmpresas.join(',') : '';
  const escenariosKey = escenarioIds.join(',');

  useEffect(() => {
    if (isPrivileged) {
      setState({ scopedZonaIds: null, loading: false, error: null });
      return;
    }
    if (!effectiveEmpresas || effectiveEmpresas.length === 0) {
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
    for (const id of effectiveEmpresas) params.append('empresa_fletera_id', String(id));
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
  }, [isPrivileged, effectiveEmpresasKey, escenariosKey]);

  return state;
}
