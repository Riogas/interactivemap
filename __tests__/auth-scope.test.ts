/**
 * Tests unitarios para lib/auth-scope.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isRoot,
  canSeeAllEmpresas,
  shouldScopeByEmpresa,
  getScopedEmpresas,
  parseZonasJsonb,
} from '../lib/auth-scope';

// Helper: usuario con el flag verTodasEmpresas (EmpFletera {"TODAS":"*"})
const rolPlano = (rolId: string, rolNombre: string) => ({
  RolId: rolId,
  RolNombre: rolNombre,
  RolTipo: '',
  funcionalidades: [],
});

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
// canSeeAllEmpresas — data-driven vía verTodasEmpresas (EmpFletera {"TODAS":"*"})
// ─────────────────────────────────────────────────────────────────────────────
describe('canSeeAllEmpresas', () => {
  it('retorna true para root (legacy isRoot=S)', () => {
    expect(canSeeAllEmpresas({ isRoot: 'S' })).toBe(true);
  });

  it('retorna true para root (nuevo rol RolNombre=Root)', () => {
    expect(canSeeAllEmpresas({
      isRoot: 'N',
      roles: [{ RolId: '99', RolNombre: 'Root', RolTipo: '', funcionalidades: [] }],
    })).toBe(true);
  });

  it('retorna true cuando el usuario tiene verTodasEmpresas=true', () => {
    expect(canSeeAllEmpresas({
      roles: [rolPlano('49', 'Despacho')],
      verTodasEmpresas: true,
    })).toBe(true);
  });

  it('retorna false cuando verTodasEmpresas es false/ausente', () => {
    expect(canSeeAllEmpresas({
      roles: [rolPlano('71', 'Distribuidor')],
    })).toBe(false);
  });

  it('retorna false con roles vacíos y sin flag', () => {
    expect(canSeeAllEmpresas({ roles: [] })).toBe(false);
  });

  it('retorna false sin roles ni flag', () => {
    expect(canSeeAllEmpresas({})).toBe(false);
  });

  // Ya NO hay privilegio por RolId 48/49/50: sin verTodasEmpresas, no ven todo.
  it('retorna false para Despacho/Dashboard/Supervisor sin verTodasEmpresas (sin hardcodeo de rol)', () => {
    expect(canSeeAllEmpresas({ roles: [rolPlano('48', 'Dashboard')] })).toBe(false);
    expect(canSeeAllEmpresas({ roles: [rolPlano('49', 'Despacho')] })).toBe(false);
    expect(canSeeAllEmpresas({ roles: [rolPlano('50', 'Supervisor')] })).toBe(false);
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

  it('retorna false para usuario con verTodasEmpresas=true', () => {
    expect(shouldScopeByEmpresa({
      roles: [rolPlano('49', 'Despacho')],
      verTodasEmpresas: true,
    })).toBe(false);
  });

  it('retorna true para usuario común sin el flag', () => {
    expect(shouldScopeByEmpresa({
      roles: [rolPlano('71', 'Distribuidor')],
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

  it('retorna null para usuario con verTodasEmpresas aunque tenga allowedEmpresas', () => {
    expect(getScopedEmpresas({
      roles: [rolPlano('49', 'Despacho')],
      verTodasEmpresas: true,
      allowedEmpresas: [5],
    })).toBeNull();
  });

  it('retorna [5,7] para distribuidor sin privilegios con allowedEmpresas=[5,7]', () => {
    expect(getScopedEmpresas({
      roles: [rolPlano('71', 'Distribuidor')],
      allowedEmpresas: [5, 7],
    })).toEqual([5, 7]);
  });

  it('retorna [] (fail-closed) para distribuidor con allowedEmpresas=null', () => {
    expect(getScopedEmpresas({
      roles: [rolPlano('71', 'Distribuidor')],
      allowedEmpresas: null,
    })).toEqual([]);
  });

  it('retorna [] (fail-closed) para distribuidor con allowedEmpresas ausente', () => {
    expect(getScopedEmpresas({
      roles: [rolPlano('71', 'Distribuidor')],
    })).toEqual([]);
  });

  it('retorna [] para distribuidor con allowedEmpresas=[]', () => {
    expect(getScopedEmpresas({
      roles: [rolPlano('71', 'Distribuidor')],
      allowedEmpresas: [],
    })).toEqual([]);
  });

  it('retorna [] para usuario null (fail-closed)', () => {
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
