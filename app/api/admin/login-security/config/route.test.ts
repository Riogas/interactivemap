/**
 * Tests para GET/PUT /api/admin/login-security/config
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, PUT } from './route';
import { NextRequest } from 'next/server';

// ==============================================================================
// MOCK
// ==============================================================================

vi.mock('@/lib/login-security-config', () => ({
  getLoginSecurityConfig: vi.fn(),
  setLoginSecurityConfig: vi.fn(),
}));

import { getLoginSecurityConfig, setLoginSecurityConfig } from '@/lib/login-security-config';

const mockGetConfig = vi.mocked(getLoginSecurityConfig);
const mockSetConfig = vi.mocked(setLoginSecurityConfig);

// ==============================================================================
// HELPERS
// ==============================================================================

function makeRequest(method: string, body?: unknown, isRoot: 'S' | 'N' = 'S', user = 'testadmin'): NextRequest {
  const url = 'http://localhost/api/admin/login-security/config';
  const headers: Record<string, string> = {
    'x-track-isroot': isRoot,
    'x-track-user': user,
    'Content-Type': 'application/json',
  };
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ==============================================================================
// GET TESTS
// ==============================================================================

describe('GET /api/admin/login-security/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ maxIntentosUsuario: 3, maxIntentosIp: 5 });
  });

  it('retorna config cuando isRoot=S', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.maxIntentosUsuario).toBe(3);
    expect(json.maxIntentosIp).toBe(5);
  });

  it('retorna 403 cuando isRoot != S', async () => {
    const req = makeRequest('GET', undefined, 'N');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_ROOT');
  });

  it('retorna 403 cuando no hay header isRoot', async () => {
    const req = new NextRequest('http://localhost/api/admin/login-security/config', {
      method: 'GET',
    });
    const res = await GET(req);

    expect(res.status).toBe(403);
  });
});

// ==============================================================================
// PUT TESTS
// ==============================================================================

describe('PUT /api/admin/login-security/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetConfig.mockResolvedValue(undefined);
  });

  it('guarda config valida y retorna 200', async () => {
    const req = makeRequest('PUT', { maxIntentosUsuario: 7, maxIntentosIp: 12 });
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.maxIntentosUsuario).toBe(7);
    expect(json.maxIntentosIp).toBe(12);
    expect(mockSetConfig).toHaveBeenCalledWith(
      { maxIntentosUsuario: 7, maxIntentosIp: 12 },
      'testadmin'
    );
  });

  it('retorna 403 cuando isRoot != S', async () => {
    const req = makeRequest('PUT', { maxIntentosUsuario: 5, maxIntentosIp: 8 }, 'N');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it('retorna 400 para maxIntentosUsuario < 1', async () => {
    const req = makeRequest('PUT', { maxIntentosUsuario: 0, maxIntentosIp: 5 });
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it('retorna 400 para maxIntentosUsuario > 100', async () => {
    const req = makeRequest('PUT', { maxIntentosUsuario: 101, maxIntentosIp: 5 });
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para maxIntentosIp no entero', async () => {
    const req = makeRequest('PUT', { maxIntentosUsuario: 5, maxIntentosIp: 3.5 });
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para body invalido (no JSON)', async () => {
    const req = new NextRequest('http://localhost/api/admin/login-security/config', {
      method: 'PUT',
      headers: { 'x-track-isroot': 'S', 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 500 si setLoginSecurityConfig lanza error', async () => {
    mockSetConfig.mockRejectedValueOnce(new Error('DB error'));
    const req = makeRequest('PUT', { maxIntentosUsuario: 5, maxIntentosIp: 10 });
    const res = await PUT(req);

    expect(res.status).toBe(500);
  });
});
