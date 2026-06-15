/**
 * Regresión: valor de Cap. Entrega mostrado según la funcionalidad
 * 'Ped s/asignar x zona' (canVerSinAsignar).
 *
 * Bug reportado (2026-06-15): una zona con móviles sobre-asignados tiene
 * capacidad_total negativa (ej. −1). Un usuario SIN la funcionalidad no debe
 * ver ese negativo; el valor se clampea a 0 como máximo. Un usuario CON la
 * funcionalidad sí ve el sobrecupo real (negativo) y se le resta además los
 * pedidos sin asignar.
 *
 * `capEntregaMostrada` es la única fuente de verdad del valor mostrado, usada
 * por el modal de zona y el caption del polígono de la capa Cap. Entrega.
 */

import { describe, it, expect } from 'vitest';
import { capEntregaMostrada } from '../lib/cap-entrega-color';

describe('capEntregaMostrada — gating del valor mostrado', () => {
  describe('SIN la funcionalidad (canVerSinAsignar=false)', () => {
    it('capacidad negativa por sobrecupo de móviles → 0 (no negativo)', () => {
      expect(capEntregaMostrada(-1, 0, false)).toBe(0);
      expect(capEntregaMostrada(-5, 0, false)).toBe(0);
    });

    it('ignora pedidos_sin_asignar (no los puede ver) → no resta', () => {
      // capacidad_total=2, hay 3 SA: con la func daría -1, pero sin func el SA
      // no se descuenta y, al ser positivo, se muestra tal cual.
      expect(capEntregaMostrada(2, 3, false)).toBe(2);
    });

    it('capacidad positiva se muestra sin cambios', () => {
      expect(capEntregaMostrada(4, 0, false)).toBe(4);
    });

    it('capacidad exacta 0 se muestra como 0', () => {
      expect(capEntregaMostrada(0, 0, false)).toBe(0);
    });
  });

  describe('CON la funcionalidad (canVerSinAsignar=true)', () => {
    it('muestra el sobrecupo real negativo', () => {
      expect(capEntregaMostrada(-1, 0, true)).toBe(-1);
    });

    it('resta los pedidos sin asignar a la capacidad', () => {
      expect(capEntregaMostrada(5, 2, true)).toBe(3);
      expect(capEntregaMostrada(0, 1, true)).toBe(-1);
    });

    it('aplica floor defensivo de −9999', () => {
      expect(capEntregaMostrada(-100000, 0, true)).toBe(-9999);
    });
  });
});
