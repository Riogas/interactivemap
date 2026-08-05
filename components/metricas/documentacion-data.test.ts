import { describe, it, expect } from 'vitest';
import { CAMPOS_MODELO_LISTA } from '@/lib/demoras-campos';
import { PERILLAS_DOC, GRUPOS_PERILLAS, VIAJE_PEDIDO, EJEMPLO_PREDICTIVO } from './documentacion-data';

describe('documentación viva — el contrato de actualización automática', () => {
  it('CADA perilla del motor está documentada (agregar una sin doc rompe este test a propósito)', () => {
    const sinDoc = CAMPOS_MODELO_LISTA.filter((k) => !(k in PERILLAS_DOC));
    expect(
      sinDoc,
      `Perillas sin documentar en documentacion-data.ts: ${sinDoc.join(', ')} — la documentación viva DEBE explicar cada perilla nueva`,
    ).toEqual([]);
  });

  it('no hay documentación huérfana (perillas que ya no existen)', () => {
    const huerfanas = Object.keys(PERILLAS_DOC).filter(
      (k) => !(CAMPOS_MODELO_LISTA as readonly string[]).includes(k),
    );
    expect(huerfanas).toEqual([]);
  });

  it('cada perilla apunta a un grupo válido del render', () => {
    for (const [key, d] of Object.entries(PERILLAS_DOC)) {
      expect(GRUPOS_PERILLAS, `grupo inválido en ${key}: ${d.grupo}`).toContain(d.grupo);
    }
  });

  it('las explicaciones son para personas: sin jerga de tablas ni SQL', () => {
    const todo = Object.values(PERILLAS_DOC).map((d) => `${d.label} ${d.explica}`).join(' ');
    expect(todo).not.toMatch(/demoras_(?!modelo)|SELECT |jsonb|plpgsql|corrida_at/);
  });

  it('el viaje del pedido y el ejemplo predictivo están completos', () => {
    expect(VIAJE_PEDIDO.length).toBeGreaterThanOrEqual(5);
    expect(EJEMPLO_PREDICTIVO[0].publica).toBe(75);
    expect(EJEMPLO_PREDICTIVO[EJEMPLO_PREDICTIVO.length - 1].fase).toBe('Motor normal');
  });
});
