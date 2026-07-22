/**
 * Cálculo de la demora asignado→cumplido con fallback DERIVADO (OQ2/OQ4/AC8)
 * y de la DEMORA EFECTIVA con la regla de agendados (2026-07-22).
 *
 * Demora bruta — prioridad:
 *  1. fch_hora_asignado (CAMPO) — demora = fin - asignado.
 *  2. demora_movil_desde_asignacion_mins (DERIVADO) — usado tal cual.
 *  3. Ninguno calculable → excluir con motivo 'sin_asignado_calculable'.
 * Demora bruta negativa (anticipación) en cualquiera de los 2 casos → excluir
 * con motivo 'demora_negativa' (no se clampea a 0 ni se registra tal cual —
 * sesgaría mediana/p90). Ver OQ4 en el plan.
 *
 * Demora efectiva (métrica principal de los promedios):
 *  Si asignado + UMBRAL_AGENDADO_MINS < fch_hora_para → pedido AGENDADO: el
 *  reloj arranca en la para (reloj_inicio='PARA') y la efectiva es
 *  fin - para, clampeada a 0 (entregar antes del compromiso no genera crédito
 *  negativo). Si no (pedido inmediato o para inexistente/ inválida), el reloj
 *  arranca en el asignado y la efectiva coincide con la bruta.
 *  En DERIVADO el asignado implícito se reconstruye como fin - demora AS400.
 *  atraso_vs_para = fin - para CON signo (negativo = entregó antes); null si
 *  no hay para válida.
 */

export const UMBRAL_AGENDADO_MINS = 60;

export type RelojInicio = 'ASIGNADO' | 'PARA';

export type DemoraResult =
  | {
      ok: true;
      demoraMins: number;
      demoraEfectivaMins: number;
      atrasoVsParaMins: number | null;
      relojInicio: RelojInicio;
      source: 'CAMPO' | 'DERIVADO';
      fchHoraAsignado: string | null;
    }
  | { ok: false; motivo: 'sin_asignado_calculable' | 'demora_negativa' };

export interface ComputeDemoraInput {
  fchHoraFinalizacion: string; // ISO no-null (ya filtrado por el caller)
  fchHoraAsignado: string | null;
  demoraMovilDesdeAsignacionMins: number | null;
  fchHoraPara?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeDemora(input: ComputeDemoraInput): DemoraResult {
  const { fchHoraFinalizacion, fchHoraAsignado, demoraMovilDesdeAsignacionMins, fchHoraPara } = input;

  const finMs = new Date(fchHoraFinalizacion).getTime();

  let demoraMins: number;
  let source: 'CAMPO' | 'DERIVADO';
  let asignadoOut: string | null;
  let asignadoMs: number;

  if (fchHoraAsignado) {
    const asignado = new Date(fchHoraAsignado).getTime();
    if (Number.isNaN(finMs) || Number.isNaN(asignado)) {
      return { ok: false, motivo: 'sin_asignado_calculable' };
    }
    demoraMins = (finMs - asignado) / 60000;
    source = 'CAMPO';
    asignadoOut = fchHoraAsignado;
    asignadoMs = asignado;
  } else if (demoraMovilDesdeAsignacionMins != null) {
    if (Number.isNaN(finMs)) {
      return { ok: false, motivo: 'sin_asignado_calculable' };
    }
    demoraMins = demoraMovilDesdeAsignacionMins;
    source = 'DERIVADO';
    asignadoOut = null;
    // Asignado implícito para poder aplicar la regla de agendados
    asignadoMs = finMs - demoraMovilDesdeAsignacionMins * 60000;
  } else {
    return { ok: false, motivo: 'sin_asignado_calculable' };
  }

  if (demoraMins < 0) {
    return { ok: false, motivo: 'demora_negativa' };
  }

  // ── Regla de agendados ──────────────────────────────────────────────
  const paraMs = fchHoraPara ? new Date(fchHoraPara).getTime() : NaN;
  let relojInicio: RelojInicio = 'ASIGNADO';
  let demoraEfectivaMins = demoraMins;
  let atrasoVsParaMins: number | null = null;

  if (!Number.isNaN(paraMs)) {
    atrasoVsParaMins = round2((finMs - paraMs) / 60000);
    if (asignadoMs + UMBRAL_AGENDADO_MINS * 60000 < paraMs) {
      relojInicio = 'PARA';
      demoraEfectivaMins = Math.max(0, (finMs - paraMs) / 60000);
    }
  }

  return {
    ok: true,
    demoraMins: round2(demoraMins),
    demoraEfectivaMins: round2(demoraEfectivaMins),
    atrasoVsParaMins,
    relojInicio,
    source,
    fchHoraAsignado: asignadoOut,
  };
}
