/**
 * Sala de control del día en vivo (RPC metricas_evolucion_dia): una fila
 * por corrida del motor con la foto del momento y el acumulado del día.
 * Ver docs/sqls/2026-08-05-evolucion-dia.sql.
 */

export interface EvolucionCorrida {
  corrida_at: string;
  /** Filas (zona × tipo) publicadas en esa corrida. */
  zonas: number;
  prom_motor: number | null;
  prom_despacho: number | null;
  /** Zonas en cada fase del arranque predictivo en ESA corrida. */
  f_predictivo: number;
  f_gracia: number;
  f_transito: number;
  sin_movil: number;
  /** Acumulado del día HASTA esa corrida (entregas en vivo). */
  entregados: number;
  comun: number;
  d_le25: number | null;
  m_le25: number | null;
}

export interface EvolucionResumen {
  entregados: number;
  comun: number;
  d_le25: number | null;
  m_le25: number | null;
  d_p80: number | null;
  m_p80: number | null;
}

export interface EvolucionDiaData {
  fecha: string | null;
  corridas: EvolucionCorrida[];
  resumen: EvolucionResumen | null;
}
