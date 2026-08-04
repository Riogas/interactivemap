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
 * (ver docs/METRICAS_CUMPLIMIENTO.md y docs/sqls/2026-07-28-metricas-escenario-primero.sql).
 */
export const INFO_TEXTS = {
  escenario: {
    title: 'Escenario',
    text: 'El escenario es la clave principal de todas estas métricas. Un mismo chofer, móvil o zona puede operar en escenarios distintos, y sus tiempos NUNCA se suman entre ellos: todo lo que ves en esta pantalla (KPIs, tendencia, ranking, detalle) corresponde exclusivamente al escenario seleccionado. Solo se listan los escenarios que tienen cumplidos registrados dentro de tu alcance de empresa fletera.',
  },
  comparativa: {
    title: 'Comparativa entre escenarios',
    text: 'Los mismos filtros de período, tipo de servicio y empresa aplicados a TODOS los escenarios con datos, uno al lado del otro. Cada escenario se calcula por separado sobre los hechos (percentiles exactos), nunca promediando los promedios de otro agregado. El escenario que estás viendo aparece resaltado.',
  },
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
    text: 'Atraso vs. compromiso = hora de finalización − hora máxima de entrega comprometida (el SLA que viaja en el pedido), CON signo: positivo = entregó después de lo comprometido; negativo = entregó antes, que es lo esperable en la mayoría de los casos. Se promedia solo sobre los pedidos que traen compromiso registrado (los que no lo traen quedan fuera del cálculo, no cuentan como 0). El porcentaje "a tiempo" es la proporción con atraso ≤ 0. OJO: no confundir con el tiempo transcurrido desde el alta del pedido, que es otra cosa y queda guardado aparte en la tabla de hechos.',
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
  desfasaje: {
    title: 'Acierto de la demora',
    text: 'Por cada pedido URGENTE o NOCTURNO entregado (no agendado) se mide el desfasaje entre la demora proyectada al tomarlo y lo que tardó de verdad: tomado 10:00 con 60 minutos era para las 11:00 — entregado 11:05 o 10:55 son 5 minutos de desfasaje en ambos casos (se mira el valor absoluto). La distribución va en franjas de 5 minutos hasta 90 y después "90+"; el KPI operativo es el % de pedidos con desfasaje ≤ 25. Se calcula contra dos proyecciones: la que informó el Despacho/AS400 (congelada en el pedido al tomarlo) y la que calculaba el motor de TrackMovil en ese momento (existe desde el 29/07). El modo "Comparar" usa SOLO los pedidos que tienen ambas — misma población, única comparación justa de cuál demora acierta más. p80 = "el 80% de los pedidos cayó en ≤ X min".',
  },
  demora_comparativa: {
    title: 'Demora calculada vs. informada',
    text: 'Cada 10 minutos TrackMovil calcula, para cada zona activa, cuánto debería demorar un pedido según la demanda pendiente, los móviles realmente activos y el ritmo real de cumplimiento de la última semana. Esa línea se compara contra la que informa el Despacho (AS400). La nuestra es escalonada porque redondea a 15 minutos; la del Despacho usa escalones de 5. El Despacho solo informa URGENTE: para NOCTURNO y SERVICE se muestra únicamente nuestra línea. Haciendo click en una zona de la tabla se abre el porqué de su última corrida: pedidos por delante, móviles que aportan, cómo creció la capacidad por escalones y qué ritmo se usó. Este número NO se le informa a ningún cliente — es solo para validar el modelo.',
  },
} as const satisfies Record<string, InfoText>;

export type InfoTextKey = keyof typeof INFO_TEXTS;
