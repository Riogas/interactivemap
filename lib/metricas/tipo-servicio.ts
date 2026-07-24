/**
 * Regla compartida de clasificación de tipo_servicio.
 * Buckets: URGENTE / NOCTURNO / ESPECIAL / OTROS (de pedidos) + SERVICE (origen services).
 *
 * Fuente única para:
 *  - app/api/metricas/cumplimiento/run/route.ts (tabla de hechos metricas_cumplimiento)
 *  - app/api/zonas/capacidad-snapshot/route.ts (rama OTROS, vía buildComunOrFilter())
 *
 * Naming: 'OTROS' es el label del bucket "resto" (servicio_nombre null o que no
 * cae en URGENTE/NOCTURNO/ESPECIAL). OJO: en métricas los ESPECIAL se separan en
 * su propio bucket; capacidad-snapshot NO los separa (su 'OTROS', vía
 * buildComunOrFilter(), sigue siendo "todo lo que no es URGENTE ni NOCTURNO",
 * incluyendo especiales). Son features distintas, no confundir los dos 'OTROS'.
 */

export type TipoServicio = 'URGENTE' | 'NOCTURNO' | 'ESPECIAL' | 'OTROS' | 'SERVICE';

export const SERVICIO_NOMBRE_ESPECIALES = ['URGENTE', 'NOCTURNO'] as const;

/**
 * true si `nombre` (trim + toUpperCase) es uno de los servicio_nombre especiales
 * (URGENTE | NOCTURNO). null/undefined/'' → false.
 */
export function esServicioEspecial(nombre: string | null | undefined): boolean {
  if (!nombre) return false;
  const normalizado = nombre.trim().toUpperCase();
  return (SERVICIO_NOMBRE_ESPECIALES as readonly string[]).includes(normalizado);
}

/**
 * Clasifica un pedido según servicio_nombre (trim + toUpperCase):
 *  - `=== 'URGENTE'`            → 'URGENTE'
 *  - `=== 'NOCTURNO'`           → 'NOCTURNO'
 *  - empieza con `'ESPECIAL'`   → 'ESPECIAL'  (ej. "ESPECIAL SIN FLETE")
 *  - cualquier otro, incl. null → 'OTROS'
 */
export function clasificarTipoServicioPedido(
  servicioNombre: string | null | undefined,
): 'URGENTE' | 'NOCTURNO' | 'ESPECIAL' | 'OTROS' {
  const normalizado = servicioNombre?.trim().toUpperCase();
  if (normalizado === 'URGENTE') return 'URGENTE';
  if (normalizado === 'NOCTURNO') return 'NOCTURNO';
  if (normalizado?.startsWith('ESPECIAL')) return 'ESPECIAL';
  return 'OTROS';
}

/**
 * Clasifica el tipo_servicio de un hecho según su origen. SERVICE siempre es
 * 'SERVICE' (no se subdivide por servicio_nombre); PEDIDO usa clasificarTipoServicioPedido.
 */
export function clasificarTipoServicio(
  origen: 'PEDIDO' | 'SERVICE',
  servicioNombre: string | null | undefined,
): TipoServicio {
  if (origen === 'SERVICE') return 'SERVICE';
  return clasificarTipoServicioPedido(servicioNombre);
}

/**
 * Cláusula PostgREST `.or(...)` para el bucket de capacidad-snapshot
 * (servicio_nombre nulo o distinto de todos los SERVICIO_NOMBRE_ESPECIALES).
 * NO separa ESPECIAL — es el contrato existente del combo/UI de capacidad.
 * Construida dinámicamente desde SERVICIO_NOMBRE_ESPECIALES; hoy con 2 valores
 * produce EXACTAMENTE:
 *   'servicio_nombre.is.null,and(servicio_nombre.neq.URGENTE,servicio_nombre.neq.NOCTURNO)'
 */
export function buildComunOrFilter(): string {
  const neqClauses = SERVICIO_NOMBRE_ESPECIALES.map((v) => `servicio_nombre.neq.${v}`).join(',');
  return `servicio_nombre.is.null,and(${neqClauses})`;
}
