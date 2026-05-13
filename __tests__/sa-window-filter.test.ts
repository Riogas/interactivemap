import { describe, it, expect } from 'vitest';
import { isWithinSaWindow } from '../lib/sa-window-filter';

const now = new Date('2026-05-11T14:00:00.000Z');
const minutosAntes = 30; // ventana de 30 minutos

describe('isWithinSaWindow', () => {
  // ── Backwards compatibility (sin filtro) ──────────────────────────────────

  it('retorna true cuando minutosAntes es null (sin filtro)', () => {
    const horaPara = new Date('2026-05-11T10:00:00.000Z'); // pasado
    expect(isWithinSaWindow(horaPara, now, null)).toBe(true);
  });

  it('retorna true cuando minutosAntes es 0 (sin filtro)', () => {
    const horaPara = new Date('2026-05-11T10:00:00.000Z'); // pasado
    expect(isWithinSaWindow(horaPara, now, 0)).toBe(true);
  });

  // ── fchHoraPara null/invalida ─────────────────────────────────────────────

  it('retorna true cuando fchHoraPara es null (no filtrar por falta de dato)', () => {
    expect(isWithinSaWindow(null, now, minutosAntes)).toBe(true);
  });

  it('retorna true cuando fchHoraPara es string invalido', () => {
    expect(isWithinSaWindow('no-es-una-fecha', now, minutosAntes)).toBe(true);
  });

  // ── Casos fuera de ventana ────────────────────────────────────────────────

  it('retorna false cuando fchHoraPara es futuro lejano (> now + minutosAntes)', () => {
    // 14:31 — 31 minutos despues de now → fuera de la ventana de 30 min
    const horaPara = new Date('2026-05-11T14:31:00.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(false);
  });

  // ── Casos dentro de ventana ───────────────────────────────────────────────

  it('retorna true cuando fchHoraPara esta en el pasado (atrasado, incluido en la ventana)', () => {
    // 13:59 — 1 minuto antes de now=14:00 → atrasado, debe seguir visible
    const horaPara = new Date('2026-05-11T13:59:59.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(true);
  });

  it('retorna true cuando fchHoraPara esta muy en el pasado (atrasado de horas)', () => {
    // 10:00 — 4 horas antes de now → atrasado fuerte, debe seguir visible
    const horaPara = new Date('2026-05-11T10:00:00.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(true);
  });

  it('retorna true cuando fchHoraPara === now', () => {
    // Exactamente en now → en hora, valido
    expect(isWithinSaWindow(now, now, minutosAntes)).toBe(true);
  });

  it('retorna true cuando fchHoraPara === now + minutosAntes (borde superior)', () => {
    // 14:30 — exactamente en el tope de la ventana → valido
    const horaPara = new Date('2026-05-11T14:30:00.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(true);
  });

  it('retorna true cuando fchHoraPara esta dentro de la ventana', () => {
    // 14:15 — 15 minutos despues de now, dentro de los 30 min
    const horaPara = new Date('2026-05-11T14:15:00.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(true);
  });

  // ── Formato string ────────────────────────────────────────────────────────

  it('acepta fchHoraPara como string ISO y devuelve el mismo resultado que Date', () => {
    const horaParaStr = '2026-05-11T14:15:00.000Z';
    const horaParaDate = new Date(horaParaStr);
    expect(isWithinSaWindow(horaParaStr, now, minutosAntes)).toBe(
      isWithinSaWindow(horaParaDate, now, minutosAntes)
    );
  });

  it('acepta string ISO en el pasado y lo deja visible (atrasado)', () => {
    const horaParaStr = '2026-05-11T13:00:00.000Z'; // 1 hora antes
    expect(isWithinSaWindow(horaParaStr, now, minutosAntes)).toBe(true);
  });

  // ── Ventana de 1 minuto ───────────────────────────────────────────────────

  it('retorna false con ventana de 1 minuto y horaPara en 2 minutos', () => {
    const horaPara = new Date('2026-05-11T14:02:00.000Z');
    expect(isWithinSaWindow(horaPara, now, 1)).toBe(false);
  });

  it('retorna true con ventana de 1 minuto y horaPara en 30 segundos', () => {
    const horaPara = new Date('2026-05-11T14:00:30.000Z');
    expect(isWithinSaWindow(horaPara, now, 1)).toBe(true);
  });

  // ── Convencion DB: hora local Uruguay con offset +00 incorrecto ───────────
  // Estos tests verifican el fix del bug reportado:
  // La DB guarda "2026-05-13 13:00:00+00" significando 13:00 hora local Uruguay
  // (no 13:00 UTC). parseDbDate() stripea el offset para que JS interprete
  // como hora local, igual que utils/pedidoDelay.ts:42.
  // Nota: estos tests asumen TZ=America/Montevideo en el runner (maquina de desarrollo).

  it('[bug] retorna false cuando DB format +00 esta fuera de ventana (caso del usuario)', () => {
    // fch_hora_para = "2026-05-13 13:00:00+00" = 13:00 local Uruguay = 16:00 UTC
    // serverNow = 09:23 Uruguay = 12:23 UTC
    // windowEnd = 12:23 UTC + 60 min = 13:23 UTC
    // 16:00 UTC > 13:23 UTC → fuera de ventana → false
    const serverNow = new Date('2026-05-13T12:23:00Z');
    expect(isWithinSaWindow('2026-05-13 13:00:00+00', serverNow, 60)).toBe(false);
  });

  it('retorna true cuando DB format +00 esta dentro de ventana', () => {
    // fch_hora_para = "2026-05-13 10:00:00+00" = 10:00 local Uruguay = 13:00 UTC
    // serverNow = 09:30 Uruguay = 12:30 UTC
    // windowEnd = 12:30 UTC + 60 min = 13:30 UTC
    // 13:00 UTC <= 13:30 UTC → dentro de ventana → true
    const serverNow = new Date('2026-05-13T12:30:00Z');
    expect(isWithinSaWindow('2026-05-13 10:00:00+00', serverNow, 60)).toBe(true);
  });

  it('retorna true cuando DB format +00 esta atrasado (ya paso la hora)', () => {
    // fch_hora_para = "2026-05-13 08:00:00+00" = 08:00 local Uruguay = 11:00 UTC
    // serverNow = 09:30 Uruguay = 12:30 UTC
    // windowEnd = 12:30 UTC + 60 min = 13:30 UTC
    // 11:00 UTC <= 13:30 UTC → atrasado, visible → true
    const serverNow = new Date('2026-05-13T12:30:00Z');
    expect(isWithinSaWindow('2026-05-13 08:00:00+00', serverNow, 60)).toBe(true);
  });

  it('retorna false cuando DB format -03 esta fuera de ventana', () => {
    // fch_hora_para = "2026-05-13 13:00:00-03" = 13:00 local (offset -03 strippeado)
    // Mismo resultado que el caso +00 en maquina Montevideo: 13:00 local = 16:00 UTC
    const serverNow = new Date('2026-05-13T12:23:00Z');
    expect(isWithinSaWindow('2026-05-13 13:00:00-03', serverNow, 60)).toBe(false);
  });

  it('retorna true (visible) cuando string con Z esta dentro de ventana (retro-compat UTC)', () => {
    // String con Z = UTC explicito. El regex NO stripea Z.
    // fch_hora_para = "2026-05-13T13:00:00Z" = 13:00 UTC
    // serverNow = 12:23 UTC, windowEnd = 13:23 UTC
    // 13:00 UTC <= 13:23 UTC → dentro de ventana → true (visible, no filtrado)
    const serverNow = new Date('2026-05-13T12:23:00Z');
    expect(isWithinSaWindow('2026-05-13T13:00:00Z', serverNow, 60)).toBe(true);
  });
});
