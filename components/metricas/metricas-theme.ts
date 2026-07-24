/**
 * Colores, labels y textos "i" (E3) del dashboard de métricas de cumplimiento.
 * Los colores SIEMPRE viajan como `var(--color-metricas-*)` (tokens definidos
 * en app/globals.css, con override dark) — nunca hex literal en los componentes.
 */

import type { PorTipoRow, TipoServicioDashboard, Dimension } from '@/types/metricas-dashboard';
import { TIPOS_SERVICIO } from '@/types/metricas-dashboard';

export const SERIE_COLOR = 'var(--color-metricas-serie)';

export const DIMENSION_LABEL: Record<Dimension, { singular: string; singularCap: string; plural: string }> = {
  chofer: { singular: 'chofer', singularCap: 'Chofer', plural: 'choferes' },
  movil: { singular: 'móvil', singularCap: 'Móvil', plural: 'móviles' },
  zona: { singular: 'zona', singularCap: 'Zona', plural: 'zonas' },
};

export const COLOR_TIPO: Record<TipoServicioDashboard, string> = {
  URGENTE: 'var(--color-metricas-urgente)',
  NOCTURNO: 'var(--color-metricas-nocturno)',
  ESPECIAL: 'var(--color-metricas-especial)',
  OTROS: 'var(--color-metricas-otros)',
  SERVICE: 'var(--color-metricas-service)',
};

export const TIPO_LABEL: Record<TipoServicioDashboard, string> = {
  URGENTE: 'Urgente',
  NOCTURNO: 'Nocturno',
  ESPECIAL: 'Especial',
  OTROS: 'Otros',
  SERVICE: 'Service',
};

/** Formatea minutos como el mockup: null -> '—'; >=1000 con separador de miles; si no, 1 decimal. */
export function formatMin(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('es-UY');
  return (Math.round(n * 10) / 10).toString();
}

/** Formatea una cantidad entera con separador de miles es-UY. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('es-UY');
}

/** Formatea un porcentaje 0..1 -> "72%". null -> '—'. */
export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(n * 1000) / 10}%`;
}

/**
 * Reordena/completa `por_tipo` según el orden canónico de los 5 tipos
 * (URGENTE, NOCTURNO, ESPECIAL, OTROS, SERVICE), rellenando con cantidad=0
 * los tipos sin cumplidos en el período (para que las 5 barras sean siempre
 * comparables entre períodos, en vez de aparecer/desaparecer).
 */
export function orderPorTipo(rows: PorTipoRow[]): PorTipoRow[] {
  const byTipo = new Map(rows.map((r) => [r.tipo_servicio, r]));
  return TIPOS_SERVICIO.map(
    (t) => byTipo.get(t) ?? { tipo_servicio: t, promedio: null, cantidad: 0 },
  );
}

export interface InfoText {
  title: string;
  text: string;
}

/**
 * E3 — textos "i" redactados por card, en base a los cálculos reales
 * (ver docs/METRICAS_CUMPLIMIENTO.md y docs/sqls/2026-07-24-metricas-dashboard-rpc.sql).
 */
export const INFO_TEXTS = {
  kpi_promedio: {
    title: 'Demora efectiva promedio',
    text: 'Demora efectiva = hora de finalización − reloj de inicio. El reloj de inicio es la hora de asignación al móvil, salvo que el pedido esté agendado con más de 60 minutos de anticipación (ej. un nocturno "para las 13"): en ese caso el reloj arranca en la hora comprometida, para no penalizar la espera planificada. Se promedia sobre todos los cumplidos genuinos del período.',
  },
  kpi_mediana: {
    title: 'Mediana (p50)',
    text: 'Percentil 50 de la demora efectiva: la mitad de los cumplidos del período demoró menos que este valor y la otra mitad demoró más. Es menos sensible a valores extremos que el promedio — se calcula exacto (percentile_cont) directo sobre los hechos, nunca sobre promedios ya agregados.',
  },
  kpi_p90: {
    title: 'P90',
    text: 'Percentil 90 de la demora efectiva: el 90% de los cumplidos del período se resolvió en este tiempo o menos. Mide la "cola" de casos lentos — un buen indicador de consistencia del servicio más allá del promedio.',
  },
  kpi_cumplidos: {
    title: 'Cumplidos',
    text: 'Cantidad de pedidos/services cumplidos genuinamente en el período: estado = 2 (finalizado) y sub-estado = 3, sin cancelar. El delta compara contra la misma cantidad de días/semanas/meses inmediatamente anterior al período elegido.',
  },
  kpi_atraso: {
    title: 'Atraso vs. compromiso',
    text: 'Atraso vs. compromiso = hora de finalización − hora comprometida, CON signo: positivo = entregó después de lo comprometido; negativo = entregó antes. Se promedia solo sobre los pedidos que tienen hora comprometida registrada (los que no la tienen quedan fuera de este cálculo, no cuentan como 0). El porcentaje "a tiempo" es la proporción con atraso ≤ 0.',
  },
  tendencia: {
    title: 'Tendencia · demora efectiva',
    text: 'Evolución de la demora efectiva por período (día/semana/mes según la ventana elegida), mostrando los últimos períodos hasta el seleccionado. La línea sólida es el promedio; la línea punteada y la banda tenue son el percentil 90 (p90) — cuanto más separadas estén ambas curvas, más dispersos son los tiempos de cumplimiento dentro de cada período.',
  },
  por_tipo: {
    title: 'Por tipo de servicio',
    text: 'Demora efectiva promedio por tipo de servicio (Urgente, Nocturno, Especial, Otros, Service) en el período seleccionado. El número debajo de cada barra es la cantidad de cumplidos de ese tipo. Colores validados para daltonismo (CVD-safe).',
  },
  ranking: {
    title: 'Ranking',
    text: 'Ranking de la dimensión elegida (chofer, móvil o zona) por demora efectiva promedio, calculado sobre TODO el rango filtrado (no solo el período de la tendencia). "Más rápidos" = menor demora promedio; "más lentos" = mayor. Los registros sin chofer/móvil/zona atribuible se agrupan como "(sin ...)" — no se descartan.',
  },
  tabla: {
    title: 'Detalle',
    text: 'Detalle completo de la dimensión elegida: cantidad de cumplidos, promedio, mediana, p90 y atraso promedio (con signo). Ordenable por columna (click en el encabezado) y filtrable por nombre. Sirve como alternativa accesible a la codificación por color del ranking.',
  },
} as const satisfies Record<string, InfoText>;

export type InfoTextKey = keyof typeof INFO_TEXTS;
