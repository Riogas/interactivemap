/**
 * Tipos compartidos para el snapshot de capacidad por zona.
 *
 * Producidos por: GET /api/zonas/capacidad-snapshot
 * Consumidos por: useZonaCapacidadSnapshot (PR1), SaturacionZonaModal / SaturacionZonasLayer (PR2)
 *
 * PR1 crea estos tipos; PR2 los usa para reemplazar el cálculo client-side de saturacionData.
 */

/**
 * Tipo de servicio aceptado por el endpoint y el hook (combo de la capa).
 *  - URGENTE / NOCTURNO: SA de la tabla `pedidos` con ese servicio_nombre.
 *  - OTROS:  SA de `pedidos` con servicio_nombre ≠ URGENTE/NOCTURNO (incluye null).
 *  - TODOS:  SA de `pedidos` de cualquier servicio_nombre (acumulado).
 *  - SERVICE: SA de la tabla `services`.
 * Para capacidad (denominador), OTROS y TODOS usan el bucket URGENTE (flota diurna).
 */
export type TipoServicioSnapshot = 'URGENTE' | 'SERVICE' | 'NOCTURNO' | 'OTROS' | 'TODOS';

/**
 * Pedido sin asignar en versión compacta para el detalle de zona.
 * Solo se incluye en el response cuando el caller tiene la funcionalidad
 * "Ped s/asignar unitarios" (máximo nivel; muestra el detalle por pedido).
 */
export interface PedidoSinAsignarMini {
  id: number;
  /** Tipo de servicio del pedido (reemplaza al nombre del cliente — CapEntrega.docx). */
  tipo_servicio: string;
  fecha: string;
  direccion_corta: string;
}

/**
 * Detalle de un móvil dentro de una zona para el snapshot de capacidad.
 * - `en_transito`: true si `moviles_zonas.prioridad_o_transito !== 1` para ese (movil, zona, escenario).
 * - `aporte_a_zona`: el `lote_disponible` de `zonas_cap_entrega` para ese móvil × zona.
 * - `capacidad_actual`: campo `capacidad` de la tabla `moviles` (pedidos + services en curso).
 */
export interface MovilDetalleZona {
  movil_id: number;
  lote_asignado: number;
  en_transito: boolean;
  capacidad_actual: number;
  aporte_a_zona: number;
  /** Total de zonas de PRIORIDAD que cubre este móvil (no solo esta zona). */
  zonas_prioridad: number;
  /** Total de zonas de TRÁNSITO que cubre este móvil. */
  zonas_transito: number;
}

/**
 * Snapshot consolidado de capacidad para una zona.
 *
 * Invariantes:
 * - `capacidad_total` puede ser negativo (sobrecupo real — sin cap) y decimal (prorrateo ponderado).
 * - `pedidos_sin_asignar` es 0 cuando el caller NO tiene ninguna funcionalidad SA
 *   ("Ped s/asignar x zona" ni "unitarios").
 * - `pedidos_sin_asignar_por_tipo` está presente con CUALQUIERA de las 2 funcionalidades
 *   (por zona o unitarios): son solo contadores agrupados por servicio, no exponen detalle.
 * - `pedidos_sin_asignar_detalle` solo está presente cuando el caller tiene "Ped s/asignar unitarios".
 * - El cap a 0 / -9999 es RESPONSABILIDAD DEL CLIENTE (PR2), no del endpoint.
 */
export interface ZonaCapSnapshot {
  zona_id: number;
  capacidad_total: number;
  pedidos_sin_asignar: number;
  /**
   * Desglose de SA por tipo de servicio (ej. [{tipo:'URGENTE',cant:1},{tipo:'SERVICE',cant:2}]).
   * Presente con "Ped s/asignar x zona" O "unitarios": son contadores, no detalle por pedido.
   * Ordenado desc por cantidad.
   */
  pedidos_sin_asignar_por_tipo?: Array<{ tipo: string; cant: number }>;
  /** Solo presente cuando caller tiene funcionalidad "Ped s/asignar unitarios". */
  pedidos_sin_asignar_detalle?: PedidoSinAsignarMini[];
  moviles_prioridad: number;
  moviles_transito: number;
  moviles_detalle: MovilDetalleZona[];
}
