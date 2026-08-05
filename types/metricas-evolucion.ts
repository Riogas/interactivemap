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

// ─── Radiografía por zona de una corrida (RPC metricas_zona_corrida) ────────
// El pedido de Diego (audio 12): por zona, HOY — Despacho, motor, brecha y
// % de acierto del día, con combo para elegir cualquier corrida.

export interface ZonaCorridaFila {
  zona_id: number;
  tipo_servicio: string;
  motor: number;
  despacho: number | null;
  /** motor − despacho (null cuando el Despacho no informa esa zona). */
  brecha: number | null;
  arranque_fase: 'PREDICTIVO' | 'GRACIA_VENCIDA' | 'TRANSITO' | null;
  sin_capacidad: boolean;
  cola_por_delante: number | null;
  ritmo_usado: number | null;
  moviles_prioridad: number | null;
  moviles_transito: number | null;
  /** Acierto del día POR ZONA, en vivo (null/0 si aún no entregó nada). */
  entregados: number | null;
  comun: number | null;
  d_le25: number | null;
  m_le25: number | null;
}

export interface ZonaCorridaData {
  fecha: string | null;
  /** La corrida cuya foto se muestra (ISO). */
  corrida: string | null;
  /** Todas las corridas del día, para el combo del horario. */
  corridas: string[];
  zonas: ZonaCorridaFila[];
}
