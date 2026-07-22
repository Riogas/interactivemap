/**
 * Tests para lib/metricas/build-fact.ts — buildFact (AC6/AC7/AC8/AC9/AC11/AC14):
 * exclusiones con motivo, construcción del hecho (CAMPO/DERIVADO), fecha MVD,
 * dedupByPk (idempotencia dentro de un batch) y defaultRunRange.
 */

import { describe, it, expect } from 'vitest';
import { buildFact, dedupByPk, defaultRunRange, REPROCESS_DIAS, type SourceRow, type MetricaFact } from '@/lib/metricas/build-fact';
import { daysAgoMontevideo } from '@/lib/date-utils';

function baseRow(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 1001,
    escenario: 1,
    servicio_nombre: null,
    movil: 40,
    zona_nro: 10,
    empresa_fletera_id: 70,
    orden_cancelacion: 'N',
    estado_nro: 2,
    fch_hora_asignado: '2026-07-21T14:00:00Z',
    fch_hora_finalizacion: '2026-07-21T14:30:00Z',
    demora_movil_desde_asignacion_mins: null,
    ...overrides,
  };
}

describe('buildFact() — exclusiones (AC7)', () => {
  it('orden_cancelacion=S → excluido con motivo cancelado (aunque el resto sea válido)', () => {
    const result = buildFact(baseRow({ orden_cancelacion: 'S' }), 'PEDIDO', { chofer: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('cancelado');
  });

  it('estado_nro != 2 → excluido con motivo no_cumplido', () => {
    const result = buildFact(baseRow({ estado_nro: 1 }), 'PEDIDO', { chofer: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('no_cumplido');
  });

  it('fch_hora_finalizacion null → excluido con motivo no_cumplido', () => {
    const result = buildFact(baseRow({ fch_hora_finalizacion: null }), 'PEDIDO', { chofer: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('no_cumplido');
  });

  it('escenario null → excluido con motivo sin_escenario', () => {
    const result = buildFact(baseRow({ escenario: null }), 'PEDIDO', { chofer: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('sin_escenario');
  });

  it('sin fch_hora_asignado ni demora derivada → excluido con sin_asignado_calculable', () => {
    const result = buildFact(
      baseRow({ fch_hora_asignado: null, demora_movil_desde_asignacion_mins: null }),
      'PEDIDO',
      { chofer: null },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('sin_asignado_calculable');
  });

  it('demora negativa → excluido con demora_negativa', () => {
    const result = buildFact(
      baseRow({ fch_hora_asignado: '2026-07-21T15:00:00Z' }), // posterior a la finalización (14:30)
      'PEDIDO',
      { chofer: null },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('demora_negativa');
  });
});

describe('buildFact() — construcción del hecho (ok)', () => {
  it('CAMPO: usa fch_hora_asignado, asigna asignado_source=CAMPO', () => {
    const result = buildFact(baseRow(), 'PEDIDO', { chofer: 'Juan Perez' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fact.asignado_source).toBe('CAMPO');
      expect(result.fact.demora_mins).toBe(30);
      expect(result.fact.chofer).toBe('Juan Perez');
      expect(result.fact.origen).toBe('PEDIDO');
      expect(result.fact.pedido_id).toBe(1001);
      expect(result.fact.escenario).toBe(1);
    }
  });

  it('DERIVADO: sin fch_hora_asignado, usa demora_movil_desde_asignacion_mins', () => {
    const result = buildFact(
      baseRow({ fch_hora_asignado: null, demora_movil_desde_asignacion_mins: 22 }),
      'PEDIDO',
      { chofer: null },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fact.asignado_source).toBe('DERIVADO');
      expect(result.fact.demora_mins).toBe(22);
      expect(result.fact.fch_hora_asignado).toBeNull();
      expect(result.fact.chofer).toBeNull();
    }
  });

  it('SERVICE: tipo_servicio siempre SERVICE sin importar servicio_nombre', () => {
    const result = buildFact(baseRow({ servicio_nombre: 'URGENTE' }), 'SERVICE', { chofer: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fact.tipo_servicio).toBe('SERVICE');
  });

  it('PEDIDO: tipo_servicio se clasifica según servicio_nombre', () => {
    const r1 = buildFact(baseRow({ servicio_nombre: 'URGENTE' }), 'PEDIDO', { chofer: null });
    const r2 = buildFact(baseRow({ servicio_nombre: null }), 'PEDIDO', { chofer: null });
    expect(r1.ok && r1.fact.tipo_servicio).toBe('URGENTE');
    expect(r2.ok && r2.fact.tipo_servicio).toBe('COMUN');
  });

  it('movil null/0 → el hecho se registra igual (chofer=NULL vía ctx, OQ7)', () => {
    const result = buildFact(baseRow({ movil: 0 }), 'PEDIDO', { chofer: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fact.movil).toBe(0);
      expect(result.fact.chofer).toBeNull();
    }
  });

  it('fecha MVD boundary: cumplimiento 23:30 UY (=02:30 UTC día siguiente) cae en el día UY anterior (AC11)', () => {
    // 2026-07-22T02:30:00Z = 2026-07-21T23:30:00-03:00 (Montevideo)
    const result = buildFact(
      baseRow({
        fch_hora_asignado: '2026-07-22T02:00:00Z',
        fch_hora_finalizacion: '2026-07-22T02:30:00Z',
      }),
      'PEDIDO',
      { chofer: null },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fact.fecha).toBe('2026-07-21');
  });
});

describe('dedupByPk() — idempotencia (AC6)', () => {
  function fact(overrides: Partial<MetricaFact> = {}): MetricaFact {
    return {
      origen: 'PEDIDO',
      pedido_id: 1001,
      escenario: 1,
      fecha: '2026-07-21',
      tipo_servicio: 'COMUN',
      servicio_nombre: null,
      movil: 40,
      zona_nro: 10,
      empresa_fletera_id: 70,
      chofer: null,
      fch_hora_asignado: '2026-07-21T14:00:00Z',
      fch_hora_finalizacion: '2026-07-21T14:30:00Z',
      demora_mins: 30,
      asignado_source: 'CAMPO',
      ...overrides,
    };
  }

  it('sin duplicados: devuelve todas las filas', () => {
    const facts = [fact({ pedido_id: 1 }), fact({ pedido_id: 2 }), fact({ pedido_id: 3 })];
    expect(dedupByPk(facts)).toHaveLength(3);
  });

  it('misma PK repetida (origen,pedido_id,escenario) → una sola fila (último gana)', () => {
    const facts = [
      fact({ pedido_id: 1, demora_mins: 10 }),
      fact({ pedido_id: 1, demora_mins: 99 }), // reprocesado con otro valor
    ];
    const result = dedupByPk(facts);
    expect(result).toHaveLength(1);
    expect(result[0].demora_mins).toBe(99);
  });

  it('mismo pedido_id pero distinto origen/escenario → PKs distintas, no se deduplican', () => {
    const facts = [
      fact({ pedido_id: 1, origen: 'PEDIDO', escenario: 1 }),
      fact({ pedido_id: 1, origen: 'SERVICE', escenario: 1 }),
      fact({ pedido_id: 1, origen: 'PEDIDO', escenario: 2 }),
    ];
    expect(dedupByPk(facts)).toHaveLength(3);
  });

  it('correr dos veces la misma dedup sobre el mismo array da el mismo resultado (idempotente)', () => {
    const facts = [fact({ pedido_id: 1 }), fact({ pedido_id: 1 })];
    const once = dedupByPk(facts);
    const twice = dedupByPk(dedupByPk(facts));
    expect(once).toEqual(twice);
    expect(once).toHaveLength(1);
  });
});

describe('defaultRunRange()', () => {
  it('hasta = ayer, desde = hoy - REPROCESS_DIAS (ventana de reproceso)', () => {
    const now = new Date('2026-07-22T15:00:00Z'); // mediodía UY del 22/07
    const { desde, hasta } = defaultRunRange(now);
    expect(hasta).toBe(daysAgoMontevideo(1, now));
    expect(desde).toBe(daysAgoMontevideo(REPROCESS_DIAS, now));
    expect(hasta).toBe('2026-07-21');
    expect(desde).toBe('2026-07-19');
  });

  it('formato de salida siempre YYYY-MM-DD', () => {
    const { desde, hasta } = defaultRunRange(new Date('2026-07-22T15:00:00Z'));
    expect(desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
