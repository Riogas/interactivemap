/**
 * Lógica pura de cálculo de color/label para la capa Cap. Entrega del mapa.
 * Extraída de SaturacionZonasLayer para que pueda ser testeada sin dependencias
 * de browser (Leaflet, react-leaflet).
 */

/**
 * Estadísticas de saturación por zona. Espejo del tipo exportado en SaturacionZonasLayer
 * — duplicado aquí para evitar importar módulos con dependencias de browser en tests.
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
 * color + texto de etiqueta según bandas numéricas.
 *
 * Bandas:
 *  - Sin móviles + pedidos > 0   → marrón "Sin Cap." (sin cobertura, sentinel -999)
 *  - Sin móviles + sin pedidos   → gris "—" (sin datos, sentinel -1000)
 *  - capEntrega < 0              → marrón: privilegiados ven el número negativo,
 *                                  distribuidores siguen viendo "Sin Cap."
 *  - capEntrega = 0              → rojo
 *  - capEntrega = 1              → naranja
 *  - capEntrega = 2 o 3          → amarillo
 *  - capEntrega > 3              → verde claro
 *
 * @param isPrivileged - true para root/despacho/dashboard/supervisor.
 *   Cuando true y capEntrega < 0 (cálculo real, no sentinel), el label muestra
 *   el valor negativo en lugar de "Sin Cap.".
 */
export function getCapEntregaColor(
  stats: SaturacionZonaStats,
  isPrivileged: boolean,
): { color: string; label: string; capEntrega: number } {
  const { sinAsignar, capacidadDisponible, movilesEnZona } = stats;

  if (movilesEnZona === 0 && sinAsignar > 0) {
    // Sin móviles pero hay pendientes → sin capacidad de entrega (sentinel -999)
    // NO se muestra el número negativo aunque el usuario sea privilegiado.
    return { color: '#92400e', label: 'Sin Cap.', capEntrega: -999 };
  }
  if (movilesEnZona === 0 && sinAsignar === 0) {
    // Sin datos (sentinel -1000)
    return { color: '#d1d5db', label: '—', capEntrega: -1000 };
  }

  const capEntrega = capacidadDisponible - sinAsignar;

  if (capEntrega < 0) {
    // Cálculo real negativo: privilegiados ven el número, distribuidores ven "Sin Cap."
    return {
      color: '#92400e',
      label: isPrivileged ? String(capEntrega) : 'Sin Cap.',
      capEntrega,
    };
  }
  if (capEntrega === 0)  return { color: '#ef4444', label: '0', capEntrega };
  if (capEntrega === 1)  return { color: '#f97316', label: '1', capEntrega };
  if (capEntrega <= 3)   return { color: '#eab308', label: String(capEntrega), capEntrega };
  return { color: '#86efac', label: String(capEntrega), capEntrega };
}
