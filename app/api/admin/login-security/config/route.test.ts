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

vi.mock('@/lib/ip-whitelist', () => ({
  isValidIpPattern: vi.fn((pattern: string) => {
    // Implementacion real simplificada para tests
    if (!pattern || typeof pattern !== 'string') return false;
    const parts = pattern.split('.');
    if (parts.length !== 4) return false;
    for (const part of parts) {
      if (part === '*') continue;
      if (!/^\d+$/.test(part)) return false;
      const n = Number(part);
      if (n < 0 || n > 255) return false;
      if (String(n) !== part) return false;
    }
    return true;
  }),
}));

import { getLoginSecurityConfig, setLoginSecurityConfig } from '@/lib/login-security-config';

const mockGetConfig = vi.mocked(getLoginSecurityConfig);
const mockSetConfig = vi.mocked(setLoginSecurityConfig);

const DEFAULT_CONFIG = {
  maxIntentosUsuario: 3,
  maxIntentosIp: 5,
  tiempoBloqueoUsuarioMinutos: 15,
  tiempoBloqueoIpMinutos: 15,
  ipWhitelistPatterns: [],
  mensajeBloqueo: 'Tu acceso esta bloqueado temporalmente.',
  mensajeBloqueoIp: 'Bloqueado por IP.',
};

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

function makeValidPutBody(overrides: Record<string, unknown> = {}) {
  return {
    maxIntentosUsuario: 7,
    maxIntentosIp: 12,
    tiempoBloqueoUsuarioMinutos: 20,
    tiempoBloqueoIpMinutos: 30,
    ipWhitelistPatterns: [],
    mensajeBloqueo: 'Bloqueado.',
    mensajeBloqueoIp: 'Bloqueado por IP.',
    ...overrides,
  };
}

// ==============================================================================
// GET TESTS
// ==============================================================================

describe('GET /api/admin/login-security/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(DEFAULT_CONFIG);
  });

  it('retorna config cuando isRoot=S', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.maxIntentosUsuario).toBe(3);
    expect(json.maxIntentosIp).toBe(5);
    expect(json.tiempoBloqueoUsuarioMinutos).toBe(15);
    expect(json.tiempoBloqueoIpMinutos).toBe(15);
    expect(json.ipWhitelistPatterns).toEqual([]);
    expect(typeof json.mensajeBloqueo).toBe('string');
  });

  it('retorna los tiempos de bloqueo como campos separados', async () => {
    mockGetConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      tiempoBloqueoUsuarioMinutos: 10,
      tiempoBloqueoIpMinutos: 30,
    });
    const req = makeRequest('GET');
    const res = await GET(req);
    const json = await res.json();

    expect(json.tiempoBloqueoUsuarioMinutos).toBe(10);
    expect(json.tiempoBloqueoIpMinutos).toBe(30);
    // El campo viejo NO debe aparecer en la respuesta
    expect(json.tiempoBloqueoMinutos).toBeUndefined();
  });

  it('retorna ipWhitelistPatterns cuando hay patrones configurados', async () => {
    mockGetConfig.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      ipWhitelistPatterns: ['192.168.*.*', '10.0.0.*'],
    });
    const req = makeRequest('GET');
    const res = await GET(req);
    const json = await res.json();

    expect(json.ipWhitelistPatterns).toEqual(['192.168.*.*', '10.0.0.*']);
  });

  it('retorna 403 cuando no es root y no tiene la funcionalidad', async () => {
    const req = makeRequest('GET', undefined, 'N');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NO_FUNCIONALIDAD');
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

  it('guarda config valida con tiempos independientes y retorna 200', async () => {
    const req = makeRequest('PUT', makeValidPutBody({
      tiempoBloqueoUsuarioMinutos: 10,
      tiempoBloqueoIpMinutos: 45,
    }));
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.tiempoBloqueoUsuarioMinutos).toBe(10);
    expect(json.tiempoBloqueoIpMinutos).toBe(45);
    expect(mockSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        tiempoBloqueoUsuarioMinutos: 10,
        tiempoBloqueoIpMinutos: 45,
      }),
      'testadmin'
    );
  });

  it('guarda config valida con patrones de whitelist y retorna 200', async () => {
    const req = makeRequest('PUT', makeValidPutBody({
      ipWhitelistPatterns: ['192.168.*.*', '10.0.0.*'],
    }));
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.ipWhitelistPatterns).toEqual(['192.168.*.*', '10.0.0.*']);
    expect(mockSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ipWhitelistPatterns: ['192.168.*.*', '10.0.0.*'] }),
      'testadmin'
    );
  });

  it('guarda config valida con array de whitelist vacio', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ ipWhitelistPatterns: [] }));
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ipWhitelistPatterns).toEqual([]);
  });

  it('retorna 403 cuando isRoot != S', async () => {
    const req = makeRequest('PUT', makeValidPutBody(), 'N');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it('retorna 400 para maxIntentosUsuario < 1', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ maxIntentosUsuario: 0 }));
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });

  it('retorna 400 para maxIntentosUsuario > 100', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ maxIntentosUsuario: 101 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para maxIntentosIp no entero', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ maxIntentosIp: 3.5 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para tiempoBloqueoUsuarioMinutos < 1', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ tiempoBloqueoUsuarioMinutos: 0 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para tiempoBloqueoUsuarioMinutos > 1440', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ tiempoBloqueoUsuarioMinutos: 1441 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para tiempoBloqueoIpMinutos < 1', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ tiempoBloqueoIpMinutos: 0 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para tiempoBloqueoIpMinutos > 1440', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ tiempoBloqueoIpMinutos: 1441 }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para ipWhitelistPatterns no es array', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ ipWhitelistPatterns: 'not-an-array' }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para patron de IP invalido', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ ipWhitelistPatterns: ['192.168.1'] }));
    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.invalidPatterns).toContain('192.168.1');
  });

  it('retorna 400 si un elemento del array no es string', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ ipWhitelistPatterns: [123] }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para mensajeBloqueo vacio', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ mensajeBloqueo: '   ' }));
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('retorna 400 para mensajeBloqueoIp vacio', async () => {
    const req = makeRequest('PUT', makeValidPutBody({ mensajeBloqueoIp: '   ' }));
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
    const req = makeRequest('PUT', makeValidPutBody());
    const res = await PUT(req);

    expect(res.status).toBe(500);
  });
});
