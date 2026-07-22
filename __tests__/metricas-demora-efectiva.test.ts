/**
 * Tests de la DEMORA EFECTIVA (regla de agendados con FchHoraPara).
 *
 * Regla acordada con el usuario (2026-07-22):
 *   Si fch_hora_asignado + 60 min < fch_hora_para → el pedido es AGENDADO y el
 *   reloj arranca en fch_hora_para (reloj_inicio='PARA'). Si no, arranca en el
 *   asignado (reloj_inicio='ASIGNADO').
 *
 *   demora_efectiva_mins = fin − reloj_inicio, clampeada a 0 (entregar antes de
 *   la para no genera crédito negativo en los promedios).
 *   atraso_vs_para_mins  = fin − para, CON signo (negativo = entregó antes),
 *   null si no hay para válida.
 *
 * Ejemplo canónico del usuario: asignado 10:00, para 13:00, entregado 13:30 →
 * demora bruta 210 min, efectiva 30 min, atraso +30.
 */

import { describe, it, expect } from 'vitest';
import { computeDemora, UMBRAL_AGENDADO_MINS } from '../lib/metricas/demora';

// Helper: ISO UTC del mismo día (los cálculos son instante-a-instante,
// la zona no juega acá)
const T = (hhmm: string) => `2026-07-21T${hhmm}:00.000Z`;

describe('demora efectiva — regla de agendados (asignado + 60min < para)', () => {
  it('ejemplo canónico: asignado 10:00, para 13:00, entregado 13:30 → efectiva 30, reloj PARA', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: T('10:00'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demoraMins).toBe(210); // bruta se conserva
    expect(r.demoraEfectivaMins).toBe(30); // la métrica principal
    expect(r.atrasoVsParaMins).toBe(30);
    expect(r.relojInicio).toBe('PARA');
  });

  it('slack menor a 60 min: asignado 12:30, para 13:00 → reloj ASIGNADO, efectiva = bruta', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: T('12:30'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demoraEfectivaMins).toBe(60);
    expect(r.relojInicio).toBe('ASIGNADO');
    expect(r.atrasoVsParaMins).toBe(30); // el atraso vs compromiso se informa igual
  });

  it('borde exacto: asignado + 60 == para NO es agendado (la regla es estricta <)', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: T('12:00'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relojInicio).toBe('ASIGNADO');
    expect(r.demoraEfectivaMins).toBe(90);
  });

  it('agendado entregado ANTES de la para: efectiva clampea a 0, atraso queda negativo', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('12:40'),
      fchHoraAsignado: T('10:00'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demoraEfectivaMins).toBe(0);
    expect(r.atrasoVsParaMins).toBe(-20);
    expect(r.relojInicio).toBe('PARA');
  });

  it('sin fchHoraPara: efectiva = bruta, atraso null, reloj ASIGNADO', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: T('12:00'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demoraEfectivaMins).toBe(r.demoraMins);
    expect(r.atrasoVsParaMins).toBeNull();
    expect(r.relojInicio).toBe('ASIGNADO');
  });

  it('fchHoraPara inválida (no parseable) se trata como sin para', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: T('12:00'),
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: 'no-es-fecha',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.demoraEfectivaMins).toBe(r.demoraMins);
    expect(r.atrasoVsParaMins).toBeNull();
    expect(r.relojInicio).toBe('ASIGNADO');
  });

  it('DERIVADO: reconstruye el asignado implícito (fin − demora AS400) y aplica la misma regla', () => {
    // fin 13:30, demora AS400 210 → asignado implícito 10:00; 10:00+60 < 13:00 → agendado
    const r = computeDemora({
      fchHoraFinalizacion: T('13:30'),
      fchHoraAsignado: null,
      demoraMovilDesdeAsignacionMins: 210,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('DERIVADO');
    expect(r.demoraMins).toBe(210);
    expect(r.demoraEfectivaMins).toBe(30);
    expect(r.relojInicio).toBe('PARA');
  });

  it('la exclusión por demora bruta negativa se mantiene aunque haya para', () => {
    const r = computeDemora({
      fchHoraFinalizacion: T('10:00'),
      fchHoraAsignado: T('11:00'), // asignado después de finalizar → dato corrupto
      demoraMovilDesdeAsignacionMins: null,
      fchHoraPara: T('13:00'),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('demora_negativa');
  });

  it('el umbral exportado es 60 minutos (documenta la regla)', () => {
    expect(UMBRAL_AGENDADO_MINS).toBe(60);
  });
});
