/**
 * Tests para isSaInZonaScope (lib/sa-scope.ts).
 *
 * Eje de zona del scope de pedidos/services SIN ASIGNAR (spec 2026-06-17).
 */

import { describe, it, expect } from 'vitest';
import { isSaInZonaScope } from '../lib/sa-scope';

describe('isSaInZonaScope', () => {
  it('null = sin filtro: cualquier zona (incluso null) pasa', () => {
    expect(isSaInZonaScope(5, null)).toBe(true);
    expect(isSaInZonaScope(null, null)).toBe(true);
    expect(isSaInZonaScope(0, null)).toBe(true);
    expect(isSaInZonaScope(undefined, null)).toBe(true);
  });

  it('Set: pasa solo si la zona está en el set', () => {
    const set = new Set([10, 20, 30]);
    expect(isSaInZonaScope(20, set)).toBe(true);
    expect(isSaInZonaScope(99, set)).toBe(false);
  });

  it('Set: SA sin zona (null/0/undefined) NO pasa (no scopeable)', () => {
    const set = new Set([10]);
    expect(isSaInZonaScope(null, set)).toBe(false);
    expect(isSaInZonaScope(0, set)).toBe(false);
    expect(isSaInZonaScope(undefined, set)).toBe(false);
  });

  it('Set vacío: ningún SA pasa', () => {
    const set = new Set<number>();
    expect(isSaInZonaScope(10, set)).toBe(false);
  });

  it('acepta zona como string numérico', () => {
    const set = new Set([42]);
    expect(isSaInZonaScope('42', set)).toBe(true);
    expect(isSaInZonaScope('7', set)).toBe(false);
  });

  it('zona NaN (string no numérico) NO pasa con Set', () => {
    const set = new Set([1]);
    expect(isSaInZonaScope('abc', set)).toBe(false);
  });
});
