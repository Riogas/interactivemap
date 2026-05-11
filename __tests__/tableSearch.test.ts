/**
 * Unit tests for utils/tableSearch.ts
 *
 * Tests matchesSearchPedido and matchesSearchService against all visible
 * table columns. Helpers are pure functions — no React render needed.
 *
 * Convention: search strings are always pre-lowercased (as the callers do via
 * `filters.search.toLowerCase().trim()`). Tests follow the same convention.
 */

import { describe, it, expect } from 'vitest';
import { matchesSearchPedido, matchesSearchService } from '../utils/tableSearch';
import type { PedidoSupabase, ServiceSupabase } from '../types';

// ---------------------------------------------------------------------------
// Minimal fixture factories — fields not under test are set to null / safe defaults
// to avoid accidental false positives.
// ---------------------------------------------------------------------------

/** Bare pedido with only id set. All other searchable fields null. */
function barePedido(overrides: Partial<PedidoSupabase> = {}): PedidoSupabase {
  return {
    id: 1001,
    movil: null,
    zona_nro: null,
    cliente_tel: null,
    cliente_nombre: null,
    cliente_ciudad: null,
    cliente_direccion: null,
    cliente_obs: null,
    producto_nom: null,
    produto_cod: null, // field not in real type, ok for fixture baseline
    produto_cant: null,
    produto_descr: null,
    servicio_nombre: null,
    imp_bruto: null,
    fch_hora_max_ent_comp: null,
    pedido_obs: null,
    sub_estado_nro: null,
    sub_estado_desc: null,
    estado_nro: null,
    latitud: null,
    longitud: null,
    fch_hora_para: null,
    fch_hora_finalizacion: null,
    atraso_cump_mins: null,
    ...overrides,
  } as unknown as PedidoSupabase;
}

/** Bare service with only id set. All other searchable fields null. */
function bareService(overrides: Partial<ServiceSupabase> = {}): ServiceSupabase {
  return {
    id: 2001,
    movil: null,
    zona_nro: null,
    cliente_tel: null,
    cliente_nombre: null,
    cliente_ciudad: null,
    cliente_direccion: null,
    cliente_obs: null,
    defecto: null,
    servicio_nombre: null,
    pedido_obs: null,
    sub_estado_nro: null,
    sub_estado_desc: null,
    estado_nro: null,
    latitud: null,
    longitud: null,
    fch_hora_max_ent_comp: null,
    fch_hora_para: null,
    ...overrides,
  } as unknown as ServiceSupabase;
}

// ---------------------------------------------------------------------------
// matchesSearchPedido
// ---------------------------------------------------------------------------

describe('matchesSearchPedido', () => {
  it('returns true for empty search (no filter)', () => {
    expect(matchesSearchPedido(barePedido(), '')).toBe(true);
  });

  it('matches by id (full and partial)', () => {
    expect(matchesSearchPedido(barePedido({ id: 1001 }), '1001')).toBe(true);
    expect(matchesSearchPedido(barePedido({ id: 1001 }), '100')).toBe(true);
    expect(matchesSearchPedido(barePedido({ id: 1001 }), '9999')).toBe(false);
  });

  it('matches by movil (number as string)', () => {
    const p = barePedido({ id: 9, movil: 42 });
    expect(matchesSearchPedido(p, '42')).toBe(true);
    // '4' matches '42' as substring — expected behavior (includes)
    expect(matchesSearchPedido(p, '4')).toBe(true);
    // '99' should NOT match movil=42 or id=9
    expect(matchesSearchPedido(p, '99')).toBe(false);
  });

  it('returns false when movil is null and search is a number', () => {
    expect(matchesSearchPedido(barePedido({ id: 9 }), '42')).toBe(false);
  });

  it('matches by zona_nro', () => {
    const p = barePedido({ id: 2, zona_nro: 5 });
    expect(matchesSearchPedido(p, '5')).toBe(true);
    expect(matchesSearchPedido(p, '7')).toBe(false);
  });

  it('matches by cliente_tel (case-sensitive as-is, no toLowerCase on phone)', () => {
    const p = barePedido({ id: 2, cliente_tel: '099123456' });
    expect(matchesSearchPedido(p, '0991')).toBe(true);
    expect(matchesSearchPedido(p, '555')).toBe(false);
  });

  it('matches by cliente_nombre case-insensitive', () => {
    const p = barePedido({ id: 2, cliente_nombre: 'Juan Perez' });
    expect(matchesSearchPedido(p, 'juan')).toBe(true);
    expect(matchesSearchPedido(p, 'perez')).toBe(true);
    expect(matchesSearchPedido(p, 'garcia')).toBe(false);
  });

  it('matches by cliente_ciudad case-insensitive', () => {
    const p = barePedido({ id: 2, cliente_ciudad: 'Montevideo' });
    expect(matchesSearchPedido(p, 'monte')).toBe(true);
    expect(matchesSearchPedido(p, 'salave')).toBe(false);
  });

  it('matches by cliente_direccion case-insensitive', () => {
    const p = barePedido({ id: 2, cliente_direccion: 'Av. Italia 1234' });
    expect(matchesSearchPedido(p, 'italia')).toBe(true);
    expect(matchesSearchPedido(p, 'xyz')).toBe(false);
  });

  it('matches by producto_nom case-insensitive', () => {
    const p = barePedido({ id: 2, producto_nom: 'Gas 45kg' });
    expect(matchesSearchPedido(p, 'gas')).toBe(true);
    expect(matchesSearchPedido(p, '45')).toBe(true);
    expect(matchesSearchPedido(p, 'agua')).toBe(false);
  });

  it('matches by servicio_nombre case-insensitive', () => {
    const p = barePedido({ id: 2, servicio_nombre: 'Domicilio' });
    expect(matchesSearchPedido(p, 'domicilio')).toBe(true);
    expect(matchesSearchPedido(p, 'domi')).toBe(true);
    expect(matchesSearchPedido(p, 'express')).toBe(false);
  });

  it('matches by pedido_obs (observaciones) case-insensitive', () => {
    const p = barePedido({ id: 2, pedido_obs: 'Dejar con portero' });
    expect(matchesSearchPedido(p, 'portero')).toBe(true);
    expect(matchesSearchPedido(p, 'dejar')).toBe(true);
    expect(matchesSearchPedido(p, 'urgente')).toBe(false);
  });

  it('does not throw and returns false when pedido_obs is null', () => {
    const p = barePedido({ id: 7 });
    expect(() => matchesSearchPedido(p, 'portero')).not.toThrow();
    expect(matchesSearchPedido(p, 'portero')).toBe(false);
  });

  it('matches by cliente_obs case-insensitive', () => {
    const p = barePedido({ id: 2, cliente_obs: 'Llamar antes de ir' });
    expect(matchesSearchPedido(p, 'llamar')).toBe(true);
    expect(matchesSearchPedido(p, 'visitar')).toBe(false);
  });

  it('does not throw and returns false when cliente_obs is null', () => {
    const p = barePedido({ id: 7 });
    expect(() => matchesSearchPedido(p, 'llamar')).not.toThrow();
    expect(matchesSearchPedido(p, 'llamar')).toBe(false);
  });

  it('matches by estado label - MOVIL ASIGNADO (pendiente con movil)', () => {
    // estado_nro=1, sub_estado_nro=1, sub_estado_desc='5' => ESTADO_MAP['1-5'] = 'MOVIL ASIGNADO'
    const p = barePedido({ id: 2, estado_nro: 1, sub_estado_nro: 1, sub_estado_desc: '5', movil: 42 });
    expect(matchesSearchPedido(p, 'movil asignado')).toBe(true);
    // partial lower
    expect(matchesSearchPedido(p, 'asignado')).toBe(true);
  });

  it('matches by estado label - ENTREGADO (finalizado)', () => {
    // estado_nro=2, sub_estado_nro=2, sub_estado_desc='3' => ESTADO_MAP['2-3'] = 'ENTREGADO'
    const p = barePedido({ id: 2, estado_nro: 2, sub_estado_nro: 2, sub_estado_desc: '3', movil: 42 });
    expect(matchesSearchPedido(p, 'entregado')).toBe(true);
  });

  it('matches "sin asignar" label for pendiente without movil', () => {
    const p = barePedido({ id: 2, estado_nro: 1, movil: null });
    expect(matchesSearchPedido(p, 'sin asignar')).toBe(true);
    expect(matchesSearchPedido(p, 'asig')).toBe(true);
  });

  it('does not match wrong estado label', () => {
    // MOVIL ASIGNADO should NOT match 'entregado'
    const p = barePedido({ id: 2, movil: 1, estado_nro: 1, sub_estado_nro: 1, sub_estado_desc: '5' });
    expect(matchesSearchPedido(p, 'entregado')).toBe(false);
  });

  it('handles all null optional fields without throwing', () => {
    const p = barePedido({ id: 1001 });
    expect(() => matchesSearchPedido(p, 'test')).not.toThrow();
    expect(matchesSearchPedido(p, '1001')).toBe(true);
    expect(matchesSearchPedido(p, 'xyz')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesSearchService
// ---------------------------------------------------------------------------

describe('matchesSearchService', () => {
  it('returns true for empty search', () => {
    expect(matchesSearchService(bareService(), '')).toBe(true);
  });

  it('matches by id', () => {
    expect(matchesSearchService(bareService({ id: 2001 }), '2001')).toBe(true);
    expect(matchesSearchService(bareService({ id: 2001 }), '9999')).toBe(false);
  });

  it('matches by movil', () => {
    const s = bareService({ id: 3, movil: 15 });
    expect(matchesSearchService(s, '15')).toBe(true);
    expect(matchesSearchService(s, '99')).toBe(false);
  });

  it('matches by zona_nro', () => {
    const s = bareService({ id: 3, zona_nro: 3 });
    expect(matchesSearchService(s, '3')).toBe(true);
  });

  it('matches by cliente_tel', () => {
    const s = bareService({ id: 3, cliente_tel: '098765432' });
    expect(matchesSearchService(s, '0987')).toBe(true);
    expect(matchesSearchService(s, '111')).toBe(false);
  });

  it('matches by cliente_nombre case-insensitive', () => {
    const s = bareService({ id: 3, cliente_nombre: 'Maria Lopez' });
    expect(matchesSearchService(s, 'maria')).toBe(true);
    expect(matchesSearchService(s, 'lopez')).toBe(true);
    expect(matchesSearchService(s, 'garcia')).toBe(false);
  });

  it('matches by cliente_ciudad', () => {
    const s = bareService({ id: 3, cliente_ciudad: 'Paysandu' });
    expect(matchesSearchService(s, 'pays')).toBe(true);
  });

  it('matches by cliente_direccion', () => {
    const s = bareService({ id: 3, cliente_direccion: 'Ruta 3 km 120' });
    expect(matchesSearchService(s, 'ruta')).toBe(true);
  });

  it('matches by defecto case-insensitive', () => {
    const s = bareService({ id: 3, defecto: 'Regulador defectuoso' });
    expect(matchesSearchService(s, 'regulador')).toBe(true);
    expect(matchesSearchService(s, 'defect')).toBe(true);
    expect(matchesSearchService(s, 'valvula')).toBe(false);
  });

  it('matches by servicio_nombre', () => {
    const s = bareService({ id: 3, servicio_nombre: 'Service Gas' });
    expect(matchesSearchService(s, 'service gas')).toBe(true);
  });

  it('matches by pedido_obs (observaciones) case-insensitive', () => {
    const s = bareService({ id: 3, pedido_obs: 'Equipo antiguo' });
    expect(matchesSearchService(s, 'antiguo')).toBe(true);
    expect(matchesSearchService(s, 'equipo')).toBe(true);
    expect(matchesSearchService(s, 'nuevo')).toBe(false);
  });

  it('does not throw and returns false when pedido_obs is null', () => {
    const s = bareService({ id: 7 });
    expect(() => matchesSearchService(s, 'antiguo')).not.toThrow();
    expect(matchesSearchService(s, 'antiguo')).toBe(false);
  });

  it('matches by cliente_obs', () => {
    const s = bareService({ id: 3, cliente_obs: 'Preferir manana' });
    expect(matchesSearchService(s, 'manana')).toBe(true);
    expect(matchesSearchService(s, 'hoy')).toBe(false);
  });

  it('matches by estado label - ENTREGADO', () => {
    // estado_nro=2, sub_estado_nro=2, sub_estado_desc='3' => 'ENTREGADO'
    const s = bareService({ id: 3, estado_nro: 2, sub_estado_nro: 2, sub_estado_desc: '3' });
    expect(matchesSearchService(s, 'entregado')).toBe(true);
  });

  it('handles all null optional fields without throwing', () => {
    const s = bareService({ id: 2001 });
    expect(() => matchesSearchService(s, 'test')).not.toThrow();
    expect(matchesSearchService(s, '2001')).toBe(true);
    expect(matchesSearchService(s, 'xyz')).toBe(false);
  });
});
