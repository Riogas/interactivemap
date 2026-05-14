/**
 * Tests unitarios para lib/auth-scope.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isRoot,
  isDespacho,
  shouldScopeByEmpresa,
  getScopedEmpresas,
  parseZonasJsonb,
} from '../lib/auth-scope';

// ─────────────────────────────────────────────────────────────────────────────
// isRoot
// ─────────────────────────────────────────────────────────────────────────────
describe('isRoot', () => {
  it('retorna true cuando isRoot === "S" (legacy)', () => {
    expect(isRoot({ isRoot: 'S' })).toBe(true);
  });

  it('retorna false cuando isRoot === "N"', () => {
    expect(isRoot({ isRoot: 'N' })).toBe(false);
  });

  it('retorna false cuando isRoot está ausente', () => {
    expect(isRoot({})).toBe(false);
  });

  it('retorna false con user null', () => {
    expect(isRoot(null)).toBe(false);
  });

  it('retorna false con user undefined', () => {
    expect(isRoot(undefined)).toBe(false);
  });

  // ── Nuevos casos: detección por rol RolNombre === 'Root' ──────────────────

  it('retorna true cuando isRoot==="S" aunque roles esté vacío (legacy wins)', () => {
    expect(isRoot({ isRoot: 'S', roles: [] })).toBe(true);
  });

  it('retorna true cuando isRoot==="N" pero hay un rol con RolNombre==="Root" (nuevo)', () => {
    expect(isRoot({
      isRoot: 'N',
      roles: [{ RolId: '99', RolNombre: 'Root', RolTipo: '' }],
    })).toBe(true);
  });

  it('retorna false cuando isRoot==="N" y roles no incluye "Root"', () => {
    expect(isRoot({
      isRoot: 'N',
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
    })).toBe(false);
  });

  it('retorna false con user null (rol path)', () => {
    expect(isRoot(null)).toBe(false);
  });

  it('retorna false cuando isRoot==="N" y roles es undefined', () => {
    expect(isRoot({ isRoot: 'N', roles: undefined })).toBe(false);
  });

  it('retorna true con trim: RolNombre="  Root  " es equivalente a "Root"', () => {
    expect(isRoot({
      isRoot: 'N',
      roles: [{ RolId: '99', RolNombre: '  Root  ', RolTipo: '' }],
    })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isDespacho
// ─────────────────────────────────────────────────────────────────────────────
describe('isDespacho', () => {
  it('retorna true cuando roles incluye RolId "49"', () => {
    expect(isDespacho({
      roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
    })).toBe(true);
  });

  it('retorna true cuando RolId viene como número 49 (cast a string)', () => {
    expect(isDespacho({
      roles: [{ RolId: 49 as unknown as string, RolNombre: 'Despacho', RolTipo: '' }],
    })).toBe(true);
  });

  it('retorna false con RolId distinto (71)', () => {
    expect(isDespacho({
      roles: [{ RolId: '71', RolNombre: 'Otro', RolTipo: '' }],
    })).toBe(false);
  });

  it('retorna false con roles vacíos', () => {
    expect(isDespacho({ roles: [] })).toBe(false);
  });

  it('retorna false sin roles', () => {
    expect(isDespacho({})).toBe(false);
  });

  it('retorna true cuando despacho está entre varios roles', () => {
    expect(isDespacho({
      roles: [
        { RolId: '71', RolNombre: 'Otro', RolTipo: '' },
        { RolId: '49', RolNombre: 'Despacho', RolTipo: '' },
      ],
    })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldScopeByEmpresa
// ─────────────────────────────────────────────────────────────────────────────
describe('shouldScopeByEmpresa', () => {
  it('retorna false para root (legacy isRoot=S)', () => {
    expect(shouldScopeByEmpresa({ isRoot: 'S' })).toBe(false);
  });

  it('retorna false para root (nuevo rol RolNombre=Root)', () => {
    expect(shouldScopeByEmpresa({
      isRoot: 'N',
      roles: [{ RolId: '99', RolNombre: 'Root', RolTipo: '' }],
    })).toBe(false);
  });

  it('retorna false para despacho', () => {
    expect(shouldScopeByEmpresa({
      roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
    })).toBe(false);
  });

  it('retorna true para usuario común no-root, no-despacho', () => {
    expect(shouldScopeByEmpresa({
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
      allowedEmpresas: [5],
    })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getScopedEmpresas
// ─────────────────────────────────────────────────────────────────────────────
describe('getScopedEmpresas', () => {
  it('retorna null para root (sin scope)', () => {
    expect(getScopedEmpresas({ isRoot: 'S' })).toBeNull();
  });

  it('retorna null para root via rol RolNombre=Root', () => {
    expect(getScopedEmpresas({
      isRoot: 'N',
      roles: [{ RolId: '99', RolNombre: 'Root', RolTipo: '' }],
    })).toBeNull();
  });

  it('retorna null para despacho aunque tenga allowedEmpresas (despacho wins)', () => {
    expect(getScopedEmpresas({
      roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
      allowedEmpresas: [5],
    })).toBeNull();
  });

  it('retorna [5,7] para no-despacho con allowedEmpresas=[5,7]', () => {
    expect(getScopedEmpresas({
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
      allowedEmpresas: [5, 7],
    })).toEqual([5, 7]);
  });

  it('retorna [] (fail-closed) para no-despacho con allowedEmpresas=null', () => {
    expect(getScopedEmpresas({
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
      allowedEmpresas: null,
    })).toEqual([]);
  });

  it('retorna [] (fail-closed) para no-despacho con allowedEmpresas ausente', () => {
    expect(getScopedEmpresas({
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
    })).toEqual([]);
  });

  it('retorna [] para no-despacho con allowedEmpresas=[]', () => {
    expect(getScopedEmpresas({
      roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
      allowedEmpresas: [],
    })).toEqual([]);
  });

  it('retorna [] para usuario null (fail-closed)', () => {
    // usuario null → fail-closed (ni root ni despacho identificables) — el dashboard
    // envuelve esto con un guard de "user existe" antes de invocar para evitar flash
    // de contenido vacío durante el load inicial.
    expect(getScopedEmpresas(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseZonasJsonb
// ─────────────────────────────────────────────────────────────────────────────
describe('parseZonasJsonb', () => {
  it('parsea array de números', () => {
    expect(parseZonasJsonb([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('parsea array de strings numéricos', () => {
    expect(parseZonasJsonb(['1', '2', '3'])).toEqual([1, 2, 3]);
  });

  it('rechaza valores no numéricos (NaN)', () => {
    expect(parseZonasJsonb([1, 'abc', 2])).toEqual([1, 2]);
  });

  it('rechaza null y undefined', () => {
    expect(parseZonasJsonb([1, null, 2, undefined])).toEqual([1, 2]);
  });

  it('retorna [] para input no-array', () => {
    expect(parseZonasJsonb(null)).toEqual([]);
    expect(parseZonasJsonb(undefined)).toEqual([]);
    expect(parseZonasJsonb('foo')).toEqual([]);
    expect(parseZonasJsonb(42)).toEqual([]);
    expect(parseZonasJsonb({})).toEqual([]);
  });

  it('mantiene valores 0 (válidos)', () => {
    expect(parseZonasJsonb([0, 1])).toEqual([0, 1]);
  });
});
