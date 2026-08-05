/**
 * Lógica pura de components/metricas/DesfasajeCard.tsx, extraída para
 * testearse sin render (vitest environment: 'node') — mismo patrón que
 * demora-comparativa-logic.ts.
 */

import type {
  DesfasajeData,
  FranjaDesfasaje,
  FuenteDesfasaje,
  KpisPoblacion,
  TipoDesfasaje,
} from '@/types/metricas-desfasaje';

export const FUENTE_LABEL: Record<FuenteDesfasaje, string> = {
  informada: 'Despacho',
  calculada: 'Calculada (motor)',
  comparar: 'Comparar (población común)',
};

// ─── "¿Cómo se mide?" — el acierto en lenguaje llano ────────────────────────
// Pedido del usuario (2026-08-04): que cualquiera entienda qué considera
// esta medición, sin conocer las tablas. Misma forma que EXPLICACION_MOTOR
// (demora-comparativa-logic.ts).

export interface SeccionExplicacionAcierto { titulo: string; texto: string }

export const EXPLICACION_ACIERTO: SeccionExplicacionAcierto[] = [
  {
    titulo: 'Qué se mide',
    texto:
      'Para cada pedido urgente o nocturno ENTREGADO se compara la demora que se le prometió en el momento en que lo tomamos ' +
      'contra lo que realmente tardó en llegar. La diferencia (con signo: negativo = llegó antes de lo prometido, positivo = llegó después) ' +
      'es el desfasaje, y se agrupa en franjas de 5 minutos.',
  },
  {
    titulo: 'El número que importa',
    texto:
      'El KPI es el porcentaje de pedidos con desfasaje de 25 minutos o menos — llegaron "en tiempo y forma" respecto de la promesa. ' +
      'Los agendados para más tarde y los cancelados no entran: solo pedidos que se pidieron para ya y se entregaron.',
  },
  {
    titulo: 'Las dos promesas que se comparan',
    texto:
      'La naranja es la demora que la operativa cargó en el Despacho (AS400) y viajó congelada en el pedido. ' +
      'La azul es la que calculó el motor en la corrida de ese momento. "Comparar" usa la población común: ' +
      'solo pedidos que tienen las DOS promesas, para que la comparación sea justa (mismos pedidos, misma vara).',
  },
  {
    titulo: 'De dónde salen los datos',
    texto:
      'La entrega real sale del cierre del pedido; la promesa del Despacho, de la fecha comprometida que quedó grabada en el pedido; ' +
      'y la del motor, de la corrida vigente cuando el pedido se tomó (el motor recalcula cada 10 minutos). Nada se estima a mano.',
  },
];

export const DIAS_OPCIONES = [7, 30, 90] as const;

/**
 * Intención de fetch a /api/metricas/desfasaje. skip=true cuando no hay
 * escenario o un no-root no tiene empresas (fail-closed conocido de
 * antemano, ni se toca la red) — mismo contrato que buildComparativaFetch.
 */
export type DesfasajeFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

export function buildDesfasajeFetch(params: {
  escenario: number | null;
  tipo: TipoDesfasaje | null;
  dias: number;
  /**
   * Empresa elegida en la FiltersBar de la página (fix Important del
   * review: sin esto, todas las cards de arriba filtraban por empresa y
   * esta seguía agregando TODO el scope — el usuario leía el KPI como si
   * fuera de su fletera). El endpoint la INTERSECTA con el scope.
   */
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}): DesfasajeFetchIntent {
  const { escenario, tipo, dias, empresaSel, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot && empresasIds.length === 0) return { skip: true };

  const sp = new URLSearchParams({ escenario: String(escenario), dias: String(dias) });
  if (tipo != null) sp.set('tipo', tipo);
  if (empresaSel != null) sp.set('empresa', String(empresaSel));

  // x-track-funcs SIEMPRE (root también, aunque bypasee): el endpoint corre
  // requireFuncionalidad('Estadisticas Cumplimiento') antes que el scope.
  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    // Scope por header (patrón metricas/dashboard, no query param).
    headers['x-track-empresas-ids'] = empresasIds.join(',');
  }

  return { skip: false, url: `/api/metricas/desfasaje?${sp.toString()}`, headers };
}

/** Fila del BarChart: pct en 0..100 (Recharts grafica el número directo). */
export interface FilaFranjaGrafico {
  label: string;
  /** Serie principal según la fuente (informada, calculada, o común-informada). */
  principal: number | null;
  principal_n: number;
  /** Solo en 'comparar': común-calculada. */
  secundaria: number | null;
  secundaria_n: number;
}

function pct100(x: number | null): number | null {
  return x == null ? null : Math.round(x * 1000) / 10;
}

/**
 * Filas del gráfico para la fuente elegida. En 'comparar' las DOS series
 * salen de la población común (mismos pedidos): comparar la distribución
 * completa de una contra la común de la otra sería mezclar poblaciones.
 */
export function filasGrafico(franjas: FranjaDesfasaje[], fuente: FuenteDesfasaje): FilaFranjaGrafico[] {
  return franjas.map((f) => {
    if (fuente === 'informada') {
      return { label: f.label, principal: pct100(f.informada_pct), principal_n: f.informada_n, secundaria: null, secundaria_n: 0 };
    }
    if (fuente === 'calculada') {
      return { label: f.label, principal: pct100(f.calculada_pct), principal_n: f.calculada_n, secundaria: null, secundaria_n: 0 };
    }
    return {
      label: f.label,
      principal: pct100(f.comun_informada_pct),
      principal_n: f.comun_informada_n,
      secundaria: pct100(f.comun_calculada_pct),
      secundaria_n: f.comun_calculada_n,
    };
  });
}

/** KPIs a mostrar según la fuente. En 'comparar' vienen los dos juegos. */
export interface KpisVista {
  principal: KpisPoblacion;
  /** Solo en 'comparar' (los KPIs de la calculada sobre la población común). */
  secundaria: KpisPoblacion | null;
}

export function kpisDeFuente(data: DesfasajeData, fuente: FuenteDesfasaje): KpisVista | null {
  if (data.kpis == null) return null;
  if (fuente === 'informada') return { principal: data.kpis.informada, secundaria: null };
  if (fuente === 'calculada') return { principal: data.kpis.calculada, secundaria: null };
  const n = data.kpis.comun.n;
  return {
    principal: { n, ...data.kpis.comun.informada },
    secundaria: { n, ...data.kpis.comun.calculada },
  };
}

/**
 * ¿La franja pertenece a la zona del KPI ("% con desfasaje ≤ 25")? La card
 * pinta esas a color pleno y atenúa el resto. Extraída del TSX (review):
 * la frontera del 25 y el guard de '90+' (Number('90+') es NaN) merecen
 * test propio.
 */
export function esFranjaKpi(label: string): boolean {
  const tope = Number(label);
  return Number.isFinite(tope) && tope <= 25;
}

/**
 * Mensaje del estado vacío, separando el caso general del específico del
 * motor (que recién junta datos desde que arrancó, 2026-07-29).
 * `data === null` NO es "sin datos": es "todavía no se consultó" y la card
 * muestra skeleton, no este mensaje (fix del flash falso del review).
 */
export function mensajeVacioDesfasaje(fuente: FuenteDesfasaje, data: DesfasajeData | null): string | null {
  if (data === null) return null;
  const kpis = data.kpis;
  if (kpis == null) return 'Todavía no hay pedidos con desfasaje para este filtro.';
  if (fuente === 'informada' && kpis.informada.n === 0) {
    return 'Todavía no hay pedidos con desfasaje para este filtro.';
  }
  if (fuente === 'calculada' && kpis.calculada.n === 0) {
    return 'El motor todavía no tiene pedidos medidos en este rango (calcula desde el 29/07): probá un rango más corto o esperá a que junte días.';
  }
  if (fuente === 'comparar' && kpis.comun.n === 0) {
    return 'Todavía no hay pedidos con las DOS proyecciones a la vez (el motor calcula desde el 29/07): la población común crece día a día.';
  }
  return null;
}
