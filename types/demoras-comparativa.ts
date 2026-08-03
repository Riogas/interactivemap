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

/**
 * Radiografía de la ÚLTIMA corrida del día de una zona: los números que
 * explican POR QUÉ se informó lo que se informó (modelo CONSUMO_TRAMOS,
 * ver docs/DEMORA_MODELO_TRAMOS.md). Todos los campos de auditoría admiten
 * null: las corridas anteriores a la migración TRAMOS (y las del modelo
 * CAPACIDAD_PROMEDIO) no los tienen — la UI omite lo que falte en vez de
 * inventar ceros.
 */
export interface UltimaCorridaZona {
  corrida_at: string;
  demora_informada: number;
  /** Resultado del modelo ANTES de clamp/redondeo/suavizado. */
  demora_cruda: number | null;
  as400: number | null;
  /**
   * Capacidad de la zona en pedidos por minuto (μ = dedicación / ritmo,
   * sumada sobre los móviles). `inicial` = al momento del cálculo; `final` =
   * la del último tramo que la simulación llegó a consumir — NO la máxima
   * teórica de la zona: si la cola se vació en el primer tramo, final ==
   * inicial aunque hubiera móviles por sumarse.
   */
  capacidad_inicial: number | null;
  capacidad_final: number | null;
  /** Escalones de capacidad que recorrió la simulación (1 = constante). */
  tramos: number | null;
  /** Pedidos del pool que están delante del hipotético pedido nuevo. */
  cola_por_delante: number | null;
  /** Móviles que aportan capacidad a la zona (dedicación > 0). */
  moviles_considerados: number | null;
  /** Ritmo aplicado, en minutos por pedido, y de qué nivel de la cascada salió. */
  ritmo_usado: number | null;
  ritmo_origen: RitmoOrigen | null;
  ritmo_muestras: number | null;
  sin_capacidad: boolean;
  clampeado: ClampeadoDemora | null;
  /**
   * true = el publicado NO llegó al valor que pedía el modelo (post-clamp):
   * el movimiento entre corridas está topeado EN LAS DOS direcciones (sube
   * hasta subida_max y baja hasta bajada_max por corrida — demoras_acabado).
   * No afirma dirección: puede ser una suba capada o una baja capada.
   */
  suavizado_aplicado: boolean;
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
  /**
   * El desglose ("por qué esta zona informa esto"): la última corrida del
   * día con su auditoría completa. Siempre presente — toda zona listada
   * tiene al menos una corrida, que es de donde salió.
   */
  ultima: UltimaCorridaZona;
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
