/**
 * Tests del ejecutor del portal /docs: POST /api/docs/try y su validación
 * (lib/docs/try-request.ts).
 *
 * Cubre las reglas no negociables de §5.3 de la spec:
 *   - solo paths /api/... del propio host (nada de proxy abierto, URL absoluta,
 *     protocol-relative ni traversal);
 *   - escrituras con confirmación escrita del path (428 si falta);
 *   - GET directo;
 *   - sin ser root, ni se mira el payload.
 *
 * Los tests del handler usan el requireRoot REAL (token firmado + secapi mockeado):
 * un test que mockea el gate no prueba que el gate esté puesto.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { resetDocsGuardCache } from '@/lib/docs/root-guard';
import {
  decodificarPayload,
  sanearHeaders,
  validarPath,
  validarPeticion,
  construirUrl,
} from '@/lib/docs/try-request';
import { POST } from '@/app/api/docs/try/route';

const SECRETO = 'secreto-de-prueba-que-no-es-el-default-0123456789';
const SECAPI_URL = 'http://secapi.test';
const ORIGEN = 'http://localhost:3002';

function token(payload: Record<string, unknown> = { username: 'dmedaglia', userId: 42 }): string {
  return jwt.sign({ iss: 'security-suite', sistema: 'RiogasTracking', ...payload }, SECRETO, {
    expiresIn: '7d',
  });
}

/** Codifica el payload como lo hace el navegador: JSON → base64. */
function sobre(payload: Record<string, unknown>): string {
  return JSON.stringify({ payload: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64') });
}

function pedido(payload: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGEN}/api/docs/try`, {
    method: 'POST',
    headers: {
      host: 'localhost:3002',
      'content-type': 'application/json',
      authorization: `Bearer ${token()}`,
      ...headers,
    },
    body: sobre(payload),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
/** Lo que devuelve el endpoint llamado. Se puede pisar en cada test. */
let respuestaDestino: { status: number; statusText: string; cuerpo: string };
/** Lo que contesta secapi al gate. */
let permisoSecapi: { estado: number; cuerpo: unknown };

const ENV = {
  jwt: process.env.JWT_SECRET,
  secapi: process.env.SECURITY_SUITE_URL,
  docsBase: process.env.DOCS_BASE_URL,
  appBase: process.env.APP_BASE_URL,
};

beforeEach(() => {
  resetDocsGuardCache();
  process.env.JWT_SECRET = SECRETO;
  process.env.SECURITY_SUITE_URL = SECAPI_URL;
  delete process.env.DOCS_BASE_URL;
  delete process.env.APP_BASE_URL;

  respuestaDestino = { status: 200, statusText: 'OK', cuerpo: '{"ok":true}' };
  permisoSecapi = { estado: 200, cuerpo: { permitido: 'GRANTED', razon: 'ROOT' } };

  fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith('/api/db/permisos')) {
      return {
        status: permisoSecapi.estado,
        ok: permisoSecapi.estado >= 200 && permisoSecapi.estado < 300,
        json: async () => permisoSecapi.cuerpo,
      } as unknown as Response;
    }
    return {
      status: respuestaDestino.status,
      statusText: respuestaDestino.statusText,
      ok: respuestaDestino.status < 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: null,
      text: async () => respuestaDestino.cuerpo,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const [clave, valor] of [
    ['JWT_SECRET', ENV.jwt],
    ['SECURITY_SUITE_URL', ENV.secapi],
    ['DOCS_BASE_URL', ENV.docsBase],
    ['APP_BASE_URL', ENV.appBase],
  ] as const) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Las llamadas que salieron al endpoint de destino (no las del gate a secapi). */
function llamadasAlDestino(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls
    .filter(([url]) => !String(url).endsWith('/api/db/permisos'))
    .map(([url, init]) => [String(url), (init ?? {}) as RequestInit]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/docs/try — gate root', () => {
  it('sin ser root devuelve 403 y NO ejecuta nada', async () => {
    permisoSecapi = { estado: 403, cuerpo: { permitido: 'DENIED', razon: 'ACCESS_DENIED' } };

    const res = await POST(pedido({ metodo: 'GET', path: '/api/server-time' }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ success: false, code: 'ACCESS_DENIED' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('sin token devuelve 401 y NO ejecuta nada', async () => {
    const req = new NextRequest(`${ORIGEN}/api/docs/try`, {
      method: 'POST',
      headers: { host: 'localhost:3002', 'content-type': 'application/json' },
      body: sobre({ metodo: 'GET', path: '/api/server-time' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(llamadasAlDestino()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nunca es un proxy abierto
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/docs/try — solo el propio host, solo /api/', () => {
  it('un path fuera de /api se rechaza', async () => {
    const res = await POST(pedido({ metodo: 'GET', path: '/dashboard/stats' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'PATH_FUERA_DE_API' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('una URL absoluta se rechaza (no es un proxy abierto)', async () => {
    const res = await POST(pedido({ metodo: 'GET', path: 'http://169.254.169.254/latest/meta-data' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'PATH_INVALIDO' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('un //host protocol-relative se rechaza', async () => {
    const res = await POST(pedido({ metodo: 'GET', path: '//evil.example.com/api/robar' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'PATH_INVALIDO' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('un traversal se rechaza, crudo y codificado', async () => {
    for (const path of ['/api/../../etc/passwd', '/api/%2e%2e/%2e%2e/etc/passwd', '/api/x/..%2fy']) {
      const res = await POST(pedido({ metodo: 'GET', path }));
      expect(res.status, path).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'PATH_INVALIDO' });
    }
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('el ejecutor no se llama a sí mismo', async () => {
    const res = await POST(pedido({ metodo: 'GET', path: '/api/docs/try' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'PATH_BLOQUEADO' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lectura y escritura
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/docs/try — ejecución', () => {
  it('un GET se ejecuta directo y devuelve status, cuerpo y duración', async () => {
    respuestaDestino = { status: 200, statusText: 'OK', cuerpo: '{"hora":"2026-08-17T12:00:00Z"}' };

    const res = await POST(
      pedido({ metodo: 'GET', path: '/api/pedidos', query: { escenario: 1000 } }),
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toMatchObject({ success: true, status: 200, truncado: false });
    expect(cuerpo.body).toBe('{"hora":"2026-08-17T12:00:00Z"}');
    expect(typeof cuerpo.duracionMs).toBe('number');

    const [[url, init]] = llamadasAlDestino();
    expect(url).toBe('http://localhost:3002/api/pedidos?escenario=1000');
    expect(init.method).toBe('GET');
  });

  it('el status del endpoint llamado viaja adentro, no como status del ejecutor', async () => {
    respuestaDestino = { status: 500, statusText: 'Internal Server Error', cuerpo: '{"error":"boom"}' };

    const res = await POST(pedido({ metodo: 'GET', path: '/api/latest' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 500, statusText: 'Internal Server Error' });
  });

  it('una escritura SIN confirmación es 428 y no ejecuta nada', async () => {
    const res = await POST(
      pedido({ metodo: 'POST', path: '/api/import/pedidos', body: { pedidos: [] } }),
    );

    expect(res.status).toBe(428);
    await expect(res.json()).resolves.toMatchObject({ code: 'CONFIRMACION_REQUERIDA' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('una escritura con la confirmación EQUIVOCADA también es 428', async () => {
    const res = await POST(
      pedido({
        metodo: 'DELETE',
        path: '/api/import/pedidos',
        confirmacion: '/api/import/pedido',
      }),
    );

    expect(res.status).toBe(428);
    await expect(res.json()).resolves.toMatchObject({ code: 'CONFIRMACION_REQUERIDA' });
    expect(llamadasAlDestino()).toHaveLength(0);
  });

  it('una escritura con la confirmación correcta se ejecuta', async () => {
    respuestaDestino = { status: 202, statusText: 'Accepted', cuerpo: '{"queued":1}' };

    const res = await POST(
      pedido({
        metodo: 'POST',
        path: '/api/import/gps',
        confirmacion: '/api/import/gps',
        body: { gps: [{ movil: 330 }] },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, status: 202 });

    const [[url, init]] = llamadasAlDestino();
    expect(url).toBe('http://localhost:3002/api/import/gps');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ gps: [{ movil: 330 }] });
  });

  it('la confirmación no contamina el cuerpo que se reenvía', async () => {
    await POST(
      pedido({
        metodo: 'PUT',
        path: '/api/import/pedidos',
        body: { pedidos: [], confirmacion: '/api/import/pedidos' },
      }),
    );

    const [[, init]] = llamadasAlDestino();
    expect(JSON.parse(String(init.body))).toEqual({ pedidos: [] });
  });

  it('los headers de credencial los pone el servidor, no el cliente', async () => {
    await POST(
      pedido(
        {
          metodo: 'GET',
          path: '/api/latest',
          headers: { authorization: 'Bearer robado', cookie: 'a=b', 'x-api-key': 'la-del-usuario' },
        },
        { cookie: 'sb-token=sesion-del-root' },
      ),
    );

    const [[, init]] = llamadasAlDestino();
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toMatch(/^Bearer eyJ/); // el del root, no 'robado'
    expect(headers.get('cookie')).toBe('sb-token=sesion-del-root');
    expect(headers.get('x-api-key')).toBe('la-del-usuario'); // este sí es del usuario

    const cuerpo = await (await POST(pedido({ metodo: 'GET', path: '/api/latest', headers: { cookie: 'x=1' } }))).json();
    expect(cuerpo.headersDescartados).toContain('cookie');
  });

  it('un payload que no es base64 válido se rechaza', async () => {
    const req = new NextRequest(`${ORIGEN}/api/docs/try`, {
      method: 'POST',
      headers: {
        host: 'localhost:3002',
        'content-type': 'application/json',
        authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ payload: 'no-es-base64-!!!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'PAYLOAD_INVALIDO' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validación pura
// ─────────────────────────────────────────────────────────────────────────────

describe('validarPath', () => {
  it('acepta un path de /api con query pegada y la devuelve separada', () => {
    const r = validarPath('/api/pedidos?escenario=1000&tipo=URGENTE');

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe('/api/pedidos');
      expect(r.query).toEqual({ escenario: '1000', tipo: 'URGENTE' });
    }
  });

  it('rechaza esquemas, espacios y backslash', () => {
    for (const malo of ['https://x.test/api/a', 'file:///etc/passwd', '/api/a b', '/api\\..\\x']) {
      expect(validarPath(malo).ok, malo).toBe(false);
    }
  });
});

describe('sanearHeaders', () => {
  it('descarta credenciales y hop-by-hop, y deja pasar el resto', () => {
    const { headers, descartados } = sanearHeaders({
      'x-api-key': 'k',
      Cookie: 'a=b',
      Authorization: 'Bearer x',
      Host: 'otro',
      'x-forwarded-for': '1.2.3.4',
      'content-type': 'application/json; charset=utf-8',
    });

    expect(headers).toEqual({ 'x-api-key': 'k', 'content-type': 'application/json; charset=utf-8' });
    expect(descartados.sort()).toEqual(['Authorization', 'Cookie', 'Host', 'x-forwarded-for'].sort());
  });

  it('descarta valores con CR/LF (inyección de headers)', () => {
    const { headers, descartados } = sanearHeaders({ 'x-a': 'ok', 'x-b': 'v\r\nX-Inyectado: si' });

    expect(headers).toEqual({ 'x-a': 'ok' });
    expect(descartados).toEqual(['x-b']);
  });
});

describe('decodificarPayload', () => {
  it('acepta base64 y base64url', () => {
    const json = JSON.stringify({ metodo: 'GET', path: '/api/latest' });
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    const b64url = Buffer.from(json, 'utf-8').toString('base64url');

    expect(decodificarPayload(b64)).toEqual({ ok: true, valor: { metodo: 'GET', path: '/api/latest' } });
    expect(decodificarPayload(b64url).ok).toBe(true);
  });

  it('rechaza lo que no es JSON adentro del base64', () => {
    const r = decodificarPayload(Buffer.from('no soy json', 'utf-8').toString('base64'));

    expect(r).toMatchObject({ ok: false, code: 'PAYLOAD_INVALIDO' });
  });
});

describe('construirUrl', () => {
  it('el destino nunca sale del origen propio', () => {
    const validada = validarPeticion({ metodo: 'GET', path: '/api/latest', query: { a: '1' } });
    expect(validada.ok).toBe(true);
    if (!validada.ok) return;

    expect(construirUrl(ORIGEN, validada.peticion)).toEqual({
      ok: true,
      url: 'http://localhost:3002/api/latest?a=1',
    });
  });
});
