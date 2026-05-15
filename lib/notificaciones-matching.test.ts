import { describe, it, expect } from 'vitest';
import { isNotifActive, matchesUserRole, matchesUser } from './notificaciones-matching';
import type { NotifForMatch, UserRoleForMatch } from './notificaciones-matching';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-15T12:00:00Z');

function makeNotif(overrides: Partial<NotifForMatch> = {}): NotifForMatch {
  return {
    id: 1,
    activa: true,
    fecha_inicio: '2026-05-01T00:00:00Z',
    fecha_fin: '2026-05-31T23:59:59Z',
    roles_target: ['Distribuidor', 'Dashboard'],
    ...overrides,
  };
}

const ROLES_DISTRIBUIDOR: UserRoleForMatch[] = [{ RolNombre: 'Distribuidor' }];
const ROLES_DESPACHO: UserRoleForMatch[] = [{ RolNombre: 'Despacho' }];
const ROLES_MULTI: UserRoleForMatch[] = [
  { RolNombre: 'Distribuidor' },
  { RolNombre: 'Despacho' },
];
const ROLES_NONE: UserRoleForMatch[] = [];

// ─── isNotifActive ────────────────────────────────────────────────────────────

describe('isNotifActive', () => {
  it('devuelve true cuando activa=true y now esta dentro del rango', () => {
    const notif = makeNotif();
    expect(isNotifActive(notif, NOW)).toBe(true);
  });

  it('devuelve false cuando activa=false (aunque este en rango)', () => {
    const notif = makeNotif({ activa: false });
    expect(isNotifActive(notif, NOW)).toBe(false);
  });

  it('devuelve false cuando now < fecha_inicio (notif futura)', () => {
    const notif = makeNotif({ fecha_inicio: '2026-06-01T00:00:00Z' });
    expect(isNotifActive(notif, NOW)).toBe(false);
  });

  it('devuelve false cuando now > fecha_fin (notif vencida)', () => {
    const notif = makeNotif({ fecha_fin: '2026-05-01T00:00:00Z' });
    expect(isNotifActive(notif, NOW)).toBe(false);
  });

  it('devuelve true exactamente en fecha_inicio', () => {
    const inicio = '2026-05-15T12:00:00Z';
    const notif = makeNotif({ fecha_inicio: inicio });
    expect(isNotifActive(notif, new Date(inicio))).toBe(true);
  });

  it('devuelve true exactamente en fecha_fin', () => {
    const fin = '2026-05-15T12:00:00Z';
    const notif = makeNotif({ fecha_fin: fin });
    expect(isNotifActive(notif, new Date(fin))).toBe(true);
  });

  it('usa new Date() como default cuando now no se pasa', () => {
    // Con un rango muy amplio, siempre deberia ser activa
    const notif = makeNotif({
      fecha_inicio: '2000-01-01T00:00:00Z',
      fecha_fin: '2099-12-31T23:59:59Z',
    });
    expect(isNotifActive(notif)).toBe(true);
  });
});

// ─── matchesUserRole ──────────────────────────────────────────────────────────

describe('matchesUserRole', () => {
  it('devuelve true cuando el usuario tiene un rol en roles_target', () => {
    const notif = makeNotif({ roles_target: ['Distribuidor', 'Dashboard'] });
    expect(matchesUserRole(notif, ROLES_DISTRIBUIDOR)).toBe(true);
  });

  it('devuelve false cuando el usuario no tiene ningun rol en roles_target', () => {
    const notif = makeNotif({ roles_target: ['Distribuidor', 'Dashboard'] });
    expect(matchesUserRole(notif, ROLES_DESPACHO)).toBe(false);
  });

  it('devuelve true cuando el usuario tiene al menos un rol que matchea (multi-rol)', () => {
    const notif = makeNotif({ roles_target: ['Despacho'] });
    expect(matchesUserRole(notif, ROLES_MULTI)).toBe(true);
  });

  it('devuelve false cuando roles_target esta vacio', () => {
    const notif = makeNotif({ roles_target: [] });
    expect(matchesUserRole(notif, ROLES_DISTRIBUIDOR)).toBe(false);
  });

  it('devuelve false cuando userRoles esta vacio', () => {
    const notif = makeNotif({ roles_target: ['Distribuidor'] });
    expect(matchesUserRole(notif, ROLES_NONE)).toBe(false);
  });

  it('hace trim de espacios en roles_target', () => {
    const notif = makeNotif({ roles_target: [' Distribuidor ', ' Dashboard '] });
    expect(matchesUserRole(notif, [{ RolNombre: 'Distribuidor' }])).toBe(true);
  });

  it('hace trim de espacios en RolNombre del usuario', () => {
    const notif = makeNotif({ roles_target: ['Distribuidor'] });
    expect(matchesUserRole(notif, [{ RolNombre: '  Distribuidor  ' }])).toBe(true);
  });

  it('es case-sensitive (no matchea si el case difiere)', () => {
    const notif = makeNotif({ roles_target: ['distribuidor'] });
    expect(matchesUserRole(notif, [{ RolNombre: 'Distribuidor' }])).toBe(false);
  });
});

// ─── matchesUser ─────────────────────────────────────────────────────────────

describe('matchesUser', () => {
  it('devuelve true cuando notif activa, en rango, y rol matchea', () => {
    const notif = makeNotif();
    expect(matchesUser(notif, ROLES_DISTRIBUIDOR, NOW)).toBe(true);
  });

  it('devuelve false cuando notif inactiva aunque rol matchee', () => {
    const notif = makeNotif({ activa: false });
    expect(matchesUser(notif, ROLES_DISTRIBUIDOR, NOW)).toBe(false);
  });

  it('devuelve false cuando vencida aunque rol matchee', () => {
    const notif = makeNotif({ fecha_fin: '2026-01-01T00:00:00Z' });
    expect(matchesUser(notif, ROLES_DISTRIBUIDOR, NOW)).toBe(false);
  });

  it('devuelve false cuando en rango pero rol no matchea', () => {
    const notif = makeNotif({ roles_target: ['Root'] });
    expect(matchesUser(notif, ROLES_DESPACHO, NOW)).toBe(false);
  });
});
