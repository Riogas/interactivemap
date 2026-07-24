/**
 * Tests para components/metricas/metricas-theme.ts — formatters puros
 * (formatMin/formatCount/formatPct) y orderPorTipo(), usados en toda la UI
 * del dashboard de métricas de cumplimiento (KpiCard, DetalleTable,
 * TrendChart, TipoBarChart) para renderizar valores potencialmente
 * null/NaN sin romper (edge cases de la spec: "rango vacío", "grupos N=1",
 * "atraso_vs_para_mins NULL").
 *
 * QA: run 20260724-141300-2wy. El repo no tiene infraestructura de test de
 * componentes React (sin @testing-library/react, vitest.config.ts usa
 * environment: 'node') — se cubre acá la lógica pura extraída/exportada,
 * consistente con el resto de la suite (lib/metricas/*.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { formatMin, formatCount, formatPct, orderPorTipo, INFO_TEXTS, COLOR_TIPO, DIMENSION_LABEL } from '@/components/metricas/metricas-theme';
import { TIPOS_SERVICIO } from '@/types/metricas-dashboard';
import type { PorTipoRow } from '@/types/metricas-dashboard';

describe('formatMin()', () => {
  it('null -> "—" (edge case: KPI sin datos, cantidad=0)', () => {
    expect(formatMin(null)).toBe('—');
  });

  it('undefined -> "—"', () => {
    expect(formatMin(undefined)).toBe('—');
  });

  it('NaN -> "—" (nunca debe filtrar NaN al DOM)', () => {
    expect(formatMin(NaN)).toBe('—');
  });

  it('redondea a 1 decimal', () => {
    expect(formatMin(24.666)).toBe('24.7');
    expect(formatMin(24.64)).toBe('24.6');
  });

  it('entero exacto no agrega decimales espurios', () => {
    expect(formatMin(30)).toBe('30');
  });

  it('valores >= 1000 usan separador de miles es-UY', () => {
    expect(formatMin(1234)).toBe(formatMin(1234)); // smoke: no explota
    expect(formatMin(1234)).toMatch(/1[.,]234/);
  });

  it('negativos (atraso "adelantado") se formatean con signo preservado', () => {
    expect(formatMin(-5.4)).toBe('-5.4');
  });

  it('grupo N=1: mediana=p90=min=max=promedio son el mismo valor único -> formatea igual sin crash', () => {
    const unico = 17.3;
    expect(formatMin(unico)).toBe('17.3');
    expect(formatMin(unico)).toBe(formatMin(unico));
  });

  it('cero se muestra como "0", no como "—" (0 min de demora es un dato válido, no "sin dato")', () => {
    expect(formatMin(0)).toBe('0');
  });
});

describe('formatCount()', () => {
  it('null -> "—"', () => {
    expect(formatCount(null)).toBe('—');
  });

  it('undefined -> "—"', () => {
    expect(formatCount(undefined)).toBe('—');
  });

  it('NaN -> "—"', () => {
    expect(formatCount(NaN)).toBe('—');
  });

  it('cero (cantidad=0, rango sin datos) -> "0", no "—"', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('redondea y separa miles', () => {
    expect(formatCount(1200)).toMatch(/1[.,]200/);
  });
});

describe('formatPct()', () => {
  it('null -> "—" (edge case: on_time_pct null cuando no hay atraso_vs_para_mins no-NULL)', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('undefined -> "—"', () => {
    expect(formatPct(undefined)).toBe('—');
  });

  it('NaN -> "—"', () => {
    expect(formatPct(NaN)).toBe('—');
  });

  it('0.72 -> "72%"', () => {
    expect(formatPct(0.72)).toBe('72%');
  });

  it('0 -> "0%" (0% a tiempo es un dato válido, no ausencia de dato)', () => {
    expect(formatPct(0)).toBe('0%');
  });

  it('1 -> "100%"', () => {
    expect(formatPct(1)).toBe('100%');
  });

  it('redondea a 1 decimal de porcentaje', () => {
    expect(formatPct(0.7234)).toBe('72.3%');
  });
});

describe('orderPorTipo()', () => {
  it('reordena al orden canónico URGENTE,NOCTURNO,ESPECIAL,OTROS,SERVICE sin importar el orden de entrada', () => {
    const input: PorTipoRow[] = [
      { tipo_servicio: 'SERVICE', promedio: 5, cantidad: 1 },
      { tipo_servicio: 'URGENTE', promedio: 10, cantidad: 2 },
    ];
    const out = orderPorTipo(input);
    expect(out.map((r) => r.tipo_servicio)).toEqual(TIPOS_SERVICIO);
  });

  it('edge case "dimensión/por_tipo sin datos": array vacío -> completa los 5 tipos con cantidad=0/promedio=null (no rompe el render de barras)', () => {
    const out = orderPorTipo([]);
    expect(out).toHaveLength(5);
    for (const row of out) {
      expect(row.cantidad).toBe(0);
      expect(row.promedio).toBeNull();
    }
    expect(out.map((r) => r.tipo_servicio)).toEqual(TIPOS_SERVICIO);
  });

  it('tipo parcial: solo un tipo con datos -> los otros 4 quedan en cantidad=0/promedio=null, ninguno se descarta', () => {
    const out = orderPorTipo([{ tipo_servicio: 'NOCTURNO', promedio: 42.5, cantidad: 8 }]);
    expect(out).toHaveLength(5);
    const nocturno = out.find((r) => r.tipo_servicio === 'NOCTURNO');
    expect(nocturno).toEqual({ tipo_servicio: 'NOCTURNO', promedio: 42.5, cantidad: 8 });
    const otros = out.filter((r) => r.tipo_servicio !== 'NOCTURNO');
    expect(otros.every((r) => r.cantidad === 0 && r.promedio === null)).toBe(true);
  });

  it('no muta el array de entrada', () => {
    const input: PorTipoRow[] = [{ tipo_servicio: 'URGENTE', promedio: 1, cantidad: 1 }];
    const inputCopy = JSON.parse(JSON.stringify(input));
    orderPorTipo(input);
    expect(input).toEqual(inputCopy);
  });
});

describe('COLOR_TIPO / DIMENSION_LABEL / INFO_TEXTS — contrato de datos consumido por la UI', () => {
  it('COLOR_TIPO tiene una entrada por cada uno de los 5 tipos, todas como var(--color-metricas-*) (nunca hex literal)', () => {
    for (const t of TIPOS_SERVICIO) {
      expect(COLOR_TIPO[t]).toMatch(/^var\(--color-metricas-/);
    }
  });

  it('DIMENSION_LABEL cubre las 3 dimensiones (chofer/movil/zona)', () => {
    expect(Object.keys(DIMENSION_LABEL).sort()).toEqual(['chofer', 'movil', 'zona']);
  });

  it('INFO_TEXTS (E3) trae título+texto no vacíos para las 5 KpiCard + las 4 secciones analíticas', () => {
    const keys = [
      'kpi_promedio',
      'kpi_mediana',
      'kpi_p90',
      'kpi_cumplidos',
      'kpi_atraso',
      'tendencia',
      'por_tipo',
      'ranking',
      'tabla',
    ] as const;
    for (const k of keys) {
      expect(INFO_TEXTS[k].title.length).toBeGreaterThan(0);
      expect(INFO_TEXTS[k].text.length).toBeGreaterThan(20);
    }
  });
});
