/**
 * Tests para los endpoints de /api/admin/usuarios-empresa
 *
 * Cubre:
 * 1. GET /api/admin/usuarios-empresa — gating + proxy upstream
 * 2. POST /api/admin/usuarios-empresa/toggle — gating + mock response
 *
 * Estrategia: se mockea global.fetch para simular el upstream del SecuritySuite.
 * Los route handlers de Next.js se importan directamente y se les pasa un
 * NextRequest construido manualmente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/admin/usuarios-empresa/route';
import { POST } from '../app/api/admin/usuarios-empresa/toggle/route';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): NextRequest {
  // Usamos el constructor de Request base para evitar conflictos de tipos entre
  // el RequestInit global y el de Next.js. NextRequest acepta Request nativo.
  const reqHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
  const req = new Request(url, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return new NextRequest(req);
}

function rootHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'S',
    'x-track-user': 'root',
    Authorization: 'Bearer test-token',
  };
}

function distribuidorHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'N',
    'x-track-user': 'dist01',
    'x-track-roles': JSON.stringify(['Distribuidor']),
    Authorization: 'Bearer dist-token',
  };
}

function noRoleHeaders(): Record<string, string> {
  return {
    'x-track-isroot': 'N',
    'x-track-user': 'regular',
    'x-track-roles': JSON.stringify(['Dashboard']),
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

  it('rechaza sin rol adecuado (403)', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_1',
      noRoleHeaders(),
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('REQUIRES_DISTRIBUIDOR_OR_ROOT');
  });

  it('rechaza sin parámetro empresas (400)', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa',
      rootHeaders(),
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

  it('permite acceso con rol Distribuidor', async () => {
    const mockData = [{ username: 'dist_user', empresa: 'FLETERA_SUR', habilitado: false }];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), { status: 200 }),
    );

    const req = makeRequest(
      'GET',
      'http://localhost/api/admin/usuarios-empresa?empresas=FLETERA_SUR',
      distribuidorHeaders(),
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
  it('rechaza sin rol adecuado (403)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      noRoleHeaders(),
      { username: 'user1', enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('rechaza body sin username (400)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rechaza body sin enabled (400)', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { username: 'user1' },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('devuelve { success: true, mock: true } para root con body válido', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      rootHeaders(),
      { username: 'user1', enabled: true },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mock).toBe(true);
  });

  it('devuelve { success: true, mock: true } para Distribuidor con body válido', async () => {
    const req = makeRequest(
      'POST',
      'http://localhost/api/admin/usuarios-empresa/toggle',
      distribuidorHeaders(),
      { username: 'user1', enabled: false },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mock).toBe(true);
  });
});
