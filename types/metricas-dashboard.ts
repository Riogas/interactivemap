/**
 * Tipos del payload de GET /api/metricas/dashboard (RPC metricas_dashboard).
 * Ver docs/sqls/2026-07-28-metricas-escenario-primero.sql para el contrato SQL.
 *
 * El ESCENARIO es la clave principal de todo el modelo: un mismo chofer,
 * móvil o zona puede repetirse en escenarios distintos y NO debe sumarse.
 * Por eso `escenario` es requerido en la request y viaja de vuelta en
 * `escenario_sel`, junto con la lista de escenarios disponibles y la
 * comparativa entre ellos.
 */

export type Ventana = 'diario' | 'semanal' | 'mensual';
export type Dimension = 'chofer' | 'movil' | 'zona';
export type TipoServicioDashboard = 'URGENTE' | 'NOCTURNO' | 'ESPECIAL' | 'OTROS' | 'SERVICE';

export const TIPOS_SERVICIO: TipoServicioDashboard[] = ['URGENTE', 'NOCTURNO', 'ESPECIAL', 'OTROS', 'SERVICE'];

export interface RangoDisponible {
  min_fecha: string; // YYYY-MM-DD
  max_fecha: string; // YYYY-MM-DD
}

export interface PeriodoSel {
  desde: string | null;
  hasta: string | null;
}

export interface KpisDashboard {
  cantidad: number;
  promedio: number | null;
  mediana: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
  promedio_atraso: number | null;
  on_time_pct: number | null;
}

export interface SeriePunto {
  periodo: string; // YYYY-MM-DD (día/semana/mes truncado)
  promedio: number | null;
  p90: number | null;
  cantidad: number;
}

export interface PorTipoRow {
  tipo_servicio: TipoServicioDashboard;
  promedio: number | null;
  cantidad: number;
}

export interface RankingRow {
  valor: string;
  promedio: number | null;
  mediana: number | null;
  p90: number | null;
  cantidad: number;
  atraso: number | null;
}

/** Un escenario con datos, dentro del scope de empresa del caller. */
export interface EscenarioOption {
  escenario: number;
  nombre: string;
  min_fecha: string; // YYYY-MM-DD
  max_fecha: string; // YYYY-MM-DD
  cantidad: number;
}

/** Fila de la comparativa cross-escenario (mismo período/tipos/empresas). */
export interface ComparativaEscenarioRow {
  escenario: number;
  nombre: string;
  promedio: number | null;
  mediana: number | null;
  p90: number | null;
  cantidad: number;
  promedio_atraso: number | null;
  on_time_pct: number | null;
}

export interface MetricasDashboardData {
  /** Eco del escenario efectivamente consultado. */
  escenario_sel: number;
  /** Escenarios con datos en el scope del caller (pobla el selector). */
  escenarios: EscenarioOption[];
  rango: RangoDisponible | null;
  periodo_sel: PeriodoSel;
  kpis: KpisDashboard;
  kpis_prev: KpisDashboard;
  serie: SeriePunto[];
  por_tipo: PorTipoRow[];
  ranking: RankingRow[];
  /** Todos los escenarios comparados sobre el período elegido. */
  comparativa: ComparativaEscenarioRow[];
}
