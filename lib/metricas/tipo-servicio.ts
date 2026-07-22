/**
 * Regla compartida de clasificación de tipo_servicio (URGENTE/NOCTURNO/COMUN/SERVICE).
 *
 * Fuente única para:
 *  - app/api/metricas/cumplimiento/run/route.ts (tabla de hechos metricas_cumplimiento)
 *  - app/api/zonas/capacidad-snapshot/route.ts (rama OTROS, vía buildComunOrFilter())
 *
 * Naming: 'COMUN' es el label canónico de esta tabla; en capacidad-snapshot el
 * mismo bucket (servicio_nombre null o distinto de URGENTE/NOCTURNO) se llama
 * 'OTROS' — es el mismo conjunto, la traducción queda documentada acá y en
 * docs/METRICAS_CUMPLIMIENTO.md. NO se renombra 'OTROS' en capacidad-snapshot
 * porque es un parámetro de contrato del combo/UI existente.
 */

export type TipoServicio = 'URGENTE' | 'NOCTURNO' | 'COMUN' | 'SERVICE';

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
 * Clasifica un pedido en 'URGENTE' | 'NOCTURNO' | 'COMUN' según servicio_nombre
 * (trim + toUpperCase). Cualquier otro valor, incluido null, cae en 'COMUN'.
 */
export function clasificarTipoServicioPedido(
  servicioNombre: string | null | undefined,
): 'URGENTE' | 'NOCTURNO' | 'COMUN' {
  const normalizado = servicioNombre?.trim().toUpperCase();
  if (normalizado === 'URGENTE') return 'URGENTE';
  if (normalizado === 'NOCTURNO') return 'NOCTURNO';
  return 'COMUN';
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
 * Cláusula PostgREST `.or(...)` para el bucket COMUN/OTROS (servicio_nombre nulo
 * o distinto de todos los SERVICIO_NOMBRE_ESPECIALES). Construida dinámicamente
 * desde SERVICIO_NOMBRE_ESPECIALES para no duplicar la regla; hoy con 2 valores
 * produce EXACTAMENTE:
 *   'servicio_nombre.is.null,and(servicio_nombre.neq.URGENTE,servicio_nombre.neq.NOCTURNO)'
 */
export function buildComunOrFilter(): string {
  const neqClauses = SERVICIO_NOMBRE_ESPECIALES.map((v) => `servicio_nombre.neq.${v}`).join(',');
  return `servicio_nombre.is.null,and(${neqClauses})`;
}
