/**
 * Tests unitarios para lib/movil-estados.ts
 *
 * Verifica: MOVIL_ESTADOS_INACTIVOS, MOVIL_ESTADOS_INACTIVOS_ARRAY, esMovilInactivo()
 */

import { describe, it, expect } from 'vitest';
import {
  MOVIL_ESTADOS_INACTIVOS,
  MOVIL_ESTADOS_INACTIVOS_ARRAY,
  esMovilInactivo,
} from './movil-estados';

describe('MOVIL_ESTADOS_INACTIVOS', () => {
  it('contiene los 3 estados inactivos: 3, 5, 15', () => {
    expect(MOVIL_ESTADOS_INACTIVOS.has(3)).toBe(true);
    expect(MOVIL_ESTADOS_INACTIVOS.has(5)).toBe(true);
    expect(MOVIL_ESTADOS_INACTIVOS.has(15)).toBe(true);
  });

  it('no contiene estados activos comunes', () => {
    expect(MOVIL_ESTADOS_INACTIVOS.has(0)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(1)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(2)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(4)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(6)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(14)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(16)).toBe(false);
    expect(MOVIL_ESTADOS_INACTIVOS.has(99)).toBe(false);
  });

  it('tiene exactamente 3 elementos', () => {
    expect(MOVIL_ESTADOS_INACTIVOS.size).toBe(3);
  });
});

describe('MOVIL_ESTADOS_INACTIVOS_ARRAY', () => {
  it('tiene los mismos valores que el Set: [3, 5, 15]', () => {
    expect(MOVIL_ESTADOS_INACTIVOS_ARRAY).toEqual([3, 5, 15]);
  });

  it('es un array (para uso en queries SQL/Supabase .in())', () => {
    expect(Array.isArray(MOVIL_ESTADOS_INACTIVOS_ARRAY)).toBe(true);
  });
});

describe('esMovilInactivo()', () => {
  it('returns true para estado_nro = 3', () => {
    expect(esMovilInactivo(3)).toBe(true);
  });

  it('returns true para estado_nro = 5', () => {
    expect(esMovilInactivo(5)).toBe(true);
  });

  it('returns true para estado_nro = 15', () => {
    expect(esMovilInactivo(15)).toBe(true);
  });

  it('returns false para estado_nro = 0', () => {
    expect(esMovilInactivo(0)).toBe(false);
  });

  it('returns false para estado_nro = 1', () => {
    expect(esMovilInactivo(1)).toBe(false);
  });

  it('returns false para estado_nro = 2', () => {
    expect(esMovilInactivo(2)).toBe(false);
  });

  it('returns false para estado_nro = 4', () => {
    expect(esMovilInactivo(4)).toBe(false);
  });

  it('returns false para estado_nro = 6', () => {
    expect(esMovilInactivo(6)).toBe(false);
  });

  it('returns false para estado_nro = 14', () => {
    expect(esMovilInactivo(14)).toBe(false);
  });

  it('returns false para estado_nro = 16', () => {
    expect(esMovilInactivo(16)).toBe(false);
  });

  it('returns false para null (asumir activo si no hay dato)', () => {
    expect(esMovilInactivo(null)).toBe(false);
  });

  it('returns false para undefined (asumir activo si no hay dato)', () => {
    expect(esMovilInactivo(undefined)).toBe(false);
  });
});
