/**
 * Tests unitarios para lib/scope-filter.ts
 *
 * Cubren la matriz: root vs distribuidor, scope vacío vs poblado, pedido con
 * móvil vs sin móvil, finalizado vs pendiente, zona dentro vs fuera del scope.
 */

import { describe, it, expect } from 'vitest';
import {
  isPedidoInScope,
  isServiceInScope,
  type ScopeFilter,
  type ScopeFilterOpts,
} from '../lib/scope-filter';

const optsHide: ScopeFilterOpts = { hideEntregadosSinMovil: true };
const optsKeep: ScopeFilterOpts = { hideEntregadosSinMovil: false };

const rootScope: ScopeFilter = {
  scopedZonaIds: null,
  allowedMovilIds: new Set(),
  isRestricted: false,
};

const emptyScope: ScopeFilter = {
  scopedZonaIds: new Set<number>(),
  allowedMovilIds: new Set<number>(),
  isRestricted: true,
};

const normalScope: ScopeFilter = {
  scopedZonaIds: new Set<number>([10, 20, 30]),
  allowedMovilIds: new Set<number>([100, 200]),
  isRestricted: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Root / despacho — sin restricción
// ─────────────────────────────────────────────────────────────────────────────
describe('isPedidoInScope (root/despacho)', () => {
  it('deja pasar pedido con movil y zona', () => {
    expect(isPedidoInScope({ movil: 999, zona_nro: 999, estado_nro: 1 }, rootScope, optsHide)).toBe(true);
  });

  it('deja pasar pedido sin movil pendiente', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 5, estado_nro: 1 }, rootScope, optsHide)).toBe(true);
  });

  it('deja pasar pedido finalizado sin movil aunque hideEntregadosSinMovil=true', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 5, estado_nro: 2 }, rootScope, optsHide)).toBe(true);
  });

  it('deja pasar pedido sin zona', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: null, estado_nro: 1 }, rootScope, optsHide)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Distribuidor con scope vacío (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
describe('isPedidoInScope (scope vacío)', () => {
  it('rechaza pedido con movil y zona', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 10, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });

  it('rechaza pedido sin movil pendiente', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Distribuidor con scope poblado
// ─────────────────────────────────────────────────────────────────────────────
describe('isPedidoInScope (scope normal)', () => {
  it('movil en scope + zona en scope (pendiente) → pasa', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 10, estado_nro: 1 }, normalScope, optsHide)).toBe(true);
  });

  it('movil en scope + zona en scope (finalizado) → pasa', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 10, estado_nro: 2 }, normalScope, optsHide)).toBe(true);
  });

  it('movil en scope + zona FUERA de scope → NO pasa', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: 99, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('movil FUERA de scope → NO pasa aunque la zona esté en scope', () => {
    expect(isPedidoInScope({ movil: 999, zona_nro: 10, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('pendiente sin movil + zona en scope → NO pasa (distribuidor nunca ve sin móvil)', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('pendiente sin movil + zona FUERA de scope → NO pasa', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 99, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('pendiente sin movil + zona null → NO pasa', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: null, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('finalizado sin movil → NO pasa con hideEntregadosSinMovil=true', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 2 }, normalScope, optsHide)).toBe(false);
  });

  it('finalizado sin movil + zona en scope → NO pasa aunque hideEntregadosSinMovil=false (regla distribuidor)', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 2 }, normalScope, optsKeep)).toBe(false);
  });

  it('movil con zona null → NO pasa bajo scope (no decidible)', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: null, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('movil null sin zona → NO pasa bajo scope', () => {
    expect(isPedidoInScope({ movil: null, zona_nro: null, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isServiceInScope — espejo de isPedidoInScope
// ─────────────────────────────────────────────────────────────────────────────
describe('isServiceInScope', () => {
  it('root: deja pasar todo', () => {
    expect(isServiceInScope({ movil: 999, zona_nro: 999, estado_nro: 2 }, rootScope, optsHide)).toBe(true);
  });

  it('scope normal + service en zona y movil válidos → pasa', () => {
    expect(isServiceInScope({ movil: 200, zona_nro: 20, estado_nro: 1 }, normalScope, optsHide)).toBe(true);
  });

  it('scope normal + service movil fuera → NO pasa', () => {
    expect(isServiceInScope({ movil: 555, zona_nro: 20, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });

  it('scope normal + service finalizado sin movil → NO pasa', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 20, estado_nro: 2 }, normalScope, optsHide)).toBe(false);
  });

  it('scope normal + service pendiente sin movil + zona en scope → NO pasa (distribuidor nunca ve sin móvil)', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 30, estado_nro: 1 }, normalScope, optsHide)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Casos defensivos sugeridos por el reviewer
// ─────────────────────────────────────────────────────────────────────────────
describe('casos defensivos (isRestricted=true + scopedZonaIds=null)', () => {
  const defensiveScope: ScopeFilter = {
    scopedZonaIds: null,
    allowedMovilIds: new Set<number>([100]),
    isRestricted: true,
  };

  it('scopedZonaIds=null + isRestricted=true → deja pasar (fail-open defensivo)', () => {
    // El caller prometió que es restricted pero no pudo calcular las zonas.
    // La regla documentada en scope-filter.ts es "no escondemos datos por error".
    expect(isPedidoInScope({ movil: 100, zona_nro: 99, estado_nro: 1 }, defensiveScope, optsHide)).toBe(true);
  });

  it('scopedZonaIds=null + isRestricted=true → pedido sin zona también pasa (no decidible pero fail-open)', () => {
    expect(isPedidoInScope({ movil: 100, zona_nro: null, estado_nro: 1 }, defensiveScope, optsHide)).toBe(true);
  });

  it('scopedZonaIds=null + isRestricted=true → pedido finalizado sin movil también pasa (no hay scope de zona para rechazarlo)', () => {
    expect(isPedidoInScope({ movil: 0, zona_nro: 10, estado_nro: 2 }, defensiveScope, optsHide)).toBe(true);
  });
});

describe('isServiceInScope con scope vacío (fail-closed)', () => {
  it('scope vacío + service con movil y zona → NO pasa', () => {
    expect(isServiceInScope({ movil: 200, zona_nro: 20, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });

  it('scope vacío + service sin movil pendiente → NO pasa', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 20, estado_nro: 1 }, emptyScope, optsHide)).toBe(false);
  });

  it('scope vacío + service finalizado sin movil → NO pasa (regla distribuidor: nunca sin móvil)', () => {
    expect(isServiceInScope({ movil: 0, zona_nro: 20, estado_nro: 2 }, emptyScope, optsHide)).toBe(false);
  });
});
