import { describe, it, expect } from 'vitest';
import { buildZonaCorridaFetch, ordenarZonas, filtrarZonas, FASE_LABEL } from './zona-corrida-logic';
import type { ZonaCorridaFila } from '@/types/metricas-evolucion';

const FUNC = 'Estadisticas Cumplimiento';

function fila(over: Partial<ZonaCorridaFila>): ZonaCorridaFila {
  return {
    zona_id: 1, tipo_servicio: 'URGENTE', motor: 60, despacho: 45, brecha: 15,
    arranque_fase: null, sin_capacidad: false, cola_por_delante: 0, ritmo_usado: 12,
    moviles_prioridad: 1, moviles_transito: 0,
    entregados: 10, comun: 10, d_le25: 0.8, m_le25: 0.6,
    ...over,
  };
}

describe('buildZonaCorridaFetch()', () => {
  const base = {
    escenario: 1000, tipo: 'URGENTE' as const, corrida: null,
    empresaSel: null, isRoot: true, empresasIds: [], funcionalidades: [FUNC],
  };

  it('skip sin escenario y fail-closed no-root sin empresas', () => {
    expect(buildZonaCorridaFetch({ ...base, escenario: null }).skip).toBe(true);
    expect(buildZonaCorridaFetch({ ...base, isRoot: false }).skip).toBe(true);
  });

  it('sin corrida (última en vivo) el param no viaja; con corrida sí', () => {
    const vivo = buildZonaCorridaFetch(base);
    if (vivo.skip) throw new Error('no debía saltear');
    expect(vivo.url).not.toContain('corrida=');
    const fija = buildZonaCorridaFetch({ ...base, corrida: '2026-08-05T10:00:00-03:00' });
    if (fija.skip) throw new Error('no debía saltear');
    expect(fija.url).toContain('corrida=2026-08-05T10%3A00%3A00-03%3A00');
  });
});

describe('ordenarZonas()', () => {
  const zonas = [
    fila({ zona_id: 1, brecha: 10, m_le25: 0.9, comun: 5 }),
    fila({ zona_id: 2, brecha: -40, m_le25: 0.2, comun: 8 }),
    fila({ zona_id: 3, brecha: 25, m_le25: null, comun: 0 }),
  ];

  it('brecha: por |motor − Despacho| descendente', () => {
    expect(ordenarZonas(zonas, 'brecha').map((z) => z.zona_id)).toEqual([2, 3, 1]);
  });

  it('acierto_motor: el peor % del motor primero; sin entregas al final', () => {
    expect(ordenarZonas(zonas, 'acierto_motor').map((z) => z.zona_id)).toEqual([2, 1, 3]);
  });

  it('zona: numérico ascendente', () => {
    expect(ordenarZonas(zonas, 'zona').map((z) => z.zona_id)).toEqual([1, 2, 3]);
  });
});

describe('filtrarZonas()', () => {
  it('prefijo numérico: "45" matchea 45 y 451, no 145', () => {
    const zonas = [fila({ zona_id: 45 }), fila({ zona_id: 451 }), fila({ zona_id: 145 })];
    expect(filtrarZonas(zonas, '45').map((z) => z.zona_id)).toEqual([45, 451]);
    expect(filtrarZonas(zonas, '').length).toBe(3);
  });
});

describe('FASE_LABEL', () => {
  it('cubre las tres fases del arranque', () => {
    expect(Object.keys(FASE_LABEL).sort()).toEqual(['GRACIA_VENCIDA', 'PREDICTIVO', 'TRANSITO']);
  });
});
