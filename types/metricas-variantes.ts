/**
 * Tipos del Laboratorio de variantes (champion-challenger del motor de
 * demora). Espejo del payload de la RPC `metricas_variantes_scoreboard`
 * (docs/sqls/2026-08-07-variantes-scoreboard.sql).
 */

/** Las perillas que una variante cambia; null = como el modelo vigente. */
export interface VarianteKnobs {
  estadistico: 'MEDIA' | 'MEDIANA' | 'P75' | 'P90' | null;
  nivel_ritmo: 'CASCADA' | 'ZONA' | null;
  factor: number | null;
  escalon_minutos: number | null;
  suavizado: boolean;
  suavizado_paso: number | null;
  min_minutos: number | null;
}

export interface VarianteDia {
  fecha: string;
  n: number;
  le_tol: number | null;
  despacho_le_tol: number | null;
  /** null = el día no llegó al mínimo de pedidos para contar. */
  gana: boolean | null;
}

export interface VarianteScore {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  activa: boolean;
  knobs: VarianteKnobs;
  n: number;
  le_tol: number | null;
  sesgo: number | null;
  dias_ganados: number;
  dias_total: number;
  dias: VarianteDia[];
}

export interface MotorDia {
  fecha: string;
  n: number;
  le_tol: number | null;
}

export interface LadoScore {
  n: number;
  le_tol: number | null;
  sesgo: number | null;
}

export interface MotorScore extends LadoScore {
  dias: MotorDia[];
}

export interface CampeonOk {
  corridas: number;
  coincidencias: number;
  pct: number | null;
}

/**
 * Cuánto tardó el laboratorio en espejar cada corrida. Las variantes que
 * re-simulan el ritmo necesitan el estado del mundo del momento, así que
 * un desfase de segundos es fiel y uno de horas sería una reconstrucción
 * inventada (el backfill directamente no la permite).
 */
export interface DesfaseLab {
  mediana_seg: number | null;
  max_seg: number | null;
}

export interface VariantesScoreboardData {
  desde: string | null;
  hasta: string | null;
  tolerancia: number | null;
  min_n_dia: number | null;
  /** Primer día con datos del laboratorio (arrancó el 7/8/2026). */
  desde_datos: string | null;
  campeon_ok: CampeonOk | null;
  desfase: DesfaseLab | null;
  despacho: LadoScore | null;
  motor: MotorScore | null;
  variantes: VarianteScore[];
}

export const LAB_JOB_ESTADOS = ['PENDIENTE', 'CORRIENDO', 'LISTO', 'ERROR'] as const;
export type LabJobEstado = (typeof LAB_JOB_ESTADOS)[number];

/**
 * Un reproceso encolado en `demoras_lab_jobs`: recalcular lo que cada
 * variante hubiera publicado sobre un rango de días ya capturado. Lo
 * ejecuta el worker de pg_cron (cada minuto, de a uno), así que la
 * pantalla solo encola y mira el estado.
 */
export interface LabJob {
  id: number;
  escenario: number;
  desde: string;
  hasta: string;
  /** null = todas las variantes activas. */
  variantes: number[] | null;
  estado: LabJobEstado;
  corridas: number | null;
  filas: number | null;
  error: string | null;
  pedido_por: string | null;
  creado_at: string;
  iniciado_at: string | null;
  terminado_at: string | null;
  /**
   * Cuánto lleva/llevó corriendo, medido con el reloj de la base (la fila
   * recién creada todavía no lo trae, de ahí el opcional).
   */
  duracion_seg?: number | null;
}

export interface LabJobsData {
  escenario: number | null;
  jobs: LabJob[];
}
