/** Tipos de GET /api/demoras/comparativa. */
export type TipoDemora = 'URGENTE' | 'NOCTURNO' | 'SERVICE';
export const TIPOS_DEMORA: TipoDemora[] = ['URGENTE', 'NOCTURNO', 'SERVICE'];

export interface PuntoComparativa {
  corrida_at: string;
  /** Fix round 1: sin esto, la serie sin filtro de zona mezcla puntos de
   * TODAS las zonas ordenados solo por hora — un gráfico en zigzag. */
  zona_id: number;
  calculada: number;
  /** null cuando el AS400 no informa ese tipo (solo informa URGENTE). */
  as400: number | null;
}

export interface ZonaBrecha {
  zona_id: number;
  zona_nombre: string;
  prom_calculada: number;
  prom_as400: number | null;
  /** calculada − as400. null si no hay contraparte. */
  brecha: number | null;
}

export interface ComparativaData {
  serie: PuntoComparativa[];
  zonas: ZonaBrecha[];
}
