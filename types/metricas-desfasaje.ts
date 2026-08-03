/**
 * Tipos de GET /api/metricas/desfasaje (RPC metricas_desfasaje).
 *
 * Desfasaje = |demora proyectada − demora real| por pedido entregado
 * (URGENTE/NOCTURNO no agendados), contra dos proyecciones:
 *   - informada : la del AS400 congelada en el pedido al tomarlo.
 *   - calculada : la del motor CONSUMO_TRAMOS vigente a la toma.
 * La población "común" (pedidos con AMBAS) es la única base justa para
 * comparar cuál proyección acierta más.
 */

export type TipoDesfasaje = 'URGENTE' | 'NOCTURNO';
export const TIPOS_DESFASAJE: TipoDesfasaje[] = ['URGENTE', 'NOCTURNO'];

/** Fuente elegida en la card (comparar = ambas sobre la población común). */
export type FuenteDesfasaje = 'informada' | 'calculada' | 'comparar';

export interface KpisPoblacion {
  n: number;
  /** Proporción 0..1 de pedidos con desfasaje ≤ 25 min (el KPI de la planilla). */
  pct_le_25: number | null;
  pct_le_90: number | null;
  /** p80 del desfasaje absoluto: "el 80% cae en ≤ X min". */
  p80: number | null;
}

export interface KpisComun {
  n: number;
  informada: Omit<KpisPoblacion, 'n'>;
  calculada: Omit<KpisPoblacion, 'n'>;
}

export interface FranjaDesfasaje {
  /** Tope del intervalo de 5 min: 5 = (0,5], ... 90 = (85,90], 95 = "90+". */
  tope: number;
  label: string;
  informada_n: number;
  informada_pct: number | null;
  calculada_n: number;
  calculada_pct: number | null;
  comun_informada_n: number;
  comun_informada_pct: number | null;
  comun_calculada_n: number;
  comun_calculada_pct: number | null;
}

export interface DesfasajeData {
  /** null cuando no hay ningún dato para el filtro (o fail-closed). */
  rango: { desde: string; hasta: string } | null;
  kpis: {
    informada: KpisPoblacion;
    calculada: KpisPoblacion;
    comun: KpisComun;
  } | null;
  franjas: FranjaDesfasaje[];
}
