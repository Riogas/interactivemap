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

  it('retorna false cuando fchHoraPara esta en el pasado (< now)', () => {
    // 13:59 — 1 minuto antes de now=14:00 → ya vencio
    const horaPara = new Date('2026-05-11T13:59:59.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(false);
  });

  it('retorna false cuando fchHoraPara es futuro lejano (> now + minutosAntes)', () => {
    // 14:31 — 31 minutos despues de now → fuera de la ventana de 30 min
    const horaPara = new Date('2026-05-11T14:31:00.000Z');
    expect(isWithinSaWindow(horaPara, now, minutosAntes)).toBe(false);
  });

  // ── Casos dentro de ventana ───────────────────────────────────────────────

  it('retorna true cuando fchHoraPara === now (borde inferior)', () => {
    // Exactamente en now → valido (now <= horaPara)
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

  it('filtra correctamente con string ISO en el pasado', () => {
    const horaParaStr = '2026-05-11T13:00:00.000Z'; // 1 hora antes
    expect(isWithinSaWindow(horaParaStr, now, minutosAntes)).toBe(false);
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
});
