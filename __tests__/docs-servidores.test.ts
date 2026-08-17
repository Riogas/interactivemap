/**
 * Tests de lib/docs/servidores.ts.
 *
 * El punto de este módulo: docs/api/openapi.json se versiona y el repo se clona, así que
 * ahí no van direcciones internas. El ambiente concreto se resuelve al servir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { servidorActual, servidoresDelDocumento } from '@/lib/docs/servidores';

const GENERADOS = [{ url: 'https://track.glp.riogas.com.uy', description: 'producción' }];

function req(headers: Record<string, string> = {}): { headers: Headers } {
  return { headers: new Headers(headers) };
}

const ENV_ORIGINAL = { docs: process.env.DOCS_BASE_URL, app: process.env.APP_BASE_URL };

beforeEach(() => {
  delete process.env.DOCS_BASE_URL;
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  if (ENV_ORIGINAL.docs === undefined) delete process.env.DOCS_BASE_URL;
  else process.env.DOCS_BASE_URL = ENV_ORIGINAL.docs;
  if (ENV_ORIGINAL.app === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = ENV_ORIGINAL.app;
});

describe('servidorActual', () => {
  it('DOCS_BASE_URL gana sobre todo lo demás', () => {
    process.env.DOCS_BASE_URL = 'https://track.glp.riogas.com.uy/';
    process.env.APP_BASE_URL = 'http://localhost:3002';

    expect(servidorActual(req({ host: 'otro:9999' }))).toBe('https://track.glp.riogas.com.uy');
  });

  it('si no hay DOCS_BASE_URL usa APP_BASE_URL', () => {
    process.env.APP_BASE_URL = 'http://localhost:3002';

    expect(servidorActual(req({ host: 'otro:9999' }))).toBe('http://localhost:3002');
  });

  it('sin env cae al Host del request, respetando x-forwarded-proto', () => {
    expect(servidorActual(req({ host: 'track.glp.riogas.com.uy', 'x-forwarded-proto': 'https' }))).toBe(
      'https://track.glp.riogas.com.uy',
    );
    expect(servidorActual(req({ host: 'localhost:3002' }))).toBe('http://localhost:3002');
  });

  it('sin env y sin Host devuelve null (no inventa una URL)', () => {
    expect(servidorActual(req())).toBeNull();
  });
});

describe('servidoresDelDocumento', () => {
  it('pone el ambiente actual primero y conserva el resto', () => {
    process.env.DOCS_BASE_URL = 'http://localhost:3002';

    expect(servidoresDelDocumento(req(), GENERADOS)).toEqual([
      { url: 'http://localhost:3002', description: 'ambiente actual' },
      { url: 'https://track.glp.riogas.com.uy', description: 'producción' },
    ]);
  });

  it('no duplica cuando el ambiente actual ya está en el documento', () => {
    process.env.DOCS_BASE_URL = 'https://track.glp.riogas.com.uy';

    expect(servidoresDelDocumento(req(), GENERADOS)).toEqual([
      { url: 'https://track.glp.riogas.com.uy', description: 'ambiente actual' },
    ]);
  });

  it('si no se puede resolver el ambiente deja el documento como está', () => {
    expect(servidoresDelDocumento(req(), GENERADOS)).toEqual(GENERADOS);
  });

  it('tolera un servers generado que no sea un array de servidores', () => {
    process.env.DOCS_BASE_URL = 'http://localhost:3002';

    expect(servidoresDelDocumento(req(), undefined)).toEqual([
      { url: 'http://localhost:3002', description: 'ambiente actual' },
    ]);
    expect(servidoresDelDocumento(req(), [{ nombre: 'sin url' }, 3, null])).toEqual([
      { url: 'http://localhost:3002', description: 'ambiente actual' },
    ]);
  });
});
