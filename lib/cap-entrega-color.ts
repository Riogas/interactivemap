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
 * Calcula el color de la capa Cap. Entrega usando una escala de ratio.
 *
 * ratio = capacidadDisponible / max(capacidadTotal, 1)  — clamped a [-1, 1]
 *
 * Bandas:
 *  - Sin moviles + sin pedidos   → gris "—" (sin datos, sentinel -1000)
 *  - ratio >  0.5                → verde fuerte (#22c55e)
 *  - 0 < ratio <= 0.5            → verde-amarillo (#84cc16)
 *  - ratio = 0                   → amarillo (#eab308)
 *  - -0.5 <= ratio < 0           → naranja (#f97316) — solo visible con feature
 *  - ratio < -0.5                → rojo (#ef4444) — solo visible con feature
 *
 * Para usuarios SIN la feature (isPrivileged=false):
 *  - capacidadDisponible se capea a 0 antes del calculo del ratio.
 *  - sinAsignar se ignora (siempre 0 en el stats para estos usuarios).
 *
 * @param stats        Estadisticas de la zona (construidas desde ZonaCapSnapshot en PR2).
 * @param isPrivileged true para root/despacho/dashboard/supervisor (ven negativos).
 * @param visualRefs   Overrides de colores del usuario.
 */
export function getCapEntregaColor(
  stats: SaturacionZonaStats,
  isPrivileged: boolean,
  visualRefs?: Record<string, string> | null,
): { color: string; label: string; capEntrega: number } {
  const { capacidadDisponible: rawDisponible, capacidadTotal, movilesEnZona } = stats;

  // Sin datos (sentinel -1000): sin moviles y sin pendientes
  if (movilesEnZona === 0 && stats.sinAsignar === 0) {
    return { color: getRefColor('Ref#26', visualRefs), label: '—', capEntrega: -1000 };
  }

  // Capacidad efectiva: usuarios sin feature ven capacidad capeada a 0
  const capacidadDisponible = isPrivileged ? rawDisponible : Math.max(rawDisponible, 0);

  const total = Math.max(capacidadTotal, 1);
  const ratio = Math.max(-1, Math.min(1, capacidadDisponible / total));

  // Valor entero para el label (igual que antes: capacidadDisponible - sinAsignar)
  const sinAsignar = isPrivileged ? stats.sinAsignar : 0;
  const capEntrega = capacidadDisponible - sinAsignar;

  // Sin moviles pero con pedidos pendientes → sin capacidad (cobertura 0)
  if (movilesEnZona === 0) {
    return { color: getRefColor('Ref#21', visualRefs), label: 'Sin Cap.', capEntrega: -999 };
  }

  if (ratio > 0.5) {
    return { color: '#22c55e', label: String(capEntrega), capEntrega };
  }
  if (ratio > 0) {
    return { color: '#84cc16', label: String(capEntrega), capEntrega };
  }
  if (ratio === 0) {
    return { color: '#eab308', label: '0', capEntrega };
  }
  if (ratio >= -0.5) {
    // Naranja: solo visible con feature; sin feature ratio nunca llega aquí (capeado a 0)
    return { color: '#f97316', label: String(capEntrega), capEntrega };
  }
  // ratio < -0.5
  return { color: '#ef4444', label: String(capEntrega), capEntrega };
}
