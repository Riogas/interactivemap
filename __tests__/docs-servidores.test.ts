/**
 * Tests de lib/docs/servidores.ts.
 *
 * Dos cosas se prueban acá y las dos importan:
 *
 * 1. docs/api/openapi.json se versiona y el repo se clona, así que ahí no van
 *    direcciones internas: el origen se resuelve al servir.
 * 2. **Ese origen no puede salir de un header.** Es el origen contra el que
 *    `POST /api/docs/try` ejecuta con el Bearer y el cookie jar del root, así que si lo
 *    eligiera el `Host` del request sería un SSRF con exfiltración de credenciales
 *    (era exactamente el agujero que tenía este archivo).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { ENV_ORIGEN, PUERTO_POR_DEFECTO, origenDeConfianza, servidoresDelDocumento } from '@/lib/docs/servidores';

beforeEach(() => {
  // El fail-closed avisa por consola; en los tests no ensucia la salida.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const GENERADOS = [{ url: 'https://track.glp.riogas.com.uy', description: 'producción' }];

/** Un `process.env` de mentira: los tests no tocan el del proceso. */
function env(valores: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return valores as NodeJS.ProcessEnv;
}

describe('origenDeConfianza', () => {
  it(`${ENV_ORIGEN} gana y se usa tal cual`, () => {
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'https://track.glp.riogas.com.uy' }))).toBe(
      'https://track.glp.riogas.com.uy',
    );
    // Con PORT seteado igual gana la env.
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'http://localhost:9999', PORT: '3002' }))).toBe(
      'http://localhost:9999',
    );
  });

  it('de la env se queda con el origen: path, query y credenciales se descartan', () => {
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'https://track.glp.riogas.com.uy/algo?x=1' }))).toBe(
      'https://track.glp.riogas.com.uy',
    );
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'http://usuario:clave@127.0.0.1:3002' }))).toBe(
      'http://127.0.0.1:3002',
    );
  });

  it('sin env cae al loopback con el PORT del proceso', () => {
    expect(origenDeConfianza(env({ PORT: '3002' }))).toBe('http://127.0.0.1:3002');
    expect(origenDeConfianza(env({ PORT: '3000' }))).toBe('http://127.0.0.1:3000');
  });

  it('sin env y sin PORT usa el puerto del repo', () => {
    expect(origenDeConfianza(env())).toBe(`http://127.0.0.1:${PUERTO_POR_DEFECTO}`);
  });

  it('el módulo no lee headers en ningún lado (regresión del SSRF)', async () => {
    const fuente = await readFile(path.join(process.cwd(), 'lib', 'docs', 'servidores.ts'), 'utf-8');
    // Sin comentarios: el docblock habla de headers justamente para explicar por qué
    // no se los mira, y eso no puede hacer fallar al test.
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(codigo).not.toMatch(/headers/i);
    expect(codigo).not.toMatch(/x-forwarded/i);
    expect(codigo).not.toMatch(/\breferer\b/i);
  });

  it('una env mal escrita no se adivina: devuelve null (fail-closed)', () => {
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'no-es-una-url' }))).toBeNull();
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'file:///etc/passwd' }))).toBeNull();
    expect(origenDeConfianza(env({ DOCS_TRY_ORIGEN: 'gopher://169.254.169.254' }))).toBeNull();
  });

  it('un PORT con basura tampoco se adivina', () => {
    expect(origenDeConfianza(env({ PORT: 'tres mil' }))).toBeNull();
    expect(origenDeConfianza(env({ PORT: '99999' }))).toBeNull();
    expect(origenDeConfianza(env({ PORT: '0' }))).toBeNull();
  });
});

describe('servidoresDelDocumento', () => {
  it('pone el origen del ejecutor primero y conserva el resto', () => {
    process.env.DOCS_TRY_ORIGEN = 'http://localhost:3002';
    try {
      expect(servidoresDelDocumento(GENERADOS)).toEqual([
        { url: 'http://localhost:3002', description: 'origen del ejecutor (Try it)' },
        { url: 'https://track.glp.riogas.com.uy', description: 'producción' },
      ]);
    } finally {
      delete process.env.DOCS_TRY_ORIGEN;
    }
  });

  it('no duplica cuando el origen ya está en el documento', () => {
    process.env.DOCS_TRY_ORIGEN = 'https://track.glp.riogas.com.uy';
    try {
      expect(servidoresDelDocumento(GENERADOS)).toEqual([
        { url: 'https://track.glp.riogas.com.uy', description: 'origen del ejecutor (Try it)' },
      ]);
    } finally {
      delete process.env.DOCS_TRY_ORIGEN;
    }
  });

  it('si el origen no se puede resolver deja el documento como está', () => {
    process.env.DOCS_TRY_ORIGEN = 'no-es-una-url';
    try {
      expect(servidoresDelDocumento(GENERADOS)).toEqual(GENERADOS);
    } finally {
      delete process.env.DOCS_TRY_ORIGEN;
    }
  });

  it('tolera un servers generado que no sea un array de servidores', () => {
    process.env.DOCS_TRY_ORIGEN = 'http://localhost:3002';
    try {
      expect(servidoresDelDocumento(undefined)).toEqual([
        { url: 'http://localhost:3002', description: 'origen del ejecutor (Try it)' },
      ]);
      expect(servidoresDelDocumento([{ nombre: 'sin url' }, 3, null])).toEqual([
        { url: 'http://localhost:3002', description: 'origen del ejecutor (Try it)' },
      ]);
    } finally {
      delete process.env.DOCS_TRY_ORIGEN;
    }
  });
});
