/**
 * Tests unitarios para lib/moviles/visibility.ts
 *
 * Cobertura:
 *  - isMovilActiveForUI
 *  - isMovilHidden
 *  - getHiddenMovilIds
 *  - getHiddenMovilIdsFromEstadosMap
 */

import { describe, it, expect } from 'vitest';
import {
  isMovilActiveForUI,
  isMovilHidden,
  getHiddenMovilIds,
  getHiddenMovilIdsFromEstadosMap,
} from '../lib/moviles/visibility';

// ─────────────────────────────────────────────────────────────────────────────
// isMovilActiveForUI
// ─────────────────────────────────────────────────────────────────────────────
describe('isMovilActiveForUI', () => {
  it('retorna true cuando estadoNro es null (sin estado asignado)', () => {
    expect(isMovilActiveForUI(null)).toBe(true);
  });

  it('retorna true cuando estadoNro es undefined', () => {
    expect(isMovilActiveForUI(undefined)).toBe(true);
  });

  it('retorna true para estadoNro 0 (activo, primer estado valido)', () => {
    expect(isMovilActiveForUI(0)).toBe(true);
  });

  it('retorna true para estadoNro 1 (activo operativo)', () => {
    expect(isMovilActiveForUI(1)).toBe(true);
  });

  it('retorna true para estadoNro 2 (activo en otro estado operativo)', () => {
    expect(isMovilActiveForUI(2)).toBe(true);
  });

  it('retorna true para estadoNro 4 (BAJA MOMENTANEA — operativo con distincion visual)', () => {
    expect(isMovilActiveForUI(4)).toBe(true);
  });

  it('retorna false para estadoNro 3 (no activo)', () => {
    expect(isMovilActiveForUI(3)).toBe(false);
  });

  it('retorna false para estadoNro 5', () => {
    expect(isMovilActiveForUI(5)).toBe(false);
  });

  it('retorna false para estadoNro 15 (estado especial no activo)', () => {
    expect(isMovilActiveForUI(15)).toBe(false);
  });

  it('retorna false para estadoNro arbitrario no-activo (99)', () => {
    expect(isMovilActiveForUI(99)).toBe(false);
  });

  it('retorna false para estadoNro negativo (-1)', () => {
    expect(isMovilActiveForUI(-1)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isMovilHidden
// ─────────────────────────────────────────────────────────────────────────────
describe('isMovilHidden', () => {
  it('NO oculta movil activo (estado 1) aunque tenga pedido asignado', () => {
    const movil = { id: 10, estadoNro: 1 };
    const pedidos = [{ movil: 10 }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('NO oculta movil activo (estado 0) con pedido asignado', () => {
    const movil = { id: 10, estadoNro: 0 };
    const pedidos = [{ movil: '10' }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('NO oculta movil inactivo (estado 3) sin pedidos ni services', () => {
    const movil = { id: 20, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('NO oculta movil inactivo (estado 3) sin pedidos y services undefined', () => {
    const movil = { id: 20, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    expect(isMovilHidden(movil, pedidos, undefined)).toBe(false);
  });

  it('OCULTA movil inactivo (estado 3) con pedido asignado — caso central del feature', () => {
    const movil = { id: 30, estadoNro: 3 };
    const pedidos = [{ movil: 30 }];
    expect(isMovilHidden(movil, pedidos)).toBe(true);
  });

  it('NO oculta movil estado 4 (baja momentanea, tratado como activo) con pedido asignado', () => {
    const movil = { id: 31, estadoNro: 4 };
    const pedidos = [{ movil: 31 }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('OCULTA movil inactivo (estado 5) con pedido asignado', () => {
    const movil = { id: 32, estadoNro: 5 };
    const pedidos = [{ movil: 32 }];
    expect(isMovilHidden(movil, pedidos)).toBe(true);
  });

  it('OCULTA movil inactivo (estado 3) con service asignado', () => {
    const movil = { id: 40, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services = [{ movil: 40 }];
    expect(isMovilHidden(movil, pedidos, services)).toBe(true);
  });

  it('OCULTA movil inactivo (estado 15) con service asignado', () => {
    const movil = { id: 41, estadoNro: 15 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services = [{ movil: 41 }];
    expect(isMovilHidden(movil, pedidos, services)).toBe(true);
  });

  it('NO oculta movil inactivo (estado 3) con pedidos de OTROS moviles (no del propio)', () => {
    const movil = { id: 50, estadoNro: 3 };
    const pedidos = [{ movil: 99 }, { movil: 77 }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('NO oculta movil inactivo (estado 3) con services de OTROS moviles', () => {
    const movil = { id: 50, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services = [{ movil: 99 }];
    expect(isMovilHidden(movil, pedidos, services)).toBe(false);
  });

  it('castea correctamente movil.id numerico vs pedido.movil como string', () => {
    // pedido.movil llega como string desde la API
    const movil = { id: 60, estadoNro: 3 };
    const pedidos = [{ movil: '60' }]; // string
    expect(isMovilHidden(movil, pedidos)).toBe(true);
  });

  it('castea correctamente movil.id numerico vs service.movil como string', () => {
    const movil = { id: 70, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services = [{ movil: '70' }]; // string
    expect(isMovilHidden(movil, pedidos, services)).toBe(true);
  });

  it('ignora pedidos con movil null en la comparacion', () => {
    const movil = { id: 80, estadoNro: 3 };
    const pedidos = [{ movil: null }, { movil: undefined }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });

  it('NO oculta movil inactivo con services vacio (array vacio, no undefined)', () => {
    const movil = { id: 90, estadoNro: 3 };
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services: Array<{ movil?: number | string | null }> = [];
    expect(isMovilHidden(movil, pedidos, services)).toBe(false);
  });

  it('movil con estadoNro null se considera activo y no oculto', () => {
    const movil = { id: 100, estadoNro: null };
    const pedidos = [{ movil: 100 }];
    expect(isMovilHidden(movil, pedidos)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getHiddenMovilIds
// ─────────────────────────────────────────────────────────────────────────────
describe('getHiddenMovilIds', () => {
  it('retorna Set vacio si no hay moviles', () => {
    const result = getHiddenMovilIds([], []);
    expect(result.size).toBe(0);
  });

  it('retorna Set vacio si todos los moviles son activos (aunque tengan pedidos)', () => {
    const moviles = [
      { id: 1, estadoNro: 0 },
      { id: 2, estadoNro: 1 },
      { id: 3, estadoNro: 2 },
    ];
    const pedidos = [{ movil: 1 }, { movil: 2 }, { movil: 3 }];
    const result = getHiddenMovilIds(moviles, pedidos);
    expect(result.size).toBe(0);
  });

  it('retorna Set vacio si moviles inactivos no tienen pedidos ni services', () => {
    const moviles = [
      { id: 10, estadoNro: 3 },
      { id: 11, estadoNro: 5 },
    ];
    const result = getHiddenMovilIds(moviles, []);
    expect(result.size).toBe(0);
  });

  it('construye Set correcto con moviles mixtos activos e inactivos con pedidos', () => {
    const moviles = [
      { id: 1, estadoNro: 1 },  // activo con pedido → NO oculto
      { id: 2, estadoNro: 3 },  // inactivo con pedido → oculto
      { id: 3, estadoNro: 3 },  // inactivo sin pedido → NO oculto
      { id: 4, estadoNro: 4 },  // activo (baja momentanea) con pedido → NO oculto
      { id: 5, estadoNro: 15 }, // inactivo con pedido → oculto
    ];
    const pedidos = [{ movil: 1 }, { movil: 2 }, { movil: 4 }, { movil: 5 }];
    const result = getHiddenMovilIds(moviles, pedidos);
    expect(result.size).toBe(2);
    expect(result.has(2)).toBe(true);
    expect(result.has(5)).toBe(true);
    expect(result.has(1)).toBe(false);
    expect(result.has(3)).toBe(false);
    expect(result.has(4)).toBe(false);
  });

  it('incluye movil inactivo oculto por service (no por pedido)', () => {
    const moviles = [{ id: 5, estadoNro: 3 }];
    const pedidos: Array<{ movil?: number | string | null }> = [];
    const services = [{ movil: 5 }];
    const result = getHiddenMovilIds(moviles, pedidos, services);
    expect(result.has(5)).toBe(true);
  });

  it('no incluye movil inactivo si pedidos son de otros moviles', () => {
    const moviles = [{ id: 6, estadoNro: 3 }];
    const pedidos = [{ movil: 99 }];
    const result = getHiddenMovilIds(moviles, pedidos);
    expect(result.has(6)).toBe(false);
  });

  it('los IDs en el Set son numericos (no strings)', () => {
    const moviles = [{ id: 7, estadoNro: 3 }];
    const pedidos = [{ movil: '7' }]; // string en pedido
    const result = getHiddenMovilIds(moviles, pedidos);
    expect(result.has(7)).toBe(true);
    // Asegura que la lookup numerica funciona
    expect(typeof [...result][0]).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getHiddenMovilIdsFromEstadosMap
// ─────────────────────────────────────────────────────────────────────────────
describe('getHiddenMovilIdsFromEstadosMap', () => {
  it('retorna Set vacio si el Map es vacio', () => {
    const result = getHiddenMovilIdsFromEstadosMap(new Map(), []);
    expect(result.size).toBe(0);
  });

  it('retorna Set vacio si el Map es null/undefined-like (size=0)', () => {
    const result = getHiddenMovilIdsFromEstadosMap(new Map(), [{ movil: '1' }]);
    expect(result.size).toBe(0);
  });

  it('no incluye moviles activos (estado 0/1/2) aunque tengan pedidos', () => {
    const estadosMap = new Map([
      ['10', 0],
      ['11', 1],
      ['12', 2],
    ]);
    const pedidos = [{ movil: '10' }, { movil: '11' }, { movil: '12' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.size).toBe(0);
  });

  it('incluye movil no-activo (estado 3) con pedido asignado — key como string', () => {
    const estadosMap = new Map([
      ['20', 3],
    ]);
    const pedidos = [{ movil: '20' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.has('20')).toBe(true);
  });

  it('NO incluye movil estado 4 (baja momentanea, tratado como activo) con service', () => {
    const estadosMap = new Map([
      ['30', 4],
    ]);
    const services = [{ movil: '30' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, [], services);
    expect(result.has('30')).toBe(false);
  });

  it('incluye movil no-activo (estado 5) con service asignado', () => {
    const estadosMap = new Map([
      ['31', 5],
    ]);
    const services = [{ movil: '31' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, [], services);
    expect(result.has('31')).toBe(true);
  });

  it('no incluye movil cuyo estadoNro es null (activo por defecto)', () => {
    // null en el map no puede ocurrir con Map<string, number>, pero podría
    // pasarse un Map con number|null. Si estadoNro pasara isMovilActiveForUI(null) → true
    // Verificamos que estados nulos (no incluibles en Map<string,number>) no rompen.
    const estadosMap = new Map<string, number>([
      ['40', 1], // activo
    ]);
    const pedidos = [{ movil: '40' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.has('40')).toBe(false);
  });

  it('devuelve Set<string> — los keys son strings, no numeros', () => {
    const estadosMap = new Map([
      ['50', 3],
    ]);
    const pedidos = [{ movil: '50' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.has('50')).toBe(true);
    expect(typeof [...result][0]).toBe('string');
  });

  it('no matchea si el pedido.movil es numerico pero la key del Map es string distinto', () => {
    // getHiddenMovilIdsFromEstadosMap hace String(p.movil) === key, entonces '50' === '50' → match
    // Pero si pedido.movil es número 50, String(50) === '50' → match igualmente
    const estadosMap = new Map([
      ['60', 3],
    ]);
    const pedidos = [{ movil: 60 }]; // número, no string
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.has('60')).toBe(true);
  });

  it('no incluye movil inactivo sin pedidos ni services', () => {
    const estadosMap = new Map([
      ['70', 5],
    ]);
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, []);
    expect(result.has('70')).toBe(false);
  });

  it('construye Set correcto con mapa mixto de estados activos e inactivos', () => {
    const estadosMap = new Map([
      ['100', 1],  // activo con pedido → NO oculto
      ['101', 3],  // inactivo con pedido → oculto
      ['102', 3],  // inactivo sin pedido → NO oculto
      ['103', 0],  // activo → NO oculto
      ['104', 15], // inactivo con service → oculto
    ]);
    const pedidos = [{ movil: '100' }, { movil: '101' }];
    const services = [{ movil: '104' }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos, services);
    expect(result.size).toBe(2);
    expect(result.has('101')).toBe(true);
    expect(result.has('104')).toBe(true);
    expect(result.has('100')).toBe(false);
    expect(result.has('102')).toBe(false);
    expect(result.has('103')).toBe(false);
  });

  it('ignora pedidos con movil null o undefined', () => {
    const estadosMap = new Map([
      ['200', 3],
    ]);
    const pedidos = [{ movil: null }, { movil: undefined }];
    const result = getHiddenMovilIdsFromEstadosMap(estadosMap, pedidos);
    expect(result.has('200')).toBe(false);
  });
});
