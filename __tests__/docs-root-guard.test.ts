/**
 * Tests de lib/docs/root-guard.ts — el gate del portal /docs.
 *
 * Cubre la verificación §9 de la spec 2026-08-17-portal-docs-apis-design.md:
 *   1. Un usuario con acceso (rol Root o es_root='S') pasa.
 *   2. Un usuario sin el permiso recibe 403.
 *   3. Con SecuritySuite caído el guard DENIEGA (fail-closed), no abre.
 *
 * Más: sin token es 401, el token puede venir por cookie, y el cache no vuelve a
 * preguntarle a secapi dentro de la ventana.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { requireRoot, resetDocsGuardCache } from '@/lib/docs/root-guard';

/** JWT de mentira: solo el payload importa (el guard no verifica la firma, secapi sí valida al usuario). */
function tokenFalso(payload: Record<string, unknown> = { username: 'dmedaglia', userId: 42 }): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.firma-que-nadie-verifica-aca`;
}

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

/** Respuesta de secapi. `estado` es el status HTTP. */
function respuesta(cuerpo: unknown, estado = 200): Response {
  return {
    status: estado,
    json: async () => cuerpo,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetDocsGuardCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('requireRoot — acceso concedido', () => {
  it('el bypass por es_root=S (razon ROOT) pasa', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT', objetoKey: 'docs' }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usuario.username).toBe('dmedaglia');
      expect(r.usuario.userId).toBe(42);
      expect(r.usuario.razon).toBe('ROOT');
    }
  });

  it('el otorgamiento por rol Root también pasa', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROL', funcionalidadId: 63 }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r.ok).toBe(true);
  });

  it('pregunta por el objeto docs/view de la app 5', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/db\/permisos$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ AplicacionId: 5, ObjetoKey: 'docs', AccionKey: 'view' });
  });

  it('acepta el token por cookie además del header Authorization', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    const r = await requireRoot(req({ cookie: `otra=x; token=${tokenFalso()}; mas=y` }));

    expect(r.ok).toBe(true);
  });
});

describe('requireRoot — acceso denegado', () => {
  it('un usuario sin el permiso recibe 403', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'DENIED', razon: 'ACCESS_DENIED', objetoKey: 'docs' }));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso({ username: 'operador' })}` }));

    expect(r).toEqual({ ok: false, status: 403, code: 'ACCESS_DENIED' });
  });

  it('sin token no se consulta a secapi: 401 directo', async () => {
    const r = await requireRoot(req({}));

    expect(r).toEqual({ ok: false, status: 401, code: 'NO_TOKEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un token que secapi rechaza (401) queda en 401', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'DENIED', razon: 'INVALID_TOKEN' }, 401));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r).toEqual({ ok: false, status: 401, code: 'INVALID_TOKEN' });
  });
});

describe('requireRoot — fail-closed', () => {
  it('con secapi caído (la conexión falla) DENIEGA', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_INACCESIBLE' });
  });

  it('con secapi devolviendo 500 DENIEGA', async () => {
    fetchMock.mockResolvedValue(respuesta({ error: 'boom' }, 500));

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_ERROR' });
  });

  it('con una respuesta ilegible DENIEGA', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => {
        throw new Error('no es JSON');
      },
    } as unknown as Response);

    const r = await requireRoot(req({ authorization: `Bearer ${tokenFalso()}` }));

    expect(r).toEqual({ ok: false, status: 503, code: 'SECAPI_RESPUESTA_INVALIDA' });
  });
});

describe('requireRoot — cache', () => {
  it('no vuelve a preguntar por el mismo token dentro de la ventana', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));
    const pedido = req({ authorization: `Bearer ${tokenFalso()}` });

    await requireRoot(pedido);
    await requireRoot(pedido);
    await requireRoot(pedido);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tokens distintos se resuelven por separado', async () => {
    fetchMock.mockResolvedValue(respuesta({ permitido: 'GRANTED', razon: 'ROOT' }));

    await requireRoot(req({ authorization: `Bearer ${tokenFalso({ username: 'uno' })}` }));
    await requireRoot(req({ authorization: `Bearer ${tokenFalso({ username: 'dos' })}` }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
