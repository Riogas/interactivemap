/**
 * Tests de components/metricas/demora-comparativa-logic.ts — lógica pura
 * extraída de DemoraComparativa.tsx para poder testearse sin
 * jsdom/@testing-library/react (el repo no los tiene, vitest.config.ts usa
 * environment: 'node' — mismo patrón que __tests__/metricas-dashboard-
 * theme.test.ts y __tests__/dashboard-lifecycle.test.ts).
 *
 * Fix round 1 sobre Task 8 (Important): la card no distinguía "el motor no
 * corrió" de "no tenés zonas asignadas" — ambos caían en el mismo mensaje,
 * porque el endpoint devuelve 200 con arrays vacíos en los dos casos
 * (fail-closed). `sinAlcanceNoRoot` es el predicado que el componente usa
 * TANTO para elegir el mensaje (render) COMO para saltear el fetch
 * (`buildComparativaFetch` retorna `skip: true` antes de construir la URL o
 * los headers) — testear que `buildComparativaFetch({...sin alcance}).skip
 * === true` prueba, por inspección directa del código de
 * DemoraComparativa.tsx (`if (intent.skip) return;` ANTES de la única
 * llamada a `fetch(...)` del componente), que el endpoint no se llama.
 */

import { describe, it, expect } from 'vitest';
import { sinAlcanceNoRoot, buildComparativaFetch, MENSAJE_SIN_ALCANCE } from './demora-comparativa-logic';

describe('sinAlcanceNoRoot()', () => {
  it('no-root sin empresas -> true (sin alcance)', () => {
    expect(sinAlcanceNoRoot(false, [])).toBe(true);
  });

  it('no-root con empresas -> false', () => {
    expect(sinAlcanceNoRoot(false, [70])).toBe(false);
  });

  it('root sin empresas -> false (root ve todo igual)', () => {
    expect(sinAlcanceNoRoot(true, [])).toBe(false);
  });

  it('root con empresas -> false', () => {
    expect(sinAlcanceNoRoot(true, [70, 80])).toBe(false);
  });
});

describe('MENSAJE_SIN_ALCANCE', () => {
  it('no menciona jerga interna (fail-closed / scope) — hablado desde el usuario', () => {
    expect(MENSAJE_SIN_ALCANCE.toLowerCase()).not.toMatch(/fail-closed|scope/);
  });

  it('distingue el texto del mensaje genérico de "sin corridas"', () => {
    expect(MENSAJE_SIN_ALCANCE).not.toBe('Todavía no hay corridas del motor para hoy.');
  });
});

describe('buildComparativaFetch()', () => {
  const base = { escenario: 1000, tipo: 'URGENTE' as const, zona: null };

  it('no-root SIN empresas -> skip:true, sin construir url ni headers (no se llama al endpoint)', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [] });
    expect(intent.skip).toBe(true);
    // Union discriminada: con skip:true, TS ni deja acceder a url/headers.
    // Confirmamos igual en runtime que el objeto no trae esas claves.
    expect('url' in intent).toBe(false);
    expect('headers' in intent).toBe(false);
  });

  it('sin escenario elegido -> skip:true (root)', () => {
    const intent = buildComparativaFetch({ ...base, escenario: null, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(true);
  });

  it('sin escenario elegido -> skip:true (no-root con empresas)', () => {
    const intent = buildComparativaFetch({ ...base, escenario: null, isRoot: false, empresasIds: [70] });
    expect(intent.skip).toBe(true);
  });

  it('root -> skip:false, header x-track-isroot, sin query param empresaIds', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    expect(intent.headers).toEqual({ 'x-track-isroot': 'S' });
    expect(intent.url).toBe('/api/demoras/comparativa?escenario=1000&tipo=URGENTE');
  });

  it('no-root CON empresas -> skip:false, query param empresaIds (CSV), sin header x-track-isroot', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: false, empresasIds: [70, 80] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    expect(intent.headers).toEqual({});
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.get('empresaIds')).toBe('70,80');
    expect(url.searchParams.get('escenario')).toBe('1000');
    expect(url.searchParams.get('tipo')).toBe('URGENTE');
  });

  it('zona elegida -> viaja en la url', () => {
    const intent = buildComparativaFetch({ ...base, zona: 42, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.get('zona')).toBe('42');
  });

  it('sin zona elegida -> no viaja el param "zona"', () => {
    const intent = buildComparativaFetch({ ...base, isRoot: true, empresasIds: [] });
    expect(intent.skip).toBe(false);
    if (intent.skip) throw new Error('unreachable');
    const url = new URL(intent.url, 'http://localhost');
    expect(url.searchParams.has('zona')).toBe(false);
  });
});
