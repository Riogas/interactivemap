/**
 * Lógica pura de components/metricas/EvolucionDiaCard.tsx — mismo patrón
 * que desfasaje-analisis-logic.ts (vitest environment: 'node').
 */

import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { EvolucionCorrida } from '@/types/metricas-evolucion';

export type EvolucionFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

/** Mismo contrato fail-closed que el resto de las cards de la pantalla. */
export function buildEvolucionFetch(params: {
  escenario: number | null;
  tipo: TipoDesfasaje | null;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}): EvolucionFetchIntent {
  const { escenario, tipo, empresaSel, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot && empresasIds.length === 0) return { skip: true };

  const sp = new URLSearchParams({ escenario: String(escenario) });
  if (tipo != null) sp.set('tipo', tipo);
  if (empresaSel != null) sp.set('empresa', String(empresaSel));

  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    headers['x-track-empresas-ids'] = empresasIds.join(',');
  }

  return { skip: false, url: `/api/metricas/evolucion-dia?${sp.toString()}`, headers };
}

/**
 * ¿La ventana del arranque predictivo dejó rastro hoy? Si ninguna corrida
 * tuvo fases, el gráfico de fases no aporta y la card lo omite (a media
 * tarde sigue mostrando la mañana, que es cuando pasó todo).
 */
export function hayFases(corridas: EvolucionCorrida[]): boolean {
  return corridas.some((c) => c.f_predictivo > 0 || c.f_gracia > 0 || c.f_transito > 0);
}

/**
 * Serie para los gráficos: hora local + valores, en orden cronológico.
 * El % acumulado viaja en 0..100 (Recharts grafica el número directo).
 */
export interface PuntoEvolucion {
  hora: string;
  prom_motor: number | null;
  prom_despacho: number | null;
  f_predictivo: number;
  f_gracia: number;
  f_transito: number;
  d_le25: number | null;
  m_le25: number | null;
}

export function serieEvolucion(
  corridas: EvolucionCorrida[],
  horaDe: (iso: string) => string,
): PuntoEvolucion[] {
  return corridas.map((c) => ({
    hora: horaDe(c.corrida_at),
    prom_motor: c.prom_motor,
    prom_despacho: c.prom_despacho,
    f_predictivo: c.f_predictivo,
    f_gracia: c.f_gracia,
    f_transito: c.f_transito,
    d_le25: c.d_le25 == null ? null : Math.round(c.d_le25 * 1000) / 10,
    m_le25: c.m_le25 == null ? null : Math.round(c.m_le25 * 1000) / 10,
  }));
}
