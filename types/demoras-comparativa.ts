/** Tipos de GET /api/demoras/comparativa. */
export type TipoDemora = 'URGENTE' | 'NOCTURNO' | 'SERVICE';
export const TIPOS_DEMORA: TipoDemora[] = ['URGENTE', 'NOCTURNO', 'SERVICE'];

/** Valor de `demoras_calculadas.clampeado` (NULL si el crudo no tocó ningún borde). */
export type ClampeadoDemora = 'MIN' | 'MAX';

/** Valor de `demoras_calculadas.ritmo_origen`. */
export type RitmoOrigen = 'CHOFER' | 'MOVIL' | 'ZONA' | 'GLOBAL' | 'DEFECTO';

export interface PuntoComparativa {
  corrida_at: string;
  /** Fix round 1: sin esto, la serie sin filtro de zona mezcla puntos de
   * TODAS las zonas ordenados solo por hora — un gráfico en zigzag. */
  zona_id: number;
  calculada: number;
  /** null cuando el AS400 no informa ese tipo (solo informa URGENTE). */
  as400: number | null;
  /**
   * B2 — `capacidad_efectiva <= 0`: no había NINGÚN móvil activo en la zona
   * y la fila informó el techo (`max_minutos`, hoy 120) por definición, no
   * por cálculo. A las 07:00 el 72% de la flota todavía está inactiva, así
   * que el arranque del día está lleno de estos puntos: sin marcarlos, la
   * serie parece "el motor dice 120" cuando en realidad dice "no hay nadie".
   */
  sin_capacidad: boolean;
  /** Qué borde tocó el clamp; null si el crudo cayó adentro del rango. */
  clampeado: ClampeadoDemora | null;
  /** De qué nivel de la cascada salió el ritmo (DEFECTO = no hubo estadística). */
  ritmo_origen: RitmoOrigen | null;
}

export interface ZonaBrecha {
  zona_id: number;
  zona_nombre: string;
  /**
   * Promedio del día EXCLUYENDO las corridas con `sin_capacidad = true`
   * (B2): esas filas informan el techo por falta de móviles activos, no por
   * el modelo, y promediarlas contamina la calibración. null si TODAS las
   * corridas de la zona fueron sin capacidad (no queda ninguna muestra).
   */
  prom_calculada: number | null;
  prom_as400: number | null;
  /** calculada − as400. null si no hay contraparte o no quedó ninguna muestra. */
  brecha: number | null;
  /** Corridas que entraron al promedio (con capacidad). */
  muestras: number;
  /** Corridas descartadas del promedio por `sin_capacidad = true`. */
  excluidas_sin_capacidad: number;
}

export interface ComparativaData {
  serie: PuntoComparativa[];
  zonas: ZonaBrecha[];
  /** Total de filas del día descartadas del promedio de brecha (suma de zonas). */
  excluidas_sin_capacidad: number;
  /** Total de filas leídas del día (con y sin capacidad). */
  total_filas: number;
  /**
   * B3 — false cuando el escenario elegido no tiene NINGUNA fila en
   * `demoras_config`. El motor solo está configurado (y solo calcula) para
   * el escenario 1000; en cualquier otro la card queda vacía para siempre.
   * Sin este flag la UI explicaba esa condición permanente con "todavía no
   * hay corridas del motor para hoy", que es falso.
   */
  escenario_configurado: boolean;
}
