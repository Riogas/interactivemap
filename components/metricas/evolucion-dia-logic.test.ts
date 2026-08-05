import { describe, it, expect } from 'vitest';
import { buildEvolucionFetch, hayFases, serieEvolucion } from './evolucion-dia-logic';
import type { EvolucionCorrida } from '@/types/metricas-evolucion';

const FUNC = 'Estadisticas Cumplimiento';

function corrida(over: Partial<EvolucionCorrida>): EvolucionCorrida {
  return {
    corrida_at: '2026-08-05T08:00:00-03:00', zonas: 100,
    prom_motor: 60, prom_despacho: 50,
    f_predictivo: 0, f_gracia: 0, f_transito: 0, sin_movil: 0,
    entregados: 0, comun: 0, d_le25: null, m_le25: null,
    ...over,
  };
}

describe('buildEvolucionFetch()', () => {
  const base = {
    escenario: 1000, tipo: null, empresaSel: null,
    isRoot: true, empresasIds: [], funcionalidades: [FUNC],
  };

  it('skip sin escenario y fail-closed para no-root sin empresas', () => {
    expect(buildEvolucionFetch({ ...base, escenario: null }).skip).toBe(true);
    expect(buildEvolucionFetch({ ...base, isRoot: false }).skip).toBe(true);
  });

  it('arma URL y headers (root por header, tipo y empresa como params)', () => {
    const i = buildEvolucionFetch({ ...base, tipo: 'URGENTE', empresaSel: 7 });
    if (i.skip) throw new Error('no debía saltear');
    expect(i.url).toContain('/api/metricas/evolucion-dia?');
    expect(i.url).toContain('tipo=URGENTE');
    expect(i.url).toContain('empresa=7');
    expect(i.headers['x-track-isroot']).toBe('S');
  });
});

describe('hayFases()', () => {
  it('false con el día sin arranque; true si alguna corrida tuvo una fase', () => {
    expect(hayFases([corrida({})])).toBe(false);
    expect(hayFases([corrida({}), corrida({ f_gracia: 2 })])).toBe(true);
  });
});

describe('serieEvolucion()', () => {
  it('convierte el acumulado a 0..100 y respeta los null (sin común todavía)', () => {
    const s = serieEvolucion(
      [corrida({ d_le25: 0.7312, m_le25: null })],
      () => '08:00',
    );
    expect(s[0].hora).toBe('08:00');
    expect(s[0].d_le25).toBe(73.1);
    expect(s[0].m_le25).toBeNull();
  });
});
