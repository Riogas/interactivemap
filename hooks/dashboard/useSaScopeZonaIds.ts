import { useEffect, useMemo, useState } from 'react';
import { getScopedEmpresas, canSeeAllEmpresas, parseZonasJsonb } from '@/lib/auth-scope';
import { determineServicePeriod } from '@/lib/horario-servicio';

interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string; funcionalidades?: Array<{ funcionalidadId: number; nombre: string }> }>;
  allowedEmpresas?: number[] | null;
  verTodasEmpresas?: boolean;
}

export interface UseSaScopeZonaIdsResult {
  /**
   * Zonas en las que se muestran los pedidos/services SIN ASIGNAR.
   *   - null  → sin filtro de zona (despacho con atributo EFL TODAS (*) Y todas
   *             las EFL seleccionadas): se ven TODOS los SA dentro de ventana.
   *   - Set   → solo SA cuya zona_nro esté en este set (zonas que trabajan las
   *             EFL seleccionadas según el período actual URGENTE/NOCTURNO).
   *             Set vacío = no mostrar ningún SA (fail-closed).
   */
  saScopeZonaIds: Set<number> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Calcula el scope de zonas para los pedidos/services SIN ASIGNAR de la barra
 * lateral, tabla extendida, mapa e indicadores.
 *
 * Regla (spec 2026-06-17):
 *   - Usuario con atributo "EFleteras TODAS (*)" (canSeeAllEmpresas) Y con TODAS
 *     las EFL seleccionadas  → null (sin filtro: ve todos los SA, incluso en
 *     zonas que ninguna EFL trabaja).
 *   - Cualquier otro caso (atributo limitado, o despacho que deseleccionó algunas
 *     EFL) → Set de zonas que trabajan las EFL SELECCIONADAS
 *     (selectedEmpresas ∩ allowedEmpresas) según fleteras_zonas, filtrando por
 *     tipo_de_servicio = período actual (URGENTE diurno / NOCTURNO nocturno).
 *
 * El período se recalcula dinámicamente con serverNow (cruce 20:30/06:00).
 *
 * @param user              Usuario con allowedEmpresas / verTodasEmpresas / roles.
 * @param escenarioIds      Escenarios activos (para fleteras_zonas.escenario_id).
 * @param selectedEmpresas  EFL seleccionadas en el header.
 * @param serverNow         Hora del servidor (define el período diurno/nocturno).
 * @param aplicaNocturno    Si el escenario tiene capa nocturna activa.
 */
export function useSaScopeZonaIds(
  user: ScopedUser | null | undefined,
  escenarioIds: number[],
  selectedEmpresas: number[],
  serverNow: Date,
  aplicaNocturno: boolean,
): UseSaScopeZonaIdsResult {
  const seeAll = canSeeAllEmpresas(user);
  const allowedEmpresas = seeAll ? null : getScopedEmpresas(user);

  // Período actual (URGENTE/NOCTURNO) → define tipo_de_servicio en fleteras_zonas.
  const periodo = useMemo(
    () => determineServicePeriod(serverNow, aplicaNocturno),
    [serverNow, aplicaNocturno],
  );

  // Empresas efectivas para el fetch: selectedEmpresas ∩ allowedEmpresas.
  // - Si ve todas (seeAll): el filtro es solo selectedEmpresas (no hay allowed).
  // - Si no ve todas: intersección con allowedEmpresas.
  // El caso "ve todas + todas seleccionadas → null" lo resuelve el CALLER
  // (page.tsx), que conoce el universo total de empresas. Este hook siempre
  // computa el Set de zonas de las EFL efectivas.
  const effectiveEmpresas = useMemo(() => {
    if (selectedEmpresas.length === 0) return [];
    if (seeAll) return selectedEmpresas;
    if (!allowedEmpresas || allowedEmpresas.length === 0) return [];
    return selectedEmpresas.filter((id) => allowedEmpresas.includes(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresas.join(','), seeAll, (allowedEmpresas ?? []).join(',')]);

  const [state, setState] = useState<UseSaScopeZonaIdsResult>({
    saScopeZonaIds: new Set<number>(),
    loading: false,
    error: null,
  });

  const effectiveEmpresasKey = effectiveEmpresas.join(',');
  const escenariosKey = escenarioIds.join(',');

  useEffect(() => {
    let cancelled = false;

    if (effectiveEmpresas.length === 0 || escenarioIds.length === 0) {
      // Sin EFL seleccionadas o sin escenarios → fail-closed (no SA).
      setState({ saScopeZonaIds: new Set<number>(), loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = new URLSearchParams();
    for (const id of effectiveEmpresas) params.append('empresa_fletera_id', String(id));
    for (const id of escenarioIds) params.append('escenario_id', String(id));
    params.append('tipo_de_servicio', periodo); // URGENTE | NOCTURNO según horario

    fetch(`/api/fleteras-zonas?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res?.success || !Array.isArray(res.data)) {
          setState({ saScopeZonaIds: new Set<number>(), loading: false, error: 'Respuesta inválida' });
          return;
        }
        const set = new Set<number>();
        for (const row of res.data) {
          for (const z of parseZonasJsonb(row?.zonas)) set.add(z);
        }
        setState({ saScopeZonaIds: set, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          saScopeZonaIds: new Set<number>(),
          loading: false,
          error: err instanceof Error ? err.message : 'Error al cargar zonas SA',
        });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveEmpresasKey, escenariosKey, periodo]);

  return state;
}
