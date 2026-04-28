/**
 * Tests para lib/puntos-interes-scope.ts y lógica de validación de GET /api/puntos-interes.
 *
 * Matriz: rol × tipo × empresa_fletera_id × allowedEmpresas.
 * AC11: email regex en la rama legacy del GET (evita bypass PostgREST via usuario_email).
 */

import { describe, it, expect } from 'vitest';
import {
  isPuntoInteresInScope,
  filterPuntosInteresByScope,
} from '../lib/puntos-interes-scope';

const root = { isRoot: 'S' };
const despacho = {
  isRoot: 'N',
  roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
};
const distribuidorWith12 = {
  isRoot: 'N',
  roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
  allowedEmpresas: [1, 2],
};
const distribuidorEmpty = {
  isRoot: 'N',
  roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
  allowedEmpresas: [],
};
const distribuidorNullEmpresas = {
  isRoot: 'N',
  roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
  allowedEmpresas: null,
};

describe('isPuntoInteresInScope', () => {
  describe('root', () => {
    it('ve publico, privado-con-empresa, privado-sin-empresa, osm — todos true', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, root)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 1 }, root)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: null }, root)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'osm' }, root)).toBe(true);
    });
  });

  describe('despacho', () => {
    it('ve todos los tipos sin importar empresa', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, despacho)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 999 }, despacho)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: null }, despacho)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'osm' }, despacho)).toBe(true);
    });
  });

  describe('distribuidor con allowedEmpresas=[1,2]', () => {
    it('publico → siempre true', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico', empresa_fletera_id: 999 }, distribuidorWith12)).toBe(true);
    });
    it('osm → siempre true', () => {
      expect(isPuntoInteresInScope({ tipo: 'osm' }, distribuidorWith12)).toBe(true);
    });
    it('privado con empresa_fletera_id en allowed → true', () => {
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 1 }, distribuidorWith12)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 2 }, distribuidorWith12)).toBe(true);
    });
    it('privado con empresa_fletera_id fuera de allowed → false', () => {
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 3 }, distribuidorWith12)).toBe(false);
    });
    it('privado sin empresa_fletera_id (null) → false', () => {
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: null }, distribuidorWith12)).toBe(false);
      expect(isPuntoInteresInScope({ tipo: 'privado' }, distribuidorWith12)).toBe(false);
    });
    it('acepta empresa_fletera_id como string numérico', () => {
      expect(
        isPuntoInteresInScope(
          { tipo: 'privado', empresa_fletera_id: '1' as unknown as number },
          distribuidorWith12
        )
      ).toBe(true);
    });
  });

  describe('distribuidor con allowedEmpresas=[]', () => {
    it('publico y osm pasan, privados todos false', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, distribuidorEmpty)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'osm' }, distribuidorEmpty)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 1 }, distribuidorEmpty)).toBe(false);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: null }, distribuidorEmpty)).toBe(false);
    });
  });

  describe('distribuidor con allowedEmpresas=null (fail-closed)', () => {
    it('publico y osm pasan, privados todos false', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, distribuidorNullEmpresas)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'osm' }, distribuidorNullEmpresas)).toBe(true);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 1 }, distribuidorNullEmpresas)).toBe(false);
    });
  });

  describe('user null/undefined', () => {
    it('user null → false', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, null)).toBe(false);
      expect(isPuntoInteresInScope({ tipo: 'privado', empresa_fletera_id: 1 }, null)).toBe(false);
    });
    it('user undefined → false', () => {
      expect(isPuntoInteresInScope({ tipo: 'publico' }, undefined)).toBe(false);
    });
  });

  describe('tipo desconocido', () => {
    it('distribuidor con tipo "raro" → false (fail-closed)', () => {
      expect(
        isPuntoInteresInScope({ tipo: 'fantasma', empresa_fletera_id: 1 }, distribuidorWith12)
      ).toBe(false);
    });
    it('root con tipo "raro" → true (root ve todo)', () => {
      expect(isPuntoInteresInScope({ tipo: 'fantasma' }, root)).toBe(true);
    });
  });
});

describe('filterPuntosInteresByScope', () => {
  const items = [
    { id: 1, tipo: 'publico' },
    { id: 2, tipo: 'osm' },
    { id: 3, tipo: 'privado', empresa_fletera_id: 1 },
    { id: 4, tipo: 'privado', empresa_fletera_id: 3 },
    { id: 5, tipo: 'privado', empresa_fletera_id: null },
  ];

  it('root → mantiene todos', () => {
    expect(filterPuntosInteresByScope(items, root).map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('distribuidor [1,2] → mantiene publico, osm, privado(1)', () => {
    expect(filterPuntosInteresByScope(items, distribuidorWith12).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('distribuidor [] → solo publico y osm', () => {
    expect(filterPuntosInteresByScope(items, distribuidorEmpty).map((i) => i.id)).toEqual([1, 2]);
  });

  it('user null → []', () => {
    expect(filterPuntosInteresByScope(items, null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC11 — Validación email regex en GET /api/puntos-interes (rama legacy)
//
// Replica el regex que usa el route handler para evitar bypass de PostgREST:
//   /^[^\s,()"]+@[^\s,()"]+\.[^\s,()"]+$/
//
// Ataques que deben ser bloqueados (→ 400 en el route):
//   "foo@bar.com,tipo.eq.osm"  → inyección OR via coma
//   "foo@bar.com(tipo.eq.osm)" → inyección via paréntesis
//   "foo bar@bar.com"          → espacio
//   'foo"bar@bar.com'          → comilla doble
//   "foo"                      → sin @
// ─────────────────────────────────────────────────────────────────────────────

/** Replica el regex de GET /api/puntos-interes para validar usuario_email. */
const emailRegex = /^[^\s,()"]+@[^\s,()"]+\.[^\s,()"]+$/;

describe('AC11 — email regex (GET /api/puntos-interes)', () => {
  describe('valores validos → no rechaza', () => {
    it('email simple valido', () => {
      expect(emailRegex.test('usuario@empresa.com')).toBe(true);
    });
    it('email con subdominio', () => {
      expect(emailRegex.test('user@mail.empresa.com.uy')).toBe(true);
    });
    it('email con guion y punto en local-part', () => {
      expect(emailRegex.test('juan.garcia-99@riogas.com.uy')).toBe(true);
    });
    it('email del usuario de test', () => {
      expect(emailRegex.test('dmedaglia@riogas.com.uy')).toBe(true);
    });
  });

  describe('bypass attempts → deben ser rechazados', () => {
    it('inyeccion via coma: "foo@bar.com,tipo.eq.osm" → false', () => {
      expect(emailRegex.test('foo@bar.com,tipo.eq.osm')).toBe(false);
    });
    it('inyeccion via parentesis: "foo@bar.com(tipo.eq.osm)" → false', () => {
      expect(emailRegex.test('foo@bar.com(tipo.eq.osm)')).toBe(false);
    });
    it('espacio en el valor: "foo bar@bar.com" → false', () => {
      expect(emailRegex.test('foo bar@bar.com')).toBe(false);
    });
    it('comilla doble: \'foo"bar@bar.com\' → false', () => {
      expect(emailRegex.test('foo"bar@bar.com')).toBe(false);
    });
    it('sin arroba: "solousuario" → false', () => {
      expect(emailRegex.test('solousuario')).toBe(false);
    });
    it('solo una parte tras @, sin punto: "foo@bar" → false', () => {
      expect(emailRegex.test('foo@bar')).toBe(false);
    });
    it('cadena vacia → false', () => {
      expect(emailRegex.test('')).toBe(false);
    });
  });
});
