/**
 * Tests unitarios para lib/empresas-del-usuario.ts
 *
 * Cubre:
 * 1. Helper getEmpresasParamForUpstream — nombres (primer intento) y IDs (fallback)
 * 2. Helper getEmpresasParamFromIds — solo IDs
 * 3. Edge cases: null, vacío, mezcla de datos inválidos
 */

import { describe, it, expect } from 'vitest';
import {
  getEmpresasParamForUpstream,
  getEmpresasParamFromIds,
  type EmpresaEntry,
} from '../lib/empresas-del-usuario';

// ─────────────────────────────────────────────────────────────────────────────
// getEmpresasParamForUpstream
// ─────────────────────────────────────────────────────────────────────────────

describe('getEmpresasParamForUpstream', () => {
  const empresas: EmpresaEntry[] = [
    { nombre: 'FLETERA_NORTE', valor: 70 },
    { nombre: 'FLETERA_SUR', valor: 71 },
  ];

  it('devuelve nombres cuando hay empresas con nombre válido (primer intento)', () => {
    const result = getEmpresasParamForUpstream(empresas, [70, 71]);
    expect(result).toBe('FLETERA_NORTE,FLETERA_SUR');
  });

  it('usa fallback de IDs cuando el array de empresas está vacío', () => {
    const result = getEmpresasParamForUpstream([], [70, 71]);
    expect(result).toBe('70,71');
  });

  it('usa fallback de IDs cuando empresas es null', () => {
    const result = getEmpresasParamForUpstream(null, [70, 71]);
    expect(result).toBe('70,71');
  });

  it('usa fallback de IDs cuando empresas es undefined', () => {
    const result = getEmpresasParamForUpstream(undefined, [70, 71]);
    expect(result).toBe('70,71');
  });

  it('devuelve string vacío cuando no hay nombres ni IDs', () => {
    const result = getEmpresasParamForUpstream(null, null);
    expect(result).toBe('');
  });

  it('devuelve string vacío cuando ambos arrays están vacíos', () => {
    const result = getEmpresasParamForUpstream([], []);
    expect(result).toBe('');
  });

  it('filtra nombres vacíos y usa fallback de IDs si todos son vacíos', () => {
    const empresasConNombresVacios: EmpresaEntry[] = [
      { nombre: '  ', valor: 70 },
      { nombre: '', valor: 71 },
    ];
    const result = getEmpresasParamForUpstream(empresasConNombresVacios, [70, 71]);
    expect(result).toBe('70,71');
  });

  it('devuelve string vacío cuando empresas tiene nombres vacíos y no hay IDs', () => {
    const empresasConNombresVacios: EmpresaEntry[] = [
      { nombre: '', valor: 70 },
    ];
    const result = getEmpresasParamForUpstream(empresasConNombresVacios, null);
    expect(result).toBe('');
  });

  it('maneja una sola empresa correctamente', () => {
    const result = getEmpresasParamForUpstream(
      [{ nombre: 'UNICA', valor: 99 }],
      [99],
    );
    expect(result).toBe('UNICA');
  });

  it('trimea espacios en los nombres', () => {
    const result = getEmpresasParamForUpstream(
      [{ nombre: '  FLETERA_NORTE  ', valor: 70 }],
      [70],
    );
    expect(result).toBe('FLETERA_NORTE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEmpresasParamFromIds
// ─────────────────────────────────────────────────────────────────────────────

describe('getEmpresasParamFromIds', () => {
  it('devuelve IDs como string separado por comas', () => {
    expect(getEmpresasParamFromIds([70, 71, 72])).toBe('70,71,72');
  });

  it('devuelve string vacío con array vacío', () => {
    expect(getEmpresasParamFromIds([])).toBe('');
  });

  it('devuelve string vacío con null', () => {
    expect(getEmpresasParamFromIds(null)).toBe('');
  });

  it('devuelve string vacío con undefined', () => {
    expect(getEmpresasParamFromIds(undefined)).toBe('');
  });

  it('maneja un solo ID', () => {
    expect(getEmpresasParamFromIds([42])).toBe('42');
  });
});
