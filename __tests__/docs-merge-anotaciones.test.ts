/**
 * Tests del merge de anotaciones sobre el catálogo generado (lib/docs/merge-spec.ts).
 *
 * La regla del módulo es "la anotación siempre gana", con UNA excepción que importa:
 * `x-auth` —los gates que el generador leyó del código— no se pisa nunca. Si alguien
 * pudiera declarar a mano que un endpoint está protegido, el apartado "Estado de la
 * autenticación" del portal dejaría de ser un relevamiento y pasaría a ser una opinión.
 *
 * Se testea contra el archivo REAL del repo, no contra un fixture: lo que se quiere
 * saber es que docs/api/anotaciones.yaml produce lo que el visor espera.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { mergearAnotaciones } from '@/lib/docs/merge-spec';

const RAIZ = process.cwd();
const generado = JSON.parse(
  readFileSync(path.join(RAIZ, 'docs', 'api', 'openapi.json'), 'utf-8'),
) as Record<string, unknown>;
const yaml = readFileSync(path.join(RAIZ, 'docs', 'api', 'anotaciones.yaml'), 'utf-8');

const { spec } = mergearAnotaciones(generado, yaml);
const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

describe('merge de anotaciones — endpoint de integración completo', () => {
  const pedidos = paths['/api/import/pedidos'].post;

  it('trae consumidores, nota de auth y notas', () => {
    expect(pedidos['x-consumidores']).toEqual(['Sender de GeneXus / SGM (AS400)']);
    expect(String(pedidos['x-auth-nota'])).toContain('INTERNAL_API_KEY');
    expect(String(pedidos['x-notas'])).toContain('FchHoraAsignado');
  });

  it('el cuerpo del request llega con schema de campos y ejemplo', () => {
    const cuerpo = pedidos.requestBody as {
      required?: boolean;
      content?: Record<string, { example?: unknown }>;
      'x-campos'?: Array<{ nombre: string; requerido?: boolean }>;
    };

    expect(cuerpo.required).toBe(true);
    expect(cuerpo['x-campos']?.map((c) => c.nombre)).toContain('FchHoraAsignado');
    expect(cuerpo['x-campos']?.find((c) => c.nombre === 'id')?.requerido).toBe(true);
    expect(String(cuerpo.content?.['application/json']?.example)).toContain('"EscenarioId": 1000');
  });

  it('las respuestas quedan con descripción y ejemplo por código', () => {
    const respuestas = pedidos.responses as Record<string, { description?: string; content?: Record<string, { example?: unknown }> }>;

    expect(respuestas['200'].description).toContain('insertados o actualizados');
    expect(String(respuestas['200'].content?.['application/json']?.example)).toContain('"success": true');
    expect(respuestas['403'].description).toContain('API_KEY_MISSING');
  });

  it('los errores conocidos llegan como tabla', () => {
    const errores = pedidos['x-errores'] as Array<{ codigo?: number; code?: string; cuando?: string }>;

    expect(errores.map((e) => e.code)).toContain('SERVER_MISCONFIGURED');
    expect(errores.find((e) => e.code === 'API_KEY_MISSING')?.codigo).toBe(403);
  });

  it('los ejemplos anotados no pisan nada, se suman', () => {
    const ejemplos = pedidos['x-ejemplos'] as Array<{ titulo?: string; codigo?: string }>;

    expect(ejemplos[0].titulo).toBe('curl (real)');
    expect(String(ejemplos[0].codigo)).toContain('x-api-key');
  });
});

describe('merge de anotaciones — lo que NO se puede pisar', () => {
  it('`x-auth` (los gates leídos del código) queda intacto aunque la anotación declare badges', () => {
    const gps = paths['/api/import/gps'].post;

    expect(gps['x-auth-badges']).toEqual(['x-api-key', 'token en body']);
    // Lo que el generador leyó del handler sigue siendo lo que el portal reporta.
    expect(gps['x-auth']).toMatchObject({ sinGate: false, gates: ['header x-api-key'] });
  });

  it('un endpoint sin gate sigue marcado como sin gate después de anotarlo', () => {
    const zonas = paths['/api/zonas'].get;

    expect(zonas['x-anotado']).toBe(true);
    expect((zonas['x-auth'] as { sinGate?: boolean }).sinGate).toBe(true);
  });
});

describe('merge de anotaciones — parámetros', () => {
  it('completa un parámetro de path que el generador no declara', () => {
    const movil = paths['/api/movil/{id}'].get;
    const params = movil.parameters as Array<{ name: string; in: string; required?: boolean; example?: unknown }>;
    const id = params.find((p) => p.name === 'id');

    expect(id).toMatchObject({ in: 'path', required: true, example: 330 });
  });

  it('no duplica un parámetro que el docblock ya había declarado', () => {
    const latest = paths['/api/latest'].get;
    const params = latest.parameters as Array<{ name: string }>;

    expect(params.filter((p) => p.name === 'movilId')).toHaveLength(1);
  });
});

describe('merge de anotaciones — módulos', () => {
  it('la descripción del módulo va a los tags del documento', () => {
    const tags = spec.tags as Array<{ name: string; description?: string }>;

    expect(tags.find((t) => t.name === 'import')?.description).toContain('sender de GeneXus');
    expect(tags.find((t) => t.name === 'docs')?.description).toContain('fail-closed');
  });
});
