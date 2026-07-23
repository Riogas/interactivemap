/**
 * Tests para lib/metricas/tipo-servicio.ts — clasificación URGENTE/NOCTURNO/OTROS/SERVICE
 * (AC9/AC14) y buildComunOrFilter (regla compartida con capacidad-snapshot, OQ1).
 */

import { describe, it, expect } from 'vitest';
import {
  esServicioEspecial,
  clasificarTipoServicioPedido,
  clasificarTipoServicio,
  buildComunOrFilter,
  SERVICIO_NOMBRE_ESPECIALES,
} from '@/lib/metricas/tipo-servicio';

describe('esServicioEspecial()', () => {
  it('true para URGENTE', () => {
    expect(esServicioEspecial('URGENTE')).toBe(true);
  });

  it('true para NOCTURNO', () => {
    expect(esServicioEspecial('NOCTURNO')).toBe(true);
  });

  it('normaliza trim + uppercase', () => {
    expect(esServicioEspecial('  urgente ')).toBe(true);
    expect(esServicioEspecial('noCturno')).toBe(true);
  });

  it('false para otros valores', () => {
    expect(esServicioEspecial('GAS 13KG')).toBe(false);
  });

  it('false para null/undefined/vacío', () => {
    expect(esServicioEspecial(null)).toBe(false);
    expect(esServicioEspecial(undefined)).toBe(false);
    expect(esServicioEspecial('')).toBe(false);
  });
});

describe('clasificarTipoServicioPedido()', () => {
  it('URGENTE exacto → URGENTE', () => {
    expect(clasificarTipoServicioPedido('URGENTE')).toBe('URGENTE');
  });

  it('NOCTURNO exacto → NOCTURNO', () => {
    expect(clasificarTipoServicioPedido('NOCTURNO')).toBe('NOCTURNO');
  });

  it('normaliza trim + uppercase antes de comparar', () => {
    expect(clasificarTipoServicioPedido(' urgente')).toBe('URGENTE');
    expect(clasificarTipoServicioPedido('Nocturno ')).toBe('NOCTURNO');
  });

  it('null → OTROS', () => {
    expect(clasificarTipoServicioPedido(null)).toBe('OTROS');
  });

  it('undefined → OTROS', () => {
    expect(clasificarTipoServicioPedido(undefined)).toBe('OTROS');
  });

  it('cualquier otro valor → OTROS', () => {
    expect(clasificarTipoServicioPedido('GAS 13KG')).toBe('OTROS');
    expect(clasificarTipoServicioPedido('')).toBe('OTROS');
  });
});

describe('clasificarTipoServicio()', () => {
  it('origen SERVICE → siempre SERVICE, sin importar servicio_nombre', () => {
    expect(clasificarTipoServicio('SERVICE', null)).toBe('SERVICE');
    expect(clasificarTipoServicio('SERVICE', 'URGENTE')).toBe('SERVICE');
  });

  it('origen PEDIDO delega en clasificarTipoServicioPedido', () => {
    expect(clasificarTipoServicio('PEDIDO', 'URGENTE')).toBe('URGENTE');
    expect(clasificarTipoServicio('PEDIDO', 'NOCTURNO')).toBe('NOCTURNO');
    expect(clasificarTipoServicio('PEDIDO', null)).toBe('OTROS');
    expect(clasificarTipoServicio('PEDIDO', 'GAS 13KG')).toBe('OTROS');
  });
});

describe('buildComunOrFilter()', () => {
  it('devuelve EXACTAMENTE el string esperado por capacidad-snapshot (regresión OQ1)', () => {
    expect(buildComunOrFilter()).toBe(
      'servicio_nombre.is.null,and(servicio_nombre.neq.URGENTE,servicio_nombre.neq.NOCTURNO)',
    );
  });

  it('se construye dinámicamente desde SERVICIO_NOMBRE_ESPECIALES (fuente única)', () => {
    const neqClauses = SERVICIO_NOMBRE_ESPECIALES.map((v) => `servicio_nombre.neq.${v}`).join(',');
    expect(buildComunOrFilter()).toBe(`servicio_nombre.is.null,and(${neqClauses})`);
  });
});
