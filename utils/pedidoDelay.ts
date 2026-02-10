/**
 * Utilidad para calcular el atraso/demora de pedidos y determinar
 * la codificación de color según configuración:
 * 
 * - Verde "En Hora": >= 10 min antes de la hora programada
 * - Amarillo "Hora Límite Cercana": 0-9 min antes
 * - Rosa "Atrasado": 1-10 min de atraso
 * - Rojo "Muy Atrasado": > 10 min de atraso
 */

export interface DelayInfo {
  /** Minutos de diferencia: positivo = adelantado, negativo = atrasado */
  delayMinutes: number;
  /** Etiqueta descriptiva */
  label: string;
  /** Color principal (hex) */
  color: string;
  /** Color claro para gradientes */
  lightColor: string;
  /** Color de sombra (rgba) */
  shadowColor: string;
  /** Clases Tailwind para fondo del sidebar */
  bgClass: string;
  /** Color de texto para la etiqueta */
  textColor: string;
  /** Texto corto para mostrar en badge */
  badgeText: string;
}

/**
 * Calcula los minutos de diferencia entre ahora y fch_hora_max_ent_comp.
 * Positivo = todavía tiene tiempo (adelantado). Negativo = atrasado.
 * 
 * NOTA: La DB almacena horas locales (Uruguay) con offset +00 incorrecto.
 * Ej: "2026-02-10 13:51:46+00" realmente significa 13:51 hora local.
 * Se stripea el offset para que JS lo interprete como hora local del navegador.
 */
export function computeDelayMinutes(fchHoraMaxEntComp: string | null): number | null {
  if (!fchHoraMaxEntComp) return null;
  try {
    // Quitar el offset timezone (+00, +00:00, -03, etc.) para interpretar como hora local
    const localTimeStr = fchHoraMaxEntComp.replace(/[+-]\d{2}(:\d{2})?$/, '').trim();
    const scheduled = new Date(localTimeStr).getTime();
    if (isNaN(scheduled)) return null;
    return Math.round((scheduled - Date.now()) / 60000);
  } catch {
    return null;
  }
}

/**
 * Obtiene la información de color y etiqueta según los minutos de atraso.
 * Configuración basada en tabla de rangos:
 * - ID 40: En Hora (10 a 1000) → Verde
 * - ID 41: Hora Límite Cercana (0 a 9) → Amarillo
 * - ID 42: Atrasado (-10 a -1) → Rosa/Pink
 * - ID 43: Muy Atrasado (-40000 a -11) → Rojo
 */
export function getDelayInfo(delayMinutes: number | null): DelayInfo {
  // Sin datos → gris neutro
  if (delayMinutes === null) {
    return {
      delayMinutes: 0,
      label: 'Sin hora',
      color: '#6B7280',
      lightColor: '#D1D5DB',
      shadowColor: 'rgba(107, 114, 128, 0.3)',
      bgClass: 'bg-gray-100 hover:bg-gray-200 border-gray-300',
      textColor: 'text-gray-700',
      badgeText: 'N/A',
    };
  }

  if (delayMinutes >= 10) {
    // En Hora - Verde
    return {
      delayMinutes,
      label: 'En Hora',
      color: '#22C55E',
      lightColor: '#86EFAC',
      shadowColor: 'rgba(34, 197, 94, 0.3)',
      bgClass: 'bg-green-100 hover:bg-green-200 border-green-400',
      textColor: 'text-green-800',
      badgeText: `+${delayMinutes} min`,
    };
  }

  if (delayMinutes >= 0) {
    // Hora Límite Cercana - Amarillo
    return {
      delayMinutes,
      label: 'Hora Límite Cercana',
      color: '#EAB308',
      lightColor: '#FDE047',
      shadowColor: 'rgba(234, 179, 8, 0.3)',
      bgClass: 'bg-yellow-100 hover:bg-yellow-200 border-yellow-400',
      textColor: 'text-yellow-800',
      badgeText: `${delayMinutes} min`,
    };
  }

  if (delayMinutes >= -10) {
    // Atrasado - Rosa/Pink
    return {
      delayMinutes,
      label: 'Atrasado',
      color: '#EC4899',
      lightColor: '#F9A8D4',
      shadowColor: 'rgba(236, 72, 153, 0.3)',
      bgClass: 'bg-pink-100 hover:bg-pink-200 border-pink-400',
      textColor: 'text-pink-800',
      badgeText: `${delayMinutes} min`,
    };
  }

  // Muy Atrasado - Rojo
  return {
    delayMinutes,
    label: 'Muy Atrasado',
    color: '#EF4444',
    lightColor: '#FCA5A5',
    shadowColor: 'rgba(239, 68, 68, 0.3)',
    bgClass: 'bg-red-100 hover:bg-red-200 border-red-400',
    textColor: 'text-red-800',
    badgeText: `${delayMinutes} min`,
  };
}
