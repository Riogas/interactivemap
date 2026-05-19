/**
 * Logica pura de calculo de color/label para la capa Cap. Entrega del mapa.
 * Extraida de SaturacionZonasLayer para que pueda ser testeada sin dependencias
 * de browser (Leaflet, react-leaflet).
 */

import { getRefColor } from '@/lib/visual-refs-catalog';

/**
 * Estadisticas de saturacion por zona. Espejo del tipo exportado en SaturacionZonasLayer
 * — duplicado aqui para evitar importar modulos con dependencias de browser en tests.
 */
export interface SaturacionZonaStats {
  sinAsignar: number;
  capacidadTotal: number;
  capacidadDisponible: number;
  movilesEnZona: number;
  movilesCompartidos: number;
  asignadosWeight: number;
  totalWeight: number;
}

/**
 * Calcula la Cap. Entrega = capacidadDisponible - sinAsignar y devuelve
 * color + texto de etiqueta segun bandas numericas.
 *
 * Bandas:
 *  - Sin moviles + pedidos > 0   → marron "Sin Cap." (sin cobertura, sentinel -999)
 *  - Sin moviles + sin pedidos   → gris "—" (sin datos, sentinel -1000)
 *  - capEntrega < 0              → marron: privilegiados ven el numero negativo,
 *                                  distribuidores siguen viendo "Sin Cap."
 *  - capEntrega = 0              → rojo
 *  - capEntrega = 1              → naranja
 *  - capEntrega = 2 o 3          → amarillo
 *  - capEntrega > 3              → verde claro
 *
 * @param isPrivileged - true para root/despacho/dashboard/supervisor.
 *   Cuando true y capEntrega < 0 (calculo real, no sentinel), el label muestra
 *   el valor negativo en lugar de "Sin Cap.".
 * @param visualRefs - overrides de colores del usuario (de UserPreferences.visualRefs).
 *   Si se pasan, los colores de Ref#21..Ref#26 se toman de ahi.
 */
export function getCapEntregaColor(
  stats: SaturacionZonaStats,
  isPrivileged: boolean,
  visualRefs?: Record<string, string> | null,
): { color: string; label: string; capEntrega: number } {
  const { sinAsignar, capacidadDisponible, movilesEnZona } = stats;

  if (movilesEnZona === 0 && sinAsignar > 0) {
    // Sin moviles pero hay pendientes → sin capacidad de entrega (sentinel -999)
    // NO se muestra el numero negativo aunque el usuario sea privilegiado.
    return { color: getRefColor('Ref#21', visualRefs), label: 'Sin Cap.', capEntrega: -999 };
  }
  if (movilesEnZona === 0 && sinAsignar === 0) {
    // Sin datos (sentinel -1000)
    return { color: getRefColor('Ref#26', visualRefs), label: '—', capEntrega: -1000 };
  }

  const capEntrega = capacidadDisponible - sinAsignar;

  if (capEntrega < 0) {
    // Calculo real negativo: privilegiados ven el numero, distribuidores ven "Sin Cap."
    return {
      color: getRefColor('Ref#21', visualRefs),
      label: isPrivileged ? String(capEntrega) : 'Sin Cap.',
      capEntrega,
    };
  }
  if (capEntrega === 0)  return { color: getRefColor('Ref#22', visualRefs), label: '0', capEntrega };
  if (capEntrega === 1)  return { color: getRefColor('Ref#23', visualRefs), label: '1', capEntrega };
  if (capEntrega <= 3)   return { color: getRefColor('Ref#24', visualRefs), label: String(capEntrega), capEntrega };
  return { color: getRefColor('Ref#25', visualRefs), label: String(capEntrega), capEntrega };
}
