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

  // Sin moviles pero con pedidos pendientes → sin capacidad (cobertura 0)
  if (movilesEnZona === 0) {
    return { color: getRefColor('Ref#21', visualRefs), label: 'Sin Cap.', capEntrega: -999 };
  }

  // Bandas por rango continuo (idénticas a las previas para valores enteros):
  //   >= 4        verde         (holgura alta)
  //   0 < x < 4   verde-amarillo (holgura baja)
  //   == 0        amarillo      (capacidad exacta)
  //   -4 < x < 0  naranja       (sobrecupo leve)
  //   <= -4       rojo          (sobrecupo alto)
  // El label se muestra redondeado (away-from-zero); el color usa el decimal real.
  const label = formatCapEntregaLabel(capEntrega);

  if (capEntrega >= 4) {
    return { color: '#22c55e', label, capEntrega };
  }
  if (capEntrega > 0) {
    return { color: '#84cc16', label, capEntrega };
  }
  if (capEntrega === 0) {
    return { color: '#eab308', label: '0', capEntrega };
  }
  if (capEntrega > -4) {
    return { color: '#f97316', label, capEntrega };
  }
  // capEntrega <= -4
  return { color: '#ef4444', label, capEntrega };
}
