/**
 * Mapper: fila de la vista moviles_dia → MovilData del dashboard.
 *
 * Propósito: capa de traducción entre el read model de Supabase y la forma
 * que consumen los componentes y hooks del dashboard. No hace I/O.
 */

import type { MovilData } from '@/types/index';

// ─────────────────────────────────────────────────────────────────────────────
// Color helper (lógica legacy de MapView.getMovilColor — sin dep React)
// ─────────────────────────────────────────────────────────────────────────────

function computeMovilColor(
  estadoNro: number | null,
  tamanoLote: number | null,
  pedidosAsignados: number,
): string {
  if (estadoNro === 3) return '#9CA3AF';
  if (estadoNro === 4) return '#8B5CF6';
  const tamano = tamanoLote ?? 0;
  if (tamano > 0 && pedidosAsignados >= tamano) return '#1F2937';
  const tamanoForPct = tamano || 6;
  const capacidadRestante = tamanoForPct - pedidosAsignados;
  const porcentajeDisponible = (capacidadRestante / tamanoForPct) * 100;
  return porcentajeDisponible < 50 ? '#F59E0B' : '#22C55E';
}

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
 *  - color se computa con computeMovilColor (lógica legacy de MapView.getMovilColor)
 *    a partir de estadoNro + tamanoLote + pedidosAsignados. Los componentes que
 *    renderizan m.color directamente (ej: colapsable items) obtienen el color correcto.
 *  - currentPosition solo se construye cuando AMBAS coordenadas están presentes.
 *  - Counts con null → 0 (el móvil existe pero no tiene asignaciones hoy).
 */
export function mapMovilDiaRowToMovilData(row: MovilDiaRow): MovilData {
  const pedidosAsignados = row.pedidos_pendientes ?? 0;

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
    color: computeMovilColor(row.estado_nro ?? null, row.tamano_lote ?? null, pedidosAsignados),
    empresaFleteraId: row.empresa_fletera_id ?? undefined,
    matricula: row.matricula ?? undefined,
    estadoNro: row.estado_nro ?? undefined,
    estadoDesc: row.estado_desc ?? undefined,
    tamanoLote: row.tamano_lote ?? undefined,
    pedidosAsignados,
    capacidad: pedidosAsignados,
    cant_ped: pedidosAsignados,
    cant_serv: row.services_pendientes ?? 0,
    currentPosition,
    activo: row.activo,
    ocultoOperativo: row.oculto_operativo,
    inactivoDelDia: row.inactivo_del_dia,
  };
}
