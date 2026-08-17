/**
 * Tests de lib/docs/root-guard.ts — el gate del portal /docs.
 *
 * Cubre la verificación §9 de la spec 2026-08-17-portal-docs-apis-design.md:
 *   1. Un usuario con acceso (rol Root o es_root='S') pasa.
 *   2. Un usuario sin el permiso recibe 403.
 *   3. Con SecuritySuite caído el guard DENIEGA (fail-closed), no abre.
 *
 * Más el blindaje del token, que es lo que sostiene todo lo anterior: firma verificada
 * de verdad (un JWT armado a mano no entra), vencimiento respetado, y 503 si el proceso
 * no tiene un JWT_SECRET real con el cual verificar.
 *
 * Y el orden de evaluación de la respuesta de secapi: primero el status HTTP, después el
 * cuerpo. Un 500 con 'GRANTED' adentro no es una autorización.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { requireRoot, resetDocsGuardCache } from '@/lib/docs/root-guard';

/** El secreto "real" del proceso durante los tests (no es el default del código de secapi). */
const SECRETO = 'secreto-de-prueba-que-no-es-el-default-0123456789';

/** El default que trae el código de secapi: como secreto no vale nada, el guard lo rechaza. */
const SECRETO_DEFAULT = 'security-suite-secret-key';

/** Token como el que emite secapi: mismo payload, mismo algoritmo (HS256), firmado. */
function tokenFirmado(
  payload: Record<string, unknown> = { username: 'dmedaglia', userId: 42 },
  opciones: SignOptions = { expiresIn: '7d' },
  secreto: string = SECRETO,
): string {
  return jwt.sign({ iss: 'security-suite', sistema: 'RiogasTracking', ...payload }, secreto, opciones);
}

/** Lo que cualquiera puede escribir a mano: header y payload en base64, firma inventada. */
function tokenFabricadoAMano(payload: Record<string, unknown> = { username: 'dmedaglia', userId: 42 }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf-8').toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${header}.${cuerpo}.firma-inventada`;
}

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

/** Respuesta de secapi. `estado` es el status HTTP; `ok` sale de él, como en un fetch real. */
function respuesta(cuerpo: unknown, estado = 200): Response {
  return {
    status: estado,
    ok: estado >= 200 && estado < 300,
    json: async () => cuerpo,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
const JWT_SECRET_ORIGINAL = process.env.JWT_SECRET;

beforeEach(() => {
  resetDocsGuardCache();
  process.env.JWT_SECRET = SECRETO;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (JWT_SECRET_ORIGINAL === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = JWT_SECRET_ORIGINAL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('requireRoot — acceso concedido', () => {
  it('el bypass por es_root=S (razon ROOT) pasa', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT', objetoKey: 'docs' }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usuario.username).toBe('dmedaglia');
      expect(r.usuario.userId).toBe(42);
      expect(r.usuario.razon).toBe('ROOT');
    }
  });

  it('el otorgamiento por rol Root también pasa', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROL', funcionalidadId: 63 }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r.ok).toBe(true);
  });

  it('pregunta por el objeto docs/view de la app 5', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/db\/permisos$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ AplicacionId: 5, ObjetoKey: 'docs', AccionKey: 'view' });
  });

  it('acepta el token por cookie además del header Authorization', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    const r = await requireRoot(req({ cookie: `otra=x; token=${tokenFirmado()}; mas=y` }));

    expect(r.ok).toBe(true);
  });
});

describe('requireRoot — el token tiene que estar firmado por secapi', () => {
  it('un JWT fabricado a mano (firma inválida) es 401 y NI SIQUIERA se le pregunta a secapi', async () => {
    const r = await requireRoot(req({ authorization: `Bearer ${tokenFabricadoAMano()}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'TOKEN_INVALIDO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token firmado con OTRO secreto es 401', async () => {
    const ajeno = tokenFirmado({ username: 'dmedaglia', userId: 42 }, { expiresIn: '7d' }, 'otro-secreto-cualquiera');

    const r = await requireRoot(req({ authorization: `Bearer ${ajeno}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'TOKEN_INVALIDO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token vencido es 401 TOKEN_VENCIDO (aunque la firma sea buena)', async () => {
    const vencido = tokenFirmado({ username: 'dmedaglia', userId: 42 }, { expiresIn: '-1h' });

    const r = await requireRoot(req({ authorization: `Bearer ${vencido}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'TOKEN_VENCIDO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token con alg none no entra', async () => {
    const sinAlg = jwt.sign({ username: 'dmedaglia', userId: 42 }, '', { algorithm: 'none' });

    const r = await requireRoot(req({ authorization: `Bearer ${sinAlg}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'TOKEN_INVALIDO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la identidad sale del payload VERIFICADO, no del que venga escrito', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROL' }));

    const r = await requireRoot(
      req({ authorization: `Bearer ${tokenFirmado({ username: 'operador', userId: 7 })}` }),
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usuario.username).toBe('operador');
      expect(r.usuario.userId).toBe(7);
    }
  });
});

describe('requireRoot — sin secreto real no se abre', () => {
  it('sin JWT_SECRET devuelve 503 SECRETO_NO_CONFIGURADO y no consulta a secapi', async () => {
    delete process.env.JWT_SECRET;

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECRETO_NO_CONFIGURADO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con JWT_SECRET vacía devuelve 503 SECRETO_NO_CONFIGURADO', async () => {
    process.env.JWT_SECRET = '   ';

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECRETO_NO_CONFIGURADO' });
  });

  it('con el default del código de secapi devuelve 503, aunque el token esté firmado con él', async () => {
    process.env.JWT_SECRET = SECRETO_DEFAULT;
    const conElDefault = tokenFirmado({ username: 'dmedaglia', userId: 42 }, { expiresIn: '7d' }, SECRETO_DEFAULT);

    const r = await requireRoot(req({ authorization: `Bearer ${conElDefault}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECRETO_NO_CONFIGURADO' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('requireRoot — acceso denegado', () => {
  it('un usuario sin el permiso recibe 403', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'DENIED', razon: 'ACCESS_DENIED', objetoKey: 'docs' }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado({ username: 'operador' })}` }));

    expect(r).toEqual({ ok: false, status: 403, code: 'ACCESS_DENIED' });
  });

  it('sin token no se consulta a secapi: 401 directo', async () => {
    const r = await requireRoot(req({}));

    expect(r).toEqual({ ok: false, status: 401, code: 'NO_TOKEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token que secapi rechaza (401) queda en 401', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'DENIED', razon: 'INVALID_TOKEN' }, 401));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'INVALID_TOKEN' });
  });
});

describe('requireRoot — fail-closed', () => {
  it('con secapi caído (la conexión falla) DENIEGA', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_INACCESIBLE' });
  });

  it('con secapi devolviendo 500 DENIEGA', async () => {
    fetchMock.mockResolvedValue(respuesta({ error: 'boom' }, 500));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_ERROR' });
  });

  it('un 500 con GRANTED en el cuerpo NO abre: el status manda sobre el cuerpo', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }, 500));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_ERROR' });
  });

  it('un 403 con GRANTED en el cuerpo tampoco abre', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }, 403));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('con una respuesta ilegible DENIEGA', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('no es JSON');
      },
    } as unknown as Response);

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFirmado()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_RESPUESTA_INVALIDA' });
  });
});

describe('requireRoot — cache', () => {
  it('no vuelve a preguntar por el mismo token dentro de la ventana', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));
    const pedido = req({ authorization: `Bearer ${tokenFirmado()}` });

    await requireRoot(pedido);
    await requireRoot(pedido);
    await requireRoot(pedido);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tokens distintos se resuelven por separado', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    await requireRoot(req({ authorization: `Bearer ${tokenFirmado({ username: 'uno' })}` }));
    await requireRoot(req({ authorization: `Bearer ${tokenFirmado({ username: 'dos' })}` }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('el cache NO le gana al vencimiento: si el token vence, deja de entrar', async () => {
    // 2 s de vida: se cachea el sí (TTL 5 min) y después se corre el reloj más allá del exp.
    const corto = tokenFirmado({ username: 'dmedaglia', userId: 42 }, { expiresIn: '2s' });
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    const primero = await requireRoot(req({ authorization: `Bearer ${corto}` }));
    expect(primero.ok).toBe(true);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 60_000));
      const segundo = await requireRoot(req({ authorization: `Bearer ${corto}` }));
      expect(segundo).toEqual({ ok: false, status: 401, code: 'TOKEN_VENCIDO' });
    } finally {
      vi.useRealTimers();
    }
  });
});
