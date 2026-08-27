/**
 * Tests para los endpoints de /api/admin/usuarios-empresa
 *
 * Cubre:
 * 1. GET /api/admin/usuarios-empresa — gating (requireFuncionalidad
 *    'Gestion de Usuarios') + proxy al upstream del SecuritySuite.
 * 2. POST /api/admin/usuarios-empresa/toggle — gating + proxy upstream.
 *
 * Gating actual (refactor requireRoot/requireDistribuidorOrRoot →
 * requireFuncionalidad): pasa si x-track-isroot === 'S' (bypass root) o si
 * x-track-funcs incluye 'Gestion de Usuarios'. En caso contrario → 403
 * con code 'NO_FUNCIONALIDAD'.
 *
 * Estrategia: se mockea global.fetch para simular el upstream del SecuritySuite,
 * y @/lib/supabase para evitar el throw de variables de entorno al importar la
 * route (la route solo usa supabase en ramas que estos tests no ejercitan).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { GET } from '../app/api/admin/usuarios-empresa/route';
import { POST } from '../app/api/admin/usuarios-empresa/toggle/route';
import { GET as GET_USUARIO_DETALLE } from '../app/api/admin/login-security/usuario-detalle/route';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): NextRequest {
  const reqHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
  const req = new Request(url, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return new NextRequest(req);
}

/** Root → bypass del gate vía x-track-isroot. */
function rootHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'S',
    'x-track-user': 'root',
    Authorization: 'Bearer test-token',
  };
}

/** Usuario no-root CON la funcionalidad 'Gestion de Usuarios'. */
function funcHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'N',
    'x-track-user': 'gestor01',
    'x-track-funcs': 'Gestion de Usuarios,Otra Funcionalidad',
    Authorization: 'Bearer gestor-token',
  };
}

/** Usuario no-root SIN la funcionalidad 'Gestion de Usuarios'. */
function noFuncHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'N',
    'x-track-user': 'regular',
    'x-track-funcs': 'Dashboard',
    Authorization: 'Bearer regular-token',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/usuarios-empresa
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/usuarios-empresa', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rechaza sin la funcionalidad (403 NO_FUNCIONALIDAD)', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      noFuncHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NO_FUNCIONALIDAD');
  });

  it('rechaza sin parámetro empresas (400 EMPRESAS_REQUIRED)', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa',
      funcHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('EMPRESAS_REQUIRED');
  });

  it('permite acceso con x-track-isroot=S (root)', async () => {
    const mockData = [{ username: 'user1', empresa: 'FLETERA_1', habilitado: true }];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), { status: 200 }),
    );

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      rootHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].username).toBe('user1');
  });

  it("permite acceso con la funcionalidad 'Gestion de Usuarios'", async () => {
    const mockData = [{ username: 'gest_user', empresa: 'FLETERA_SUR', habilitado: false }];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), { status: 200 }),
    );

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_SUR',
      funcHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('propaga error 500 del upstream correctamente', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'DB error' }), { status: 500 }),
    );

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      rootHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.upstream_status).toBe(500);
  });

  it('devuelve 502 cuando el upstream no responde (error de red)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      rootHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/usuarios-empresa/toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/usuarios-empresa/toggle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rechaza sin la funcionalidad (403 NO_FUNCIONALIDAD)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      noFuncHeaders(),
      { userId: 1, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NO_FUNCIONALIDAD');
  });

  it('rechaza body sin userId (400)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rechaza userId inválido (<= 0) (400)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { userId: 0, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('proxya al upstream y devuelve 200 para root con body válido', async () => {
    const mockResp = { success: true, usuarioId: 5, accion: 'grant', habilitado: true };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 }),
    );

    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { userId: 5, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("proxya al upstream para usuario con funcionalidad 'Gestion de Usuarios'", async () => {
    const mockResp = { success: true, usuarioId: 7, accion: 'revoke', habilitado: false };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 }),
    );

    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      funcHeaders(),
      { userId: 7, enabled: false },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('devuelve 502 cuando el upstream no responde (error de red)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { userId: 5, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate de SESIÓN (requireAuthorizationHeader)
//
// El SecuritySuite cierra /api/db/*: todas las operaciones pasan a exigir JWT
// con firma verificada, y al setear el secreto TODOS los tokens vigentes se
// invalidan de golpe. Estas rutas venían forwardeando
// `Authorization ?? ''`, así que sin token mandaban un header vacío y devolvían
// el 401 opaco del upstream ("Error del servicio upstream" / pantalla vacía).
// Ahora cortan antes con un 401 propio que dice que fue por sesión.
// ─────────────────────────────────────────────────────────────────────────────

/** Headers con funcionalidad OK pero SIN token — el caso post-deslogueo. */
function sinTokenHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-track-isroot': 'N',
    'x-track-user': 'gestor01',
    'x-track-funcs': 'Gestion de Usuarios,Query Inicios de sesion',
    ...extra,
  };
}

describe('gate de sesión en los proxies al SecuritySuite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET usuarios-empresa sin Authorization → 401 SIN_SESION y NO llama al upstream', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      sinTokenHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('SIN_SESION');
    expect(body.error).toMatch(/sesión/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GET usuarios-empresa con 'Bearer ' vacío (token null en storage) → 401 SIN_SESION", async () => {
    // getAuthHeaders del cliente arma `'Bearer ' + (token ?? '')`: sin token el
    // header EXISTE pero no trae credencial.
    const fetchSpy = vi.spyOn(global, 'fetch');
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      sinTokenHeaders({ Authorization: 'Bearer ' }),
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SIN_SESION');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POST toggle sin Authorization → 401 SIN_SESION y NO escribe upstream', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      sinTokenHeaders(),
      { userId: 5, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('SIN_SESION');
    // Es una escritura que habilita/deshabilita el acceso de una persona: no
    // debe salir de acá sin sesión.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GET usuario-detalle sin Authorization → 401 SIN_SESION', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/login-security/usuario-detalle?username=jperez',
      sinTokenHeaders(),
    );
    const res = await GET_USUARIO_DETALLE(req);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SIN_SESION');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('401 del upstream se traduce a un mensaje de sesión, sin filtrar el detalle del upstream', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      // Shape REAL de secapi: prosa en el body, código en el header.
      new Response(
        JSON.stringify({ success: false, error: 'Tu sesión no es válida, volvé a iniciar sesión' }),
        { status: 401, headers: { 'x-auth-guard': 'TOKEN_INVALIDO' } },
      ),
    );

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      rootHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('SESION_INVALIDA');
    expect(body.error).toMatch(/sesión/i);
    // El cliente prioriza detail.error sobre error: si lo dejáramos, la pantalla
    // volvería a mostrar el código crudo del SecuritySuite.
    expect(body.detail).toBeUndefined();
  });

  // OJO con el shape del mock: secapi manda el CÓDIGO en el header x-auth-guard
  // y en el body un mensaje en prosa. Mockear `{ error: 'SECRETO_NO_CONFIGURADO' }`
  // era modelar una respuesta que el servidor nunca emite.
  it('503 SECRETO_NO_CONFIGURADO (header) → permanente, y NO se presenta como sesión vencida', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: 'Servicio no configurado' }), {
        status: 503,
        headers: { 'x-auth-guard': 'SECRETO_NO_CONFIGURADO' },
      }),
    );

    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { userId: 5, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('UPSTREAM_NO_CONFIGURADO');
    expect(body.error).not.toMatch(/volvé a iniciar sesión/i);
    // Reintentar no arregla nada: el mensaje no debe invitar a hacerlo.
    expect(body.error).toMatch(/no lo arregla/i);
  });

  it('503 ERROR_GUARD (header) → transitorio, el mensaje invita a reintentar', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: 'Error del guard' }), {
        status: 503,
        headers: { 'x-auth-guard': 'ERROR_GUARD' },
      }),
    );

    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { userId: 5, enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('UPSTREAM_NO_DISPONIBLE');
    expect(body.error).toMatch(/de nuevo/i);
  });
});
