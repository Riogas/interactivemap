/**
 * Regresión: "Seleccionar todos" no re-seleccionaba los inactivos del día
 * (reporte de Diego, 2026-08-12).
 *
 * Causa raíz (verificada con datos de moviles_dia en prod): un móvil inactivo
 * del día con operativa queda con AMBOS flags en true — inactivo_del_dia y
 * oculto_operativo (ej. 2026-08-12: móviles 1, 167, 276, 305). Bajo USE_NEW,
 * handleSelectAll incluía activos + inactivos del día pero después excluía
 * hiddenMovilIds (= ocultoOperativo), sacando exactamente esos inactivos.
 * La auto-selección inicial (§4.1) NO excluye hidden → el único camino de
 * vuelta al estado "todos seleccionados" era F5.
 *
 * Fix: la lógica se extrae a computeSelectAllIds (lib/moviles/select-all.ts);
 * bajo USE_NEW no se excluye hidden (paridad exacta con la selección inicial).
 */

import { describe, it, expect } from 'vitest';
import { computeSelectAllIds } from '@/lib/moviles/select-all';

interface MinMovil {
  id: number;
  activo?: boolean;
  inactivoDelDia?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — espejo de las combinaciones reales de moviles_dia (prod 2026-08-12)
// ─────────────────────────────────────────────────────────────────────────────

const activo24: MinMovil = { id: 24, activo: true, inactivoDelDia: false };
const activo50: MinMovil = { id: 50, activo: true, inactivoDelDia: false };
// El caso del bug: inactivo del día que TAMBIÉN es oculto_operativo
const inactivoOculto1: MinMovil = { id: 1, activo: false, inactivoDelDia: true };
const inactivoOculto167: MinMovil = { id: 167, activo: false, inactivoDelDia: true };
// Fila "ruido": estado 3/5 sin operativa hoy — no debe entrar nunca
const ruido16: MinMovil = { id: 16, activo: false, inactivoDelDia: false };
const ruido17: MinMovil = { id: 17, activo: false, inactivoDelDia: false };

const universoProd = [activo24, activo50, inactivoOculto1, inactivoOculto167, ruido16, ruido17];
// Bajo USE_NEW, hiddenMovilIds = ocultoOperativo=true — coincide con los inactivos del día
const hiddenProd = new Set<number>([1, 167]);

// ─────────────────────────────────────────────────────────────────────────────
// USE_NEW (NEXT_PUBLIC_USE_MOVILES_DIA=true) — el camino que corre en prod
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSelectAllIds — USE_NEW (moviles_dia)', () => {
  it('incluye los inactivos del día aunque estén en hiddenMovilIds (bug reportado)', () => {
    const ids = computeSelectAllIds(universoProd, hiddenProd, true);
    expect(ids).toContain(1);
    expect(ids).toContain(167);
  });

  it('incluye los activos', () => {
    const ids = computeSelectAllIds(universoProd, hiddenProd, true);
    expect(ids).toContain(24);
    expect(ids).toContain(50);
  });

  it('excluye las filas ruido (activo=false, inactivoDelDia=false)', () => {
    const ids = computeSelectAllIds(universoProd, hiddenProd, true);
    expect(ids).not.toContain(16);
    expect(ids).not.toContain(17);
  });

  it('paridad con la auto-selección inicial §4.1: mismo universo que activo||inactivoDelDia sin excluir hidden', () => {
    // Réplica de la selección inicial de page.tsx (§4.1, effect USE_NEW):
    //   visibles = moviles.filter(m => m.activo === true || m.inactivoDelDia === true)
    // (sin exclusión de hiddenMovilIds). "Seleccionar todos" debe devolver
    // exactamente lo mismo — si no, el usuario no puede volver al estado post-F5.
    const inicial = universoProd
      .filter(m => m.activo === true || m.inactivoDelDia === true)
      .map(m => m.id);
    const ids = computeSelectAllIds(universoProd, hiddenProd, true);
    expect(ids).toEqual(inicial);
  });

  it('universo vacío → []', () => {
    expect(computeSelectAllIds([], hiddenProd, true)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Camino viejo (flag OFF) — comportamiento intacto: todos menos hidden
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSelectAllIds — camino viejo (flag OFF)', () => {
  it('selecciona todos los móviles menos los hiddenMovilIds', () => {
    const ids = computeSelectAllIds(universoProd, hiddenProd, false);
    expect(ids).toEqual([24, 50, 16, 17]);
  });

  it('sin hidden, selecciona todo el universo (incluye filas sin flags — el camino viejo no usa flags)', () => {
    const ids = computeSelectAllIds(universoProd, new Set(), false);
    expect(ids).toEqual([24, 50, 1, 167, 16, 17]);
  });
});
