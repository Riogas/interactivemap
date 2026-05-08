/**
 * Tests unitarios para lib/permisos-sa.ts — getPermisosSA()
 *
 * Cubre:
 *  - 8 combinaciones de permisos_sa explícito (todos los bits posibles)
 *  - Override explícito gana sobre derivacion por rol
 *  - Derivacion por rol: root -> todos true
 *  - Derivacion por rol: RolId 48/49/50 -> todos true
 *  - Derivacion por rol: scope.isRestricted=true -> todos false
 *  - Derivacion por rol: usuario sin roles especiales -> todos false (conservador)
 *  - Wrappers de retrocompat: isPrivilegedForCapEntrega / isPrivilegedForUnassignedVisibility
 *  - Usuario null/undefined -> todos false
 *  - permisos_sa con campos parciales (fallback a false para los ausentes)
 */

import { describe, it, expect } from 'vitest';
import { getPermisosSA, type PermisosSA } from '../lib/permisos-sa';
import { isPrivilegedForCapEntrega, isPrivilegedForUnassignedVisibility } from '../lib/auth-scope';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeRoot() {
  return { isRoot: 'S', roles: [], allowedEmpresas: null, permisos_sa: null };
}

function makeDespacho() {
  return { isRoot: 'N', roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: 'sistema' }], allowedEmpresas: null, permisos_sa: null };
}

function makeDashboard() {
  return { isRoot: 'N', roles: [{ RolId: '48', RolNombre: 'Dashboard', RolTipo: 'sistema' }], allowedEmpresas: null, permisos_sa: null };
}

function makeSupervisor() {
  return { isRoot: 'N', roles: [{ RolId: '50', RolNombre: 'Supervisor', RolTipo: 'sistema' }], allowedEmpresas: null, permisos_sa: null };
}

function makeDistribuidor() {
  return { isRoot: 'N', roles: [{ RolId: '99', RolNombre: 'Distribuidor', RolTipo: 'externo' }], allowedEmpresas: [1, 2], permisos_sa: null };
}

function makeUnknownRole() {
  return { isRoot: 'N', roles: [{ RolId: '77', RolNombre: 'Otro', RolTipo: 'custom' }], allowedEmpresas: null, permisos_sa: null };
}

const ALL_TRUE: PermisosSA = { acumulados: true, x_zona: true, unitarios: true };
const ALL_FALSE: PermisosSA = { acumulados: false, x_zona: false, unitarios: false };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getPermisosSA — derivacion por rol (permisos_sa=null)', () => {
  it('null user -> todos false', () => {
    expect(getPermisosSA(null)).toEqual(ALL_FALSE);
    expect(getPermisosSA(undefined)).toEqual(ALL_FALSE);
  });

  it('root -> todos true', () => {
    expect(getPermisosSA(makeRoot())).toEqual(ALL_TRUE);
  });

  it('RolId 49 (Despacho) -> todos true', () => {
    expect(getPermisosSA(makeDespacho())).toEqual(ALL_TRUE);
  });

  it('RolId 48 (Dashboard) -> todos true', () => {
    expect(getPermisosSA(makeDashboard())).toEqual(ALL_TRUE);
  });

  it('RolId 50 (Supervisor) -> todos true', () => {
    expect(getPermisosSA(makeSupervisor())).toEqual(ALL_TRUE);
  });

  it('distribuidor con scope.isRestricted=true -> todos false', () => {
    expect(getPermisosSA(makeDistribuidor(), { isRestricted: true })).toEqual(ALL_FALSE);
  });

  it('distribuidor sin scope (scope undefined) -> todos false (conservador)', () => {
    expect(getPermisosSA(makeDistribuidor())).toEqual(ALL_FALSE);
  });

  it('rol desconocido -> todos false (conservador)', () => {
    expect(getPermisosSA(makeUnknownRole())).toEqual(ALL_FALSE);
  });

  it('rol desconocido con scope.isRestricted=false -> todos false (conservador)', () => {
    expect(getPermisosSA(makeUnknownRole(), { isRestricted: false })).toEqual(ALL_FALSE);
  });
});

describe('getPermisosSA — override explicito (permisos_sa != null)', () => {
  const base = makeDistribuidor();

  it('override todos true — distribuidor puede ver todo si se le da permiso explícito', () => {
    const user = { ...base, permisos_sa: { acumulados: true, x_zona: true, unitarios: true } };
    expect(getPermisosSA(user, { isRestricted: true })).toEqual(ALL_TRUE);
  });

  it('override todos false — root puede quedar sin ver sin asignar si se lo deniegan', () => {
    const user = { ...makeRoot(), permisos_sa: { acumulados: false, x_zona: false, unitarios: false } };
    expect(getPermisosSA(user)).toEqual(ALL_FALSE);
  });

  // 8 combinaciones de permisos_sa explicito
  const combos: [boolean, boolean, boolean][] = [
    [true,  true,  true ],
    [true,  true,  false],
    [true,  false, true ],
    [true,  false, false],
    [false, true,  true ],
    [false, true,  false],
    [false, false, true ],
    [false, false, false],
  ];

  combos.forEach(([acumulados, x_zona, unitarios]) => {
    it(`permisos_sa={acumulados:${acumulados}, x_zona:${x_zona}, unitarios:${unitarios}}`, () => {
      const user = { ...base, permisos_sa: { acumulados, x_zona, unitarios } };
      expect(getPermisosSA(user)).toEqual({ acumulados, x_zona, unitarios });
    });
  });

  it('permisos_sa parcial — campos ausentes caen a false', () => {
    const user = { ...base, permisos_sa: { acumulados: true } };
    expect(getPermisosSA(user)).toEqual({ acumulados: true, x_zona: false, unitarios: false });
  });

  it('override gana aunque scope.isRestricted=true', () => {
    const user = { ...base, permisos_sa: { acumulados: true, x_zona: false, unitarios: true } };
    expect(getPermisosSA(user, { isRestricted: true })).toEqual({ acumulados: true, x_zona: false, unitarios: true });
  });
});

describe('Wrappers retrocompat en lib/auth-scope', () => {
  it('isPrivilegedForCapEntrega usa x_zona — root -> true', () => {
    expect(isPrivilegedForCapEntrega(makeRoot())).toBe(true);
  });

  it('isPrivilegedForCapEntrega usa x_zona — distribuidor -> false', () => {
    expect(isPrivilegedForCapEntrega(makeDistribuidor())).toBe(false);
  });

  it('isPrivilegedForCapEntrega respeta override explicito', () => {
    const user = { ...makeDistribuidor(), permisos_sa: { acumulados: false, x_zona: true, unitarios: false } };
    expect(isPrivilegedForCapEntrega(user)).toBe(true);
  });

  it('isPrivilegedForUnassignedVisibility usa acumulados — root -> true', () => {
    expect(isPrivilegedForUnassignedVisibility(makeRoot())).toBe(true);
  });

  it('isPrivilegedForUnassignedVisibility usa acumulados — distribuidor -> false', () => {
    expect(isPrivilegedForUnassignedVisibility(makeDistribuidor())).toBe(false);
  });

  it('isPrivilegedForUnassignedVisibility respeta override explicito', () => {
    const user = { ...makeDistribuidor(), permisos_sa: { acumulados: true, x_zona: false, unitarios: false } };
    expect(isPrivilegedForUnassignedVisibility(user)).toBe(true);
  });
});

describe('Backward compat: permisos_sa=null replica comportamiento anterior', () => {
  it('root con permisos_sa=null -> mismo resultado que antes (todos true)', () => {
    expect(getPermisosSA({ isRoot: 'S', permisos_sa: null })).toEqual(ALL_TRUE);
  });

  it('Despacho con permisos_sa=null -> todos true', () => {
    expect(getPermisosSA(makeDespacho())).toEqual(ALL_TRUE);
  });

  it('distribuidor con permisos_sa=null -> todos false', () => {
    expect(getPermisosSA(makeDistribuidor(), { isRestricted: true })).toEqual(ALL_FALSE);
  });
});
