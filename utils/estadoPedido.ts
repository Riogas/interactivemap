/**
 * Mapeo de sub_estado_nro + sub_estado_desc a descripciones legibles.
 * Fuente: tabla de estados del sistema AS400/GeneXus.
 *
 * sub_estado_nro = primera columna (1 = pendientes, 2 = finalizados)
 * sub_estado_desc = segunda columna (codigo numerico como string)
 * Valor = descripcion legible
 */

type EstadoKey = `${number}-${string}`;

const ESTADO_MAP: Record<EstadoKey, string> = {
  // sub_estado_nro = 1 (Pendientes / En proceso)
  '1-1': 'SIN RUTEAR',
  '1-2': 'PEND. AUT FINAN',
  '1-4': 'NO AUT FINANC',
  '1-5': 'MOVIL ASIGNADO',
  '1-6': 'RUTEO.MAN',
  '1-7': 'PEND ASIG MOVIL',
  '1-8': 'PROCESA AUTORIZ',

  // sub_estado_nro = 2 (Finalizados / Resultados)
  '2-1':  'NO HAY NADIE',
  '2-2':  'MAL LA DIRECCION',
  '2-3':  'ENTREGADO',
  '2-4':  'SIN VACIO',
  '2-5':  'CANC CLI DEMORA',
  '2-6':  'SIN DINERO',
  '2-7':  'NO CUMPLIDO',
  '2-8':  'R14-NO CUMPLIDO',
  '2-9':  'NO PIDIO',
  '2-10': 'NO ATENDIO',
  '2-11': 'MAL TOMADO',
  '2-12': 'CANC CLI OTROS',
  '2-13': 'CANC X NOAUT',
  '2-14': 'PRECUMPLIDO',
  '2-15': 'NO PASA AUTOM',
  '2-16': 'ZONA CORTADA',
  '2-17': 'REG. HISTORICO',
  '2-18': 'REAGENDADO',
  '2-19': 'ENTR. SIN 1710',
  '2-20': 'NO CUM-S/ACCESO',
};

/**
 * Obtiene la descripcion legible a partir de sub_estado_nro y sub_estado_desc.
 * Algunos registros guardan el sub-codigo en sub_estado_nro (p.ej. 19) y otros
 * lo guardan en sub_estado_desc (string). Si se recibe estadoNro como tercer
 * argumento, tambien se prueba la key `${estadoNro}-${subEstadoNro}` como fallback.
 *
 * @param subEstadoNro - Categoria (1|2) o sub-codigo segun el registro
 * @param subEstadoDesc - Sub-codigo como string, o vacio
 * @param estadoNro - Categoria principal (1|2). Opcional, mejora la resolucion.
 * @returns Descripcion textual o fallback.
 */
export function getEstadoDescripcion(
  subEstadoNro: number | null | undefined,
  subEstadoDesc: string | null | undefined,
  estadoNro?: number | string | null | undefined
): string {
  const desc = (subEstadoDesc ?? '').toString().trim();
  const nro = subEstadoNro != null ? Number(subEstadoNro) : null;
  const main = estadoNro != null ? Number(estadoNro) : null;

  if (nro != null && desc !== '') {
    const key = `${nro}-${desc}` as EstadoKey;
    if (ESTADO_MAP[key]) return ESTADO_MAP[key];
  }

  if (main != null && nro != null) {
    const key = `${main}-${nro}` as EstadoKey;
    if (ESTADO_MAP[key]) return ESTADO_MAP[key];
  }

  if (nro == null) return 'Sin estado';
  return desc || `Estado ${nro}`;
}

interface EntregadoCheckable {
  estado_nro?: number | string | null;
  sub_estado_nro?: number | string | null;
}

/**
 * Devuelve true si el pedido corresponde a "Entregado".
 * Criterio: estado_nro = 2 y sub_estado_nro = 3 (ENTREGADO) o 19 (ENTR. SIN 1710).
 */
export function isPedidoEntregado(p: EntregadoCheckable): boolean {
  return Number(p.estado_nro) === 2 && (Number(p.sub_estado_nro) === 3 || Number(p.sub_estado_nro) === 19);
}

/**
 * Devuelve true si el service corresponde a "Entregado".
 * Mismo criterio que pedidos: estado_nro = 2 y sub_estado_nro = 3 (ENTREGADO)
 * o 19 (ENTR. SIN 1710).
 */
export function isServiceEntregado(s: EntregadoCheckable): boolean {
  return Number(s.estado_nro) === 2 && (Number(s.sub_estado_nro) === 3 || Number(s.sub_estado_nro) === 19);
}

/**
 * Devuelve solo la descripcion del estado principal (sin sub-estado).
 */
export function getEstadoPrincipalLabel(subEstadoNro: number | null | undefined): string {
  if (subEstadoNro == null) return 'Sin estado';
  if (subEstadoNro === 1) return 'Pendiente';
  if (subEstadoNro === 2) return 'Finalizado';
  return `Estado ${subEstadoNro}`;
}

/**
 * Devuelve true si el pedido debe excluirse completamente del sistema.
 * Hoy cubre REG. HISTORICO (estado_nro=2, sub_estado_nro=17).
 * Estos pedidos NO aparecen en mapa, conteos, listas, indicadores ni estadisticas.
 */
export function isPedidoExcluido(p: EntregadoCheckable): boolean {
  return Number(p.estado_nro) === 2 && Number(p.sub_estado_nro) === 17;
}

/**
 * Filtra un array de pedidos descartando los excluidos del sistema (isPedidoExcluido).
 * Usar en el punto de ingreso de datos para cubrir todos los consumidores downstream.
 */
export function filterPedidosVisibles<T extends EntregadoCheckable>(arr: T[]): T[] {
  return arr.filter((p) => !isPedidoExcluido(p));
}
