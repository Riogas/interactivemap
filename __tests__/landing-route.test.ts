/**
 * Tests unitarios para resolveLandingRoute() de lib/role-attributes.ts
 *
 * Cubre los casos de la spec 2026-06-30-pantalla-login-landing-rol-design.md:
 *  - PantallaLogin ausente / vacío / sin roles → /dashboard (default).
 *  - 'mapa' → /dashboard.
 *  - 'stats' (con acceso) → /dashboard/stats; case-insensitive.
 *  - 'stats' sin funcionalidad ni root → /dashboard (defensa en profundidad).
 *  - root sin funcionalidad pero con 'stats' → /dashboard/stats (bypass).
 *  - valor JSON {"Pantalla":"stats"} y string pelado 'stats' → equivalentes.
 *  - clave desconocida / JSON basura → /dashboard.
 *  - multi-rol: primero con PantallaLogin gana (aunque su valor sea inválido).
 */

import { describe, it, expect } from 'vitest';
import { resolveLandingRoute, type LandingUser } from '@/lib/role-attributes';

const STATS_FUNC = { funcionalidadId: 1, nombre: 'Estadistica Global RiogasTracking' };

function role(
  atributos: Array<{ atributo: string; valor: string }> = [],
  funcionalidades: Array<{ funcionalidadId: number; nombre: string }> = [],
  RolNombre = 'Operador',
): NonNullable<LandingUser['roles']>[number] {
  return { RolNombre, atributos, funcionalidades };
}

function user(roles: NonNullable<LandingUser['roles']>, isRoot = 'N'): LandingUser {
  return { isRoot, roles };
}

describe('resolveLandingRoute()', () => {
  it('sin user / sin roles → /dashboard', () => {
    expect(resolveLandingRoute(null)).toBe('/dashboard');
    expect(resolveLandingRoute(undefined)).toBe('/dashboard');
    expect(resolveLandingRoute({ roles: [] })).toBe('/dashboard');
  });

  it('rol sin PantallaLogin → /dashboard', () => {
    expect(resolveLandingRoute(user([role()]))).toBe('/dashboard');
  });

  it('PantallaLogin vacío → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'mapa' → /dashboard", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'mapa' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'stats' con funcionalidad → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("case-insensitive: 'STATS' y 'Stats' → /dashboard/stats", () => {
    for (const v of ['STATS', 'Stats', '  stats  ']) {
      const u = user([role([{ atributo: 'PantallaLogin', valor: v }], [STATS_FUNC])]);
      expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
    }
  });

  it('valor JSON {"Pantalla":"stats"} → /dashboard/stats', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: '{"Pantalla":"stats"}' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('valor JSON string "\\"stats\\"" → /dashboard/stats', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '"stats"' }], [STATS_FUNC])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("'stats' sin funcionalidad y no root → /dashboard (defensa en profundidad)", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it("'stats' siendo root (isRoot='S') sin funcionalidad → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }])], 'S');
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("'stats' con rol 'Root' (sin isRoot flag) → /dashboard/stats", () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'stats' }], [], 'Root')]);
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('clave desconocida → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: 'inexistente' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('JSON basura ({}) → /dashboard', () => {
    const u = user([role([{ atributo: 'PantallaLogin', valor: '{}' }])]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('multi-rol: el primero con PantallaLogin gana', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: 'mapa' }], [STATS_FUNC]),
      role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('multi-rol: primero con valor inválido gana → /dashboard (no busca en el siguiente)', () => {
    const u = user([
      role([{ atributo: 'PantallaLogin', valor: 'inexistente' }], [STATS_FUNC]),
      role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC]),
    ]);
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  // --- PantallaLogin a NIVEL USUARIO (preferencias) ---

  it("nivel usuario: PantallaLogin 'stats' en preferencias (con funcionalidad en rol) → /dashboard/stats", () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role([], [STATS_FUNC])],
      preferencias: [{ atributo: 'PantallaLogin', valor: 'stats' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('nivel usuario: valor JSON {"Pantalla":"stats"} en preferencias → /dashboard/stats', () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role([], [STATS_FUNC])],
      preferencias: [{ atributo: 'PantallaLogin', valor: '{"Pantalla":"stats"}' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it('usuario override rol: usuario=mapa vence a rol=stats → /dashboard', () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC])],
      preferencias: [{ atributo: 'PantallaLogin', valor: 'mapa' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('usuario override rol: usuario=stats vence a rol=mapa → /dashboard/stats', () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role([{ atributo: 'PantallaLogin', valor: 'mapa' }], [STATS_FUNC])],
      preferencias: [{ atributo: 'PantallaLogin', valor: 'stats' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });

  it("nivel usuario: 'stats' sin funcionalidad ni root → /dashboard (defensa en profundidad)", () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role()],
      preferencias: [{ atributo: 'PantallaLogin', valor: 'stats' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard');
  });

  it('nivel usuario: preferencia vacía → cae al rol', () => {
    const u: LandingUser = {
      isRoot: 'N',
      roles: [role([{ atributo: 'PantallaLogin', valor: 'stats' }], [STATS_FUNC])],
      preferencias: [{ atributo: 'PantallaLogin', valor: '' }],
    };
    expect(resolveLandingRoute(u)).toBe('/dashboard/stats');
  });
});
