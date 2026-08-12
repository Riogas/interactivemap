/**
 * Regresión: el indicador "Ped. sin Asig." del navbar abría la vista extendida
 * VACÍA para usuarios sin la funcionalidad 'Ped s/asignar unitarios'
 * (reporte de Diego, 2026-08-12).
 *
 * Un distribuidor con 'Ped s/asignar acumulados' ve el indicador con el
 * conteo, pero al clickearlo se le abría PedidosTableModal sin contenido
 * (el gate de unitarios filtra todos los pedidos SA). Pedido: si no tiene
 * unitarios, el click no debe abrir nada — ni siquiera el modal vacío.
 *
 * El gate vive en lib/sa-navbar-gate.ts y lo consume page.tsx al pasar
 * onSinAsignarClick a DashboardIndicators (onClick=undefined deja el
 * Indicator inerte: sin handler y cursor-default).
 */

import { describe, it, expect } from 'vitest';
import { gateNavbarSinAsignarClick } from '@/lib/sa-navbar-gate';

describe('gateNavbarSinAsignarClick', () => {
  const handler = () => {};

  it('CON funcionalidad unitarios → devuelve el handler (indicador clickeable)', () => {
    expect(gateNavbarSinAsignarClick(true, handler)).toBe(handler);
  });

  it('SIN funcionalidad unitarios → undefined (el click no abre nada — bug reportado)', () => {
    expect(gateNavbarSinAsignarClick(false, handler)).toBeUndefined();
  });

  it('sin handler definido → undefined en ambos casos (no inventa un handler)', () => {
    expect(gateNavbarSinAsignarClick(true, undefined)).toBeUndefined();
    expect(gateNavbarSinAsignarClick(false, undefined)).toBeUndefined();
  });
});
