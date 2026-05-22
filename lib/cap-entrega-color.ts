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
 *  - -3 <= cap <= -1             → naranja (#f97316)        — Sobrecupo leve (solo con feature)
 *  - cap <= -4                   → rojo (#ef4444)           — Sobrecupo alto (solo con feature)
 *
 * Para usuarios SIN la feature (isPrivileged=false):
 *  - capacidadDisponible se capea a 0 antes del calculo.
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
  const { capacidadDisponible: rawDisponible, movilesEnZona } = stats;

  // Sin datos (sentinel -1000): sin moviles y sin pendientes
  if (movilesEnZona === 0 && stats.sinAsignar === 0) {
    return { color: getRefColor('Ref#26', visualRefs), label: '—', capEntrega: -1000 };
  }

  // Capacidad efectiva: usuarios sin feature ven capacidad capeada a 0
  const capacidadDisponible = isPrivileged ? rawDisponible : Math.max(rawDisponible, 0);

  // Valor entero para el label (igual que antes: capacidadDisponible - sinAsignar)
  const sinAsignar = isPrivileged ? stats.sinAsignar : 0;
  const capEntrega = capacidadDisponible - sinAsignar;

  // Sin moviles pero con pedidos pendientes → sin capacidad (cobertura 0)
  if (movilesEnZona === 0) {
    return { color: getRefColor('Ref#21', visualRefs), label: 'Sin Cap.', capEntrega: -999 };
  }

  if (capEntrega >= 4) {
    return { color: '#22c55e', label: String(capEntrega), capEntrega };
  }
  if (capEntrega >= 1) {
    return { color: '#84cc16', label: String(capEntrega), capEntrega };
  }
  if (capEntrega === 0) {
    return { color: '#eab308', label: '0', capEntrega };
  }
  if (capEntrega >= -3) {
    // Naranja: solo visible con feature; sin feature capEntrega nunca llega aquí (capeado a 0)
    return { color: '#f97316', label: String(capEntrega), capEntrega };
  }
  // capEntrega <= -4
  return { color: '#ef4444', label: String(capEntrega), capEntrega };
}
