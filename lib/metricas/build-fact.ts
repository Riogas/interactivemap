/**
 * Orquesta la construcción de un hecho de metricas_cumplimiento a partir de una
 * fila de origen (pedidos/services), pura y testeable (sin I/O — recibe el
 * chofer ya resuelto en ctx). AC6/AC7/AC8/AC9/AC11.
 */

import { computeDemora, type RelojInicio } from './demora';
import { clasificarTipoServicio, type TipoServicio } from './tipo-servicio';
import { montevideoDateOf, daysAgoMontevideo } from '@/lib/date-utils';

export const REPROCESS_DIAS = 3;

export interface SourceRow {
  id: number | string;
  escenario: number | null;
  servicio_nombre: string | null;
  movil: number | null;
  zona_nro: number | null;
  empresa_fletera_id: number | null;
  orden_cancelacion: string | null;
  estado_nro: number | null;
  sub_estado_nro: number | null;
  fch_hora_asignado: string | null;
  fch_hora_finalizacion: string | null;
  fch_hora_para: string | null;
  demora_movil_desde_asignacion_mins: number | null;
}

export interface MetricaFact {
  origen: 'PEDIDO' | 'SERVICE';
  pedido_id: number;
  escenario: number;
  fecha: string;
  tipo_servicio: TipoServicio;
  servicio_nombre: string | null;
  movil: number | null;
  zona_nro: number | null;
  empresa_fletera_id: number | null;
  chofer: string | null;
  fch_hora_asignado: string | null;
  fch_hora_finalizacion: string;
  fch_hora_para: string | null;
  demora_mins: number;
  demora_efectiva_mins: number;
  atraso_vs_para_mins: number | null;
  reloj_inicio: RelojInicio;
  asignado_source: 'CAMPO' | 'DERIVADO';
}

export type BuildFactMotivo =
  | 'cancelado'
  | 'no_cumplido'
  | 'sin_escenario'
  | 'sin_asignado_calculable'
  | 'demora_negativa';

export type BuildFactResult =
  | { ok: true; fact: MetricaFact }
  | { ok: false; motivo: BuildFactMotivo };

export function buildFact(
  row: SourceRow,
  origen: 'PEDIDO' | 'SERVICE',
  ctx: { chofer: string | null },
): BuildFactResult {
  if (row.orden_cancelacion === 'S') {
    return { ok: false, motivo: 'cancelado' };
  }
  // Cumplido genuino = estado_nro 2 (cumplido) AND sub_estado_nro 3. Los demás
  // sub_estados pueden ser fruta (cierres en lote, etc.) y ensucian los tiempos.
  if (Number(row.estado_nro) !== 2 || Number(row.sub_estado_nro) !== 3) {
    return { ok: false, motivo: 'no_cumplido' };
  }
  if (!row.fch_hora_finalizacion) {
    return { ok: false, motivo: 'no_cumplido' };
  }
  if (row.escenario == null) {
    return { ok: false, motivo: 'sin_escenario' };
  }

  const demora = computeDemora({
    fchHoraFinalizacion: row.fch_hora_finalizacion,
    fchHoraAsignado: row.fch_hora_asignado,
    demoraMovilDesdeAsignacionMins: row.demora_movil_desde_asignacion_mins,
    fchHoraPara: row.fch_hora_para,
  });

  if (!demora.ok) {
    return { ok: false, motivo: demora.motivo };
  }

  const fact: MetricaFact = {
    origen,
    pedido_id: Number(row.id),
    escenario: row.escenario,
    fecha: montevideoDateOf(row.fch_hora_finalizacion),
    tipo_servicio: clasificarTipoServicio(origen, row.servicio_nombre),
    servicio_nombre: row.servicio_nombre,
    movil: row.movil,
    zona_nro: row.zona_nro,
    empresa_fletera_id: row.empresa_fletera_id,
    chofer: ctx.chofer,
    fch_hora_asignado: demora.fchHoraAsignado,
    fch_hora_finalizacion: row.fch_hora_finalizacion,
    fch_hora_para: row.fch_hora_para,
    demora_mins: demora.demoraMins,
    demora_efectiva_mins: demora.demoraEfectivaMins,
    atraso_vs_para_mins: demora.atrasoVsParaMins,
    reloj_inicio: demora.relojInicio,
    asignado_source: demora.source,
  };

  return { ok: true, fact };
}

/**
 * Dedup por PK `${origen}|${pedido_id}|${escenario}` (último gana). Garantiza
 * AC6: no puede haber 2 filas con la misma PK en el batch a upsertear.
 */
export function dedupByPk(facts: MetricaFact[]): MetricaFact[] {
  const byKey = new Map<string, MetricaFact>();
  for (const fact of facts) {
    const key = `${fact.origen}|${fact.pedido_id}|${fact.escenario}`;
    byKey.set(key, fact);
  }
  return [...byKey.values()];
}

/**
 * Rango default del run sin params: día cerrado anterior + reproceso de los
 * últimos REPROCESS_DIAS días (AC5) → [hoy-REPROCESS_DIAS .. hoy-1].
 */
export function defaultRunRange(now?: Date): { desde: string; hasta: string } {
  const hasta = daysAgoMontevideo(1, now);
  const desde = daysAgoMontevideo(REPROCESS_DIAS, now);
  return { desde, hasta };
}
