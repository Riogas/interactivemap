/**
 * Tests unitarios para lib/role-attributes.ts
 *
 * Cubre los 10 casos de la spec:
 *  1. Rol único con atributo + Escenario matchea → retorna el valor.
 *  2. Rol único con atributo + Escenario NO matchea → retorna null.
 *  3. Dos roles con mismo atributo + mismo escenario → retorna el máximo.
 *  4. Dos roles con mismo atributo + escenarios distintos, current matchea solo uno → retorna ese.
 *  5. Roles sin atributos [] → retorna null.
 *  6. Atributo sin "Escenario" → skippeado (defensivo).
 *  7. valor con JSON inválido → skippeado + warning log.
 *  8. valor sin CantDiasMaxAntiguedad → skippeado.
 *  9. Múltiples escenarios en un solo Escenario → matchea cualquiera de los escenarios incluidos.
 * 10. HistoricoMaxCoords y HistoricoMaxPedidos son independientes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMaxRoleAttribute, getRolEscenarioIds } from '@/lib/role-attributes';
import type { RoleWithAtributos } from '@/lib/role-attributes';

// ─── Helpers de factory ───────────────────────────────────────────────────────

function makeEscenarioValor(entries: Record<string, number>): string {
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    obj[k] = String(v);
  }
  return JSON.stringify(obj);
}

function makeCantDias(n: number): string {
  return JSON.stringify({ CantDiasMaxAntiguedad: String(n) });
}

function makeRole(
  rolId: number,
  rolNombre: string,
  atributos: Array<{ atributo: string; valor: string }>,
): RoleWithAtributos {
  return { rolId, rolNombre, atributos };
}

// ─── getRolEscenarioIds ───────────────────────────────────────────────────────

describe('getRolEscenarioIds()', () => {
  it('extrae los escenario_ids de un rol con Escenario simple', () => {
    const role = makeRole(51, 'Distribuidor', [
      { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
    ]);
    const result = getRolEscenarioIds(role);
    expect(result).toEqual(new Set([1000]));
  });

  it('extrae múltiples escenario_ids de un rol con varios escenarios', () => {
    const role = makeRole(51, 'Distribuidor', [
      { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000, CANELONES: 2000 }) },
    ]);
    const result = getRolEscenarioIds(role);
    expect(result).toEqual(new Set([1000, 2000]));
  });

  it('retorna null si el rol no tiene atributo Escenario', () => {
    const role = makeRole(51, 'Distribuidor', [
      { atributo: 'HistoricoMaxCoords', valor: makeCantDias(10) },
    ]);
    expect(getRolEscenarioIds(role)).toBeNull();
  });

  it('retorna null si atributos es undefined', () => {
    const role: RoleWithAtributos = { rolId: 51, rolNombre: 'Distribuidor' };
    expect(getRolEscenarioIds(role)).toBeNull();
  });

  it('retorna null si el valor es JSON inválido', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const role = makeRole(51, 'Distribuidor', [
      { atributo: 'Escenario', valor: 'not-json' },
    ]);
    expect(getRolEscenarioIds(role)).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─── getMaxRoleAttribute ──────────────────────────────────────────────────────

describe('getMaxRoleAttribute()', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // Caso 1: Rol único con atributo + Escenario matchea → retorna el valor
  it('caso 1: rol único matchea escenario → retorna valor', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(31) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(31);
  });

  // Caso 2: Rol único con atributo + Escenario NO matchea → retorna null
  it('caso 2: rol único NO matchea escenario → null', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(31) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ CANELONES: 2000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
  });

  // Caso 3: Dos roles con mismo atributo + mismo escenario → retorna el máximo
  it('caso 3: dos roles con mismo escenario → retorna el mayor valor', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(2) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
      makeRole(53, 'Distribuidor (demo)', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(10) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(10);
  });

  // Caso 4a: Dos roles con escenarios distintos, current matchea solo uno → retorna ese
  it('caso 4a: dos roles con escenarios distintos, matchea solo rol1 → retorna valor de rol1', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(2) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
      makeRole(52, 'Distribuidor Canelones', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(20) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ CANELONES: 2000 }) },
      ]),
    ];
    // currentEscenarioId = 1000 → solo rol 51 aplica → valor 2
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(2);
  });

  // Caso 4b: Dos roles con escenarios distintos, ambos matchean → retorna el máximo
  it('caso 4b: dos roles con escenarios distintos, ambos matchean → retorna el mayor', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(2) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
      makeRole(52, 'Distribuidor Multi', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(20) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000, CANELONES: 2000 }) },
      ]),
    ];
    // Ambos matchean escenario 1000 → MAX(2, 20) = 20
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(20);
  });

  // Caso 5: Roles sin atributos [] → retorna null
  it('caso 5: roles sin atributos → null', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', []),
      makeRole(52, 'Otro', []),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
  });

  // Caso 6: Atributo sin "Escenario" → skippeado (defensivo)
  it('caso 6: rol con atributo pero sin Escenario → skippeado → null', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(31) },
        // sin atributo Escenario
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
  });

  // Caso 7: valor con JSON inválido → skippeado + warning log
  it('caso 7: JSON inválido en atributo → skippeado, warning loggeado', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: 'not-valid-json' },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  // Caso 8: valor sin CantDiasMaxAntiguedad → skippeado
  it('caso 8: valor sin CantDiasMaxAntiguedad → skippeado → null', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: JSON.stringify({ OtroKey: '31' }) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  // Caso 9: Múltiples escenarios en un solo Escenario → matchea cualquiera
  it('caso 9: Escenario con múltiples IDs → matchea cuando currentEscenarioId es cualquiera de ellos', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor Multi', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(15) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000, CANELONES: 2000 }) },
      ]),
    ];
    // Matchea con escenario 1000
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(15);
    // Matchea con escenario 2000
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 2000)).toBe(15);
    // No matchea con escenario 3000
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 3000)).toBeNull();
  });

  // Caso 10: HistoricoMaxCoords y HistoricoMaxPedidos son independientes
  it('caso 10: HistoricoMaxCoords y HistoricoMaxPedidos son independientes', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(31) },
        { atributo: 'HistoricoMaxPedidos', valor: makeCantDias(10) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(31);
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxPedidos', 1000)).toBe(10);
  });

  // Edge: array vacío de roles → null
  it('array vacío de roles → null', () => {
    expect(getMaxRoleAttribute([], 'HistoricoMaxCoords', 1000)).toBeNull();
  });

  // Edge: un rol matchea escenario pero no tiene el atributo pedido → null
  it('rol matchea escenario pero no tiene el atributo pedido → null', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        // Tiene Escenario pero NO tiene HistoricoMaxCoords
        { atributo: 'HistoricoMaxPedidos', valor: makeCantDias(10) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBeNull();
    // Pero sí tiene HistoricoMaxPedidos
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxPedidos', 1000)).toBe(10);
  });

  // Edge: CantDiasMaxAntiguedad valor "0" → retorna 0 (sin historia)
  it('CantDiasMaxAntiguedad = "0" → retorna 0', () => {
    const roles: RoleWithAtributos[] = [
      makeRole(51, 'Distribuidor', [
        { atributo: 'HistoricoMaxCoords', valor: makeCantDias(0) },
        { atributo: 'Escenario', valor: makeEscenarioValor({ MONTEVIDEO: 1000 }) },
      ]),
    ];
    expect(getMaxRoleAttribute(roles, 'HistoricoMaxCoords', 1000)).toBe(0);
  });
});
