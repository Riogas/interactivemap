/**
 * Mapeo de sub_estado_nro + sub_estado_desc a descripciones legibles.
 * Fuente: tabla de estados del sistema AS400/GeneXus.
 *
 * sub_estado_nro = primera columna (1 = pendientes, 2 = finalizados)
 * sub_estado_desc = segunda columna (código numérico como string)
 * Valor = descripción legible
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
 * Obtiene la descripción legible a partir de sub_estado_nro y sub_estado_desc.
 * @param subEstadoNro - Primera columna (1 = pendiente, 2 = finalizado)
 * @param subEstadoDesc - Segunda columna (código numérico como string)
 * @returns Descripción textual o fallback.
 */
export function getEstadoDescripcion(
  subEstadoNro: number | null | undefined,
  subEstadoDesc: string | null | undefined
): string {
  if (subEstadoNro == null) return 'Sin estado';
  if (subEstadoDesc == null || subEstadoDesc.trim() === '') return `Estado ${subEstadoNro}`;

  const key: EstadoKey = `${subEstadoNro}-${subEstadoDesc.trim()}`;
  return ESTADO_MAP[key] ?? (subEstadoDesc.trim() || `Estado ${subEstadoNro}`);
}

/**
 * Devuelve solo la descripción del estado principal (sin sub-estado).
 */
export function getEstadoPrincipalLabel(subEstadoNro: number | null | undefined): string {
  if (subEstadoNro == null) return 'Sin estado';
  if (subEstadoNro === 1) return 'Pendiente';
  if (subEstadoNro === 2) return 'Finalizado';
  return `Estado ${subEstadoNro}`;
}
