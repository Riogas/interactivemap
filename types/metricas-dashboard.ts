/**
 * Tipos del payload de GET /api/metricas/dashboard (RPC metricas_dashboard).
 * Ver docs/sqls/2026-07-24-metricas-dashboard-rpc.sql para el contrato SQL.
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

export interface MetricasDashboardData {
  rango: RangoDisponible | null;
  periodo_sel: PeriodoSel;
  kpis: KpisDashboard;
  kpis_prev: KpisDashboard;
  serie: SeriePunto[];
  por_tipo: PorTipoRow[];
  ranking: RankingRow[];
}
