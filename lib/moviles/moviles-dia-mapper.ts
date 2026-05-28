/**
 * Mapper: fila de la vista moviles_dia → MovilData del dashboard.
 *
 * Propósito: capa de traducción entre el read model de Supabase y la forma
 * que consumen los componentes y hooks del dashboard. No hace I/O.
 */

import type { MovilData } from '@/types/index';

// ─────────────────────────────────────────────────────────────────────────────
// Forma de la fila que devuelve la vista moviles_dia
// ─────────────────────────────────────────────────────────────────────────────

export interface MovilDiaRow {
  escenario_id: number;
  movil_id: number;
  fecha: string;
  empresa_fletera_id: number | null;
  matricula: string | null;
  descripcion: string | null;
  estado_nro: number | null;
  estado_desc: string | null;
  tamano_lote: number | null;
  pedidos_pendientes: number | null;
  services_pendientes: number | null;
  last_gps_lat: number | null;
  last_gps_lng: number | null;
  last_gps_datetime: string | null;
  activo: boolean;
  oculto_operativo: boolean;
  inactivo_del_dia: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte una fila de moviles_dia en el shape MovilData que usan los
 * componentes del dashboard y el hook de realtime.
 *
 * Reglas:
 *  - color se deja vacío deliberadamente. El color real (capacity/status-derived)
 *    lo calcula MapView.getMovilColor(movil) a partir de estadoNro + tamanoLote +
 *    pedidosAsignados. Asignar aquí un color "arcoíris" por movil_id sobreescribía
 *    esa lógica y producía colores incorrectos.
 *  - currentPosition solo se construye cuando AMBAS coordenadas están presentes.
 *  - Counts con null → 0 (el móvil existe pero no tiene asignaciones hoy).
 */
export function mapMovilDiaRowToMovilData(row: MovilDiaRow): MovilData {
  const currentPosition =
    row.last_gps_lat !== null && row.last_gps_lng !== null
      ? {
          identificador: row.movil_id,
          origen: 'moviles_dia',
          coordX: row.last_gps_lat,
          coordY: row.last_gps_lng,
          fechaInsLog: row.last_gps_datetime ?? '',
          auxIn2: '',
          distRecorrida: 0,
        }
      : undefined;

  return {
    id: row.movil_id,
    name: row.descripcion ?? String(row.movil_id),
    // color vacío: MapView.getMovilColor(movil) lo calcula de estadoNro+tamanoLote+pedidosAsignados.
    color: '',
    empresaFleteraId: row.empresa_fletera_id ?? undefined,
    matricula: row.matricula ?? undefined,
    estadoNro: row.estado_nro ?? undefined,
    estadoDesc: row.estado_desc ?? undefined,
    tamanoLote: row.tamano_lote ?? undefined,
    pedidosAsignados: row.pedidos_pendientes ?? 0,
    cant_ped: row.pedidos_pendientes ?? 0,
    cant_serv: row.services_pendientes ?? 0,
    currentPosition,
    activo: row.activo,
    ocultoOperativo: row.oculto_operativo,
    inactivoDelDia: row.inactivo_del_dia,
  };
}
