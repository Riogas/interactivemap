/**
 * Lógica pura de components/metricas/ZonaCorridaCard.tsx — mismo patrón
 * que evolucion-dia-logic.ts (vitest environment: 'node').
 */

import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { ZonaCorridaFila } from '@/types/metricas-evolucion';

export type ZonaCorridaFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

/** Mismo contrato fail-closed que el resto de las cards de la pantalla. */
export function buildZonaCorridaFetch(params: {
  escenario: number | null;
  tipo: TipoDesfasaje | null;
  /** ISO de la corrida elegida; null = la última del día (modo en vivo). */
  corrida: string | null;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}): ZonaCorridaFetchIntent {
  const { escenario, tipo, corrida, empresaSel, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot && empresasIds.length === 0) return { skip: true };

  const sp = new URLSearchParams({ escenario: String(escenario) });
  if (tipo != null) sp.set('tipo', tipo);
  if (corrida != null) sp.set('corrida', corrida);
  if (empresaSel != null) sp.set('empresa', String(empresaSel));

  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    headers['x-track-empresas-ids'] = empresasIds.join(',');
  }

  return { skip: false, url: `/api/metricas/zona-corrida?${sp.toString()}`, headers };
}

export type OrdenZonas = 'brecha' | 'acierto_motor' | 'zona';

/**
 * Ordena la foto por el criterio elegido. `brecha` = |motor − Despacho|
 * descendente (dónde más difieren AHORA); `acierto_motor` = peor % del
 * motor HOY primero (dónde más está errando, el pedido literal del audio);
 * `zona` = numérico. Las filas sin dato del criterio van al final.
 */
export function ordenarZonas(zonas: ZonaCorridaFila[], orden: OrdenZonas): ZonaCorridaFila[] {
  const copia = [...zonas];
  if (orden === 'zona') return copia.sort((a, b) => a.zona_id - b.zona_id);
  if (orden === 'acierto_motor') {
    return copia.sort((a, b) => {
      const av = a.comun && a.comun > 0 ? a.m_le25 ?? 2 : 2;
      const bv = b.comun && b.comun > 0 ? b.m_le25 ?? 2 : 2;
      return av - bv || (b.comun ?? 0) - (a.comun ?? 0);
    });
  }
  return copia.sort((a, b) => Math.abs(b.brecha ?? 0) - Math.abs(a.brecha ?? 0));
}

/** Filtro rápido por número de zona ("45" matchea 45, 450, 451…). */
export function filtrarZonas(zonas: ZonaCorridaFila[], texto: string): ZonaCorridaFila[] {
  const t = texto.trim();
  if (t === '') return zonas;
  return zonas.filter((z) => String(z.zona_id).startsWith(t));
}

export const FASE_LABEL: Record<string, string> = {
  PREDICTIVO: 'Esperando 1er móvil',
  GRACIA_VENCIDA: 'Gracia vencida',
  TRANSITO: 'Con tránsito',
};
