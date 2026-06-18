/**
 * Logica pura de calculo de color/label para la capa Cap. Entrega del mapa.
 * Extraida de SaturacionZonasLayer para que pueda ser testeada sin dependencias
 * de browser (Leaflet, react-leaflet).
 */

import { getRefColor } from '@/lib/visual-refs-catalog';

/**
 * Estadisticas de saturacion por zona. Espejo del tipo exportado en SaturacionZonasLayer
 * — duplicado aqui para evitar importar modulos con dependencias de browser en tests.
 *
 * A partir de PR2, este map se construye desde ZonaCapSnapshot en app/dashboard/page.tsx
 * en lugar de calcularse client-side desde movilesZonasData.
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
 * Calcula el color de la capa Cap. Entrega usando una escala de **valor absoluto**.
 * (Antes usaba ratio, pero zonas chicas con cap=1/total=1 daban "holgura alta"
 * cuando intuitivamente es baja.)
 *
 * Bandas:
 *  - Sin moviles + sin pedidos   → gris "—" (sin datos, sentinel -1000)
 *  - cap >= 4                    → verde fuerte (#22c55e)  — Holgura alta
 *  - 1 <= cap <= 3               → verde-amarillo (#84cc16) — Holgura baja
 *  - cap = 0                     → amarillo (#eab308)       — Capacidad exacta
 *  - -3 <= cap <= -1             → naranja (#f97316)        — Sobrecupo leve
 *  - cap <= -4                   → rojo (#ef4444)           — Sobrecupo alto
 *
 * Los valores negativos (sobrecupo) se muestran a TODOS los usuarios por igual:
 * la capa de capacidad no tiene gating por rol ni por funcionalidad.
 *
 * @param stats        Estadisticas de la zona (construidas desde ZonaCapSnapshot en PR2).
 * @param visualRefs   Overrides de colores del usuario.
 */
/**
 * Formatea el valor de Cap. Entrega para mostrar como etiqueta.
 * Redondeo "away from zero" (CapEntrega.docx + decisión 2026-06-11):
 *   - positivos: hacia arriba (Math.ceil)  → 3.2 ⇒ 4
 *   - negativos: hacia abajo (Math.floor)  → -5.3 ⇒ -6 (sobrecupo = peor caso)
 * El COLOR se calcula sobre el decimal real, no sobre este valor redondeado.
 */
export function formatCapEntregaLabel(capEntrega: number): string {
  const rounded = capEntrega >= 0 ? Math.ceil(capEntrega) : Math.floor(capEntrega);
  return String(rounded);
}

/**
 * Valor de Cap. Entrega que se MUESTRA al usuario, aplicando el gating de
 * visibilidad de pedidos sin asignar.
 *
 *  - Con la funcionalidad (canVerSinAsignar=true): capacidad_total − pedidos_sin_asignar.
 *    Puede ser negativa → sobrecupo real (floor defensivo −9999).
 *  - Sin la funcionalidad: el sobrecupo NO se revela. Se ignoran los pedidos
 *    sin asignar (no los puede ver) y el valor se clampea a ≥ 0, de modo que una
 *    capacidad negativa (por móviles sobre-asignados) se muestra como 0.
 *
 * Única fuente de verdad del valor mostrado, usada por el modal de zona y por
 * el caption del polígono de la capa Cap. Entrega.
 */
export function capEntregaMostrada(
  capacidadTotal: number,
  pedidosSinAsignar: number,
  canVerSinAsignar: boolean,
): number {
  if (!canVerSinAsignar) return Math.max(capacidadTotal, 0);
  return Math.max(capacidadTotal - pedidosSinAsignar, -9999);
}

export function getCapEntregaColor(
  stats: SaturacionZonaStats,
  visualRefs?: Record<string, string> | null,
): { color: string; label: string; capEntrega: number } {
  const { capacidadDisponible, movilesEnZona } = stats;

  // Sin datos (sentinel -1000): sin moviles y sin pendientes
  if (movilesEnZona === 0 && stats.sinAsignar === 0) {
    return { color: getRefColor('Ref#26', visualRefs), label: '—', capEntrega: -1000 };
  }

  // capEntrega puede ser decimal (prorrateo ponderado). Sin capping por rol.
  const capEntrega = capacidadDisponible - stats.sinAsignar;

  // Sin moviles pero con pedidos pendientes → sin capacidad (cobertura 0).
  // Caso límite no listado en la leyenda; se renderiza con el color de
  // "Sobrecupo alto" (Ref#25) por ser la peor situación de capacidad.
  if (movilesEnZona === 0) {
    return { color: getRefColor('Ref#25', visualRefs), label: 'Sin Cap.', capEntrega: -999 };
  }

  // Bandas por rango continuo (idénticas a las previas para valores enteros).
  // Cada banda usa una ref editable (Ref#21..Ref#25) — ver visual-refs-catalog:
  //   >= 4        Ref#21 verde          (holgura alta)
  //   0 < x < 4   Ref#22 verde-amarillo (holgura baja)
  //   == 0        Ref#23 amarillo       (capacidad exacta)
  //   -4 < x < 0  Ref#24 naranja        (sobrecupo leve)
  //   <= -4       Ref#25 rojo           (sobrecupo alto)
  // El label se muestra redondeado (away-from-zero); el color usa el decimal real.
  const label = formatCapEntregaLabel(capEntrega);

  if (capEntrega >= 4) {
    return { color: getRefColor('Ref#21', visualRefs), label, capEntrega };
  }
  if (capEntrega > 0) {
    return { color: getRefColor('Ref#22', visualRefs), label, capEntrega };
  }
  if (capEntrega === 0) {
    return { color: getRefColor('Ref#23', visualRefs), label: '0', capEntrega };
  }
  if (capEntrega > -4) {
    return { color: getRefColor('Ref#24', visualRefs), label, capEntrega };
  }
  // capEntrega <= -4
  return { color: getRefColor('Ref#25', visualRefs), label, capEntrega };
}
