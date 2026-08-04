/**
 * Tests de components/metricas/desfasaje-logic.ts — lógica pura de la card
 * "Acierto de la demora" (sin render; vitest environment: 'node').
 */

import { describe, it, expect } from 'vitest';
import {
  buildDesfasajeFetch,
  filasGrafico,
  kpisDeFuente,
  mensajeVacioDesfasaje,
  esFranjaKpi,
  FUENTE_LABEL,
} from './desfasaje-logic';
import type { DesfasajeData, FranjaDesfasaje } from '@/types/metricas-desfasaje';

const FUNC = 'Estadisticas Cumplimiento';

function franja(over: Partial<FranjaDesfasaje>): FranjaDesfasaje {
  return {
    tope: 5, label: '5',
    informada_n: 0, informada_pct: null,
    calculada_n: 0, calculada_pct: null,
    comun_informada_n: 0, comun_informada_pct: null,
    comun_calculada_n: 0, comun_calculada_pct: null,
    ...over,
  };
}

function datos(over: Partial<DesfasajeData> = {}): DesfasajeData {
  return {
    rango: { desde: '2026-07-05', hasta: '2026-08-03' },
    kpis: {
      informada: { n: 400, pct_le_25: 0.8, pct_le_90: 0.95, p80: 24.5 },
      calculada: { n: 120, pct_le_25: 0.85, pct_le_90: 0.97, p80: 21.1 },
      comun: {
        n: 110,
        informada: { pct_le_25: 0.79, pct_le_90: 0.94, p80: 25.2 },
        calculada: { pct_le_25: 0.86, pct_le_90: 0.98, p80: 20.4 },
      },
    },
    franjas: [],
    ...over,
  };
}

describe('buildDesfasajeFetch()', () => {
  const base = { escenario: 1000, tipo: null, dias: 30, empresaSel: null, funcionalidades: [FUNC] };

  it('sin escenario -> skip (no se toca la red)', () => {
    expect(buildDesfasajeFetch({ ...base, escenario: null, isRoot: true, empresasIds: [] }).skip).toBe(true);
  });

  it('no-root sin empresas -> skip (fail-closed conocido de antemano)', () => {
    expect(buildDesfasajeFetch({ ...base, isRoot: false, empresasIds: [] }).skip).toBe(true);
  });

  it('root -> x-track-isroot, sin header de empresas', () => {
    const i = buildDesfasajeFetch({ ...base, isRoot: true, empresasIds: [] });
    if (i.skip) throw new Error('unreachable');
    expect(i.headers['x-track-isroot']).toBe('S');
    expect(i.headers['x-track-empresas-ids']).toBeUndefined();
    expect(i.url).toBe('/api/metricas/desfasaje?escenario=1000&dias=30');
  });

  it('no-root -> scope por header x-track-empresas-ids (patrón metricas/dashboard, no query)', () => {
    const i = buildDesfasajeFetch({ ...base, isRoot: false, empresasIds: [70, 80] });
    if (i.skip) throw new Error('unreachable');
    expect(i.headers['x-track-empresas-ids']).toBe('70,80');
    expect(i.headers['x-track-isroot']).toBeUndefined();
    expect(new URL(i.url, 'http://x').searchParams.has('empresaIds')).toBe(false);
  });

  it('tipo elegido viaja; dias siempre viaja; x-track-funcs siempre', () => {
    const i = buildDesfasajeFetch({ ...base, tipo: 'NOCTURNO', dias: 90, isRoot: true, empresasIds: [] });
    if (i.skip) throw new Error('unreachable');
    const u = new URL(i.url, 'http://x');
    expect(u.searchParams.get('tipo')).toBe('NOCTURNO');
    expect(u.searchParams.get('dias')).toBe('90');
    expect(i.headers['x-track-funcs']).toBe(FUNC);
  });

  // Fix Important del review: sin este param, el filtro Empresa de la
  // página aplicaba a todas las cards MENOS a esta — el usuario leía el
  // KPI agregado de todo el scope como si fuera de su fletera.
  it('empresa elegida en la FiltersBar viaja como query param', () => {
    const i = buildDesfasajeFetch({ ...base, empresaSel: 7, isRoot: true, empresasIds: [] });
    if (i.skip) throw new Error('unreachable');
    expect(new URL(i.url, 'http://x').searchParams.get('empresa')).toBe('7');
  });

  it('sin empresa elegida, el param no viaja', () => {
    const i = buildDesfasajeFetch({ ...base, isRoot: true, empresasIds: [] });
    if (i.skip) throw new Error('unreachable');
    expect(new URL(i.url, 'http://x').searchParams.has('empresa')).toBe(false);
  });
});

describe('esFranjaKpi()', () => {
  it('la frontera es 25 INCLUSIVE (la franja 25 ES parte del KPI)', () => {
    expect(esFranjaKpi('25')).toBe(true);
    expect(esFranjaKpi('30')).toBe(false);
  });

  it('las franjas bajas son KPI; "90+" no (y Number("90+") es NaN, no revienta)', () => {
    expect(esFranjaKpi('5')).toBe(true);
    expect(esFranjaKpi('90+')).toBe(false);
  });
});

describe('filasGrafico()', () => {
  const franjas = [
    franja({ tope: 5, label: '5', informada_n: 40, informada_pct: 0.4, calculada_n: 7, calculada_pct: 0.07, comun_informada_n: 3, comun_informada_pct: 0.03, comun_calculada_n: 9, comun_calculada_pct: 0.09 }),
    franja({ tope: 95, label: '90+', informada_n: 2, informada_pct: 0.02 }),
  ];

  it('informada: pct de la población completa, en 0..100 con 1 decimal', () => {
    const filas = filasGrafico(franjas, 'informada');
    expect(filas[0]).toMatchObject({ label: '5', principal: 40, principal_n: 40, secundaria: null });
    expect(filas[1]).toMatchObject({ label: '90+', principal: 2, principal_n: 2 });
  });

  it('calculada: usa la serie calculada (7%, no 40%)', () => {
    const filas = filasGrafico(franjas, 'calculada');
    expect(filas[0]).toMatchObject({ principal: 7, principal_n: 7 });
  });

  it('comparar: AMBAS series salen de la población común (no mezcla poblaciones)', () => {
    const filas = filasGrafico(franjas, 'comparar');
    expect(filas[0]).toMatchObject({ principal: 3, principal_n: 3, secundaria: 9, secundaria_n: 9 });
  });

  it('pct null queda null (hueco en el gráfico, no un 0 falso)', () => {
    const filas = filasGrafico([franja({ informada_pct: null })], 'informada');
    expect(filas[0].principal).toBeNull();
  });

  it('el pct conserva 1 decimal (0.123 -> 12.3, no 12)', () => {
    // Mutante cazado en el review: Math.round(x*100) pasaba toda la suite
    // porque los fixtures eran múltiplos exactos.
    const filas = filasGrafico([franja({ informada_pct: 0.123 })], 'informada');
    expect(filas[0].principal).toBe(12.3);
  });
});

describe('kpisDeFuente()', () => {
  it('informada y calculada devuelven su población, sin secundaria', () => {
    const k = kpisDeFuente(datos(), 'informada');
    expect(k?.principal.n).toBe(400);
    expect(k?.principal.pct_le_25).toBe(0.8);
    expect(k?.secundaria).toBeNull();
    expect(kpisDeFuente(datos(), 'calculada')?.principal.p80).toBe(21.1);
  });

  it('comparar: los dos juegos con el n de la población común', () => {
    const k = kpisDeFuente(datos(), 'comparar');
    expect(k?.principal).toEqual({ n: 110, pct_le_25: 0.79, pct_le_90: 0.94, p80: 25.2 });
    expect(k?.secundaria).toEqual({ n: 110, pct_le_25: 0.86, pct_le_90: 0.98, p80: 20.4 });
  });

  it('sin kpis -> null', () => {
    expect(kpisDeFuente(datos({ kpis: null }), 'informada')).toBeNull();
  });
});

describe('mensajeVacioDesfasaje()', () => {
  it('con datos -> null (no hay mensaje)', () => {
    expect(mensajeVacioDesfasaje('informada', datos())).toBeNull();
    expect(mensajeVacioDesfasaje('comparar', datos())).toBeNull();
  });

  it('data null = "todavía no se consultó" -> NULL (skeleton), no un "sin datos" falso', () => {
    // Fix del review: la card flasheaba 'Todavía no hay pedidos...' mientras
    // el escenario de la página resolvía, sin haber consultado nada.
    expect(mensajeVacioDesfasaje('informada', null)).toBeNull();
  });

  it('kpis null (respuesta real vacía) -> mensaje genérico', () => {
    expect(mensajeVacioDesfasaje('informada', datos({ kpis: null }))).toMatch(/Todavía no hay pedidos/);
  });

  it('informada.n = 0 con kpis presentes -> mensaje (rama que el review encontró sin test)', () => {
    const d = datos();
    d.kpis!.informada.n = 0;
    expect(mensajeVacioDesfasaje('informada', d)).toMatch(/Todavía no hay pedidos/);
  });

  it('comparar sin población común -> explica que el motor es reciente, no un "sin datos" seco', () => {
    const d = datos();
    d.kpis!.comun.n = 0;
    const msg = mensajeVacioDesfasaje('comparar', d);
    expect(msg).toMatch(/29\/07/);
    expect(msg).toMatch(/común/);
  });

  it('calculada sin datos -> idem motor reciente', () => {
    const d = datos();
    d.kpis!.calculada.n = 0;
    expect(mensajeVacioDesfasaje('calculada', d)).toMatch(/29\/07/);
  });
});

describe('FUENTE_LABEL', () => {
  it('etiquetas humanas para el selector (sin jerga interna)', () => {
    expect(FUENTE_LABEL.informada).toMatch(/Despacho/);
    expect(FUENTE_LABEL.calculada).toMatch(/motor/);
    expect(FUENTE_LABEL.comparar).toMatch(/común/);
  });
});
