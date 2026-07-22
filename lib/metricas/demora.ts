/**
 * Cálculo de la demora asignado→cumplido con fallback DERIVADO (OQ2/OQ4/AC8).
 *
 * Prioridad:
 *  1. fch_hora_asignado (CAMPO) — demora = fin - asignado.
 *  2. demora_movil_desde_asignacion_mins (DERIVADO) — usado tal cual.
 *  3. Ninguno calculable → excluir con motivo 'sin_asignado_calculable'.
 * Demora negativa (anticipación) en cualquiera de los 2 casos → excluir con
 * motivo 'demora_negativa' (no se clampea a 0 ni se registra tal cual — sesgaría
 * mediana/p90). Ver OQ4 en el plan.
 */

export type DemoraResult =
  | { ok: true; demoraMins: number; source: 'CAMPO' | 'DERIVADO'; fchHoraAsignado: string | null }
  | { ok: false; motivo: 'sin_asignado_calculable' | 'demora_negativa' };

export interface ComputeDemoraInput {
  fchHoraFinalizacion: string; // ISO no-null (ya filtrado por el caller)
  fchHoraAsignado: string | null;
  demoraMovilDesdeAsignacionMins: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeDemora(input: ComputeDemoraInput): DemoraResult {
  const { fchHoraFinalizacion, fchHoraAsignado, demoraMovilDesdeAsignacionMins } = input;

  let demoraMins: number;
  let source: 'CAMPO' | 'DERIVADO';
  let asignadoOut: string | null;

  if (fchHoraAsignado) {
    const fin = new Date(fchHoraFinalizacion).getTime();
    const asignado = new Date(fchHoraAsignado).getTime();
    if (Number.isNaN(fin) || Number.isNaN(asignado)) {
      return { ok: false, motivo: 'sin_asignado_calculable' };
    }
    demoraMins = (fin - asignado) / 60000;
    source = 'CAMPO';
    asignadoOut = fchHoraAsignado;
  } else if (demoraMovilDesdeAsignacionMins != null) {
    demoraMins = demoraMovilDesdeAsignacionMins;
    source = 'DERIVADO';
    asignadoOut = null;
  } else {
    return { ok: false, motivo: 'sin_asignado_calculable' };
  }

  if (demoraMins < 0) {
    return { ok: false, motivo: 'demora_negativa' };
  }

  return { ok: true, demoraMins: round2(demoraMins), source, fchHoraAsignado: asignadoOut };
}
