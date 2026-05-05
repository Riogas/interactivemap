/**
 * Tests para app/api/audit/config/route.ts
 *
 * AC1 — GET /api/audit/config: devuelve 200 con shape { enabled, updated_at, updated_by }
 * AC2 — POST sin Authorization: 401
 * AC3 — POST con JWT válido pero header x-track-isroot !== 'S': 403
 * AC4 — POST con JWT + header x-track-isroot=S: 200 y actualiza la fila
 *
 * Nota: el JWT del Security Suite no incluye isRoot (solo username/userId).
 * El flag de role se transmite vía header x-track-isroot, mismo patrón que
 * x-track-user en /api/audit. Confianza client-side, alineado con el resto
 * de la app.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock getServerSupabaseClient
vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { GET, POST } from '@/app/api/audit/config/route';
import { getServerSupabaseClient } from '@/lib/supabase';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake_signature`;
}

function makeRequest(method: string, body?: unknown, authHeader?: string, isRootHeader?: string): NextRequest {
  const url = 'http://localhost/api/audit/config';
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (isRootHeader !== undefined) {
    headers['x-track-isroot'] = isRootHeader;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, { method, body: body !== undefined ? JSON.stringify(body) : undefined, headers } as any);
}

// ─── Mock factory ────────────────────────────────────────────────────────────

interface AuditSettingsRow { id: number; enabled: boolean; updated_at: string; updated_by: string | null }

function mockSupabase(_scenario: 'success' | 'error' | 'empty') {
  const row: AuditSettingsRow = {
    id: 1,
    enabled: false,
    updated_at: '2026-05-05T20:00:00.000Z',
    updated_by: 'system',
  };

  const updateRow: AuditSettingsRow = {
    id: 1,
    enabled: true,
    updated_at: '2026-05-05T21:00:00.000Z',
    updated_by: 'dmedaglia',
  };

  const getResult = _scenario === 'error'
    ? { data: null, error: { message: 'DB error' } }
    : { data: row, error: null };

  // Build a chainable mock for .from().select().eq().single()
  // and .from().update().eq().select().single()
  const single = vi.fn().mockResolvedValue(getResult);
  const updateSingle = vi.fn().mockResolvedValue({ data: updateRow, error: null });

  const mockClient = {
    from: (_table: string) => ({
      select: (_cols: string, _opts?: unknown) => ({
        eq: (_col: string, _val: unknown) => ({
          single,
        }),
      }),
      update: (_vals: unknown) => ({
        eq: (_col: string, _val: unknown) => ({
          select: (_cols: string) => ({
            single: updateSingle,
          }),
        }),
      }),
    }),
  };

  (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
  return { single, updateSingle };
}

// ─── Tests: GET ──────────────────────────────────────────────────────────────

describe('GET /api/audit/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1 — devuelve 200 con shape correcto cuando la fila existe', async () => {
    mockSupabase('success');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({
      enabled: expect.any(Boolean),
      updated_at: expect.any(String),
    });
    expect('updated_by' in json).toBe(true);
  });

  it('devuelve enabled=false como fallback si la tabla devuelve error', async () => {
    mockSupabase('error');
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json() as { enabled: boolean };
    expect(json.enabled).toBe(false);
  });
});

// ─── Tests: POST ─────────────────────────────────────────────────────────────

describe('POST /api/audit/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC2 — sin Authorization → 401', async () => {
    const req = makeRequest('POST', { enabled: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('AC2b — con token vacío → 401', async () => {
    const req = makeRequest('POST', { enabled: true }, 'Bearer ');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('AC3 — con JWT válido pero header x-track-isroot !== S → 403', async () => {
    const jwt = makeJwt({ username: 'user1', userId: '42' });
    const req = makeRequest('POST', { enabled: true }, `Bearer ${jwt}`, 'N');
    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(false);
  });

  it('AC3b — con JWT válido pero sin header x-track-isroot → 403', async () => {
    const jwt = makeJwt({ username: 'user1', userId: '42' });
    const req = makeRequest('POST', { enabled: true }, `Bearer ${jwt}`);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('AC4 — con JWT + header x-track-isroot=S → 200 y retorna enabled actualizado', async () => {
    mockSupabase('success');
    const jwt = makeJwt({ username: 'dmedaglia', userId: '1' });
    const req = makeRequest('POST', { enabled: true }, `Bearer ${jwt}`, 'S');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; enabled: boolean; updated_at: string };
    expect(json.success).toBe(true);
    expect(typeof json.enabled).toBe('boolean');
    expect(typeof json.updated_at).toBe('string');
  });

  it('devuelve 400 si body no tiene "enabled"', async () => {
    const jwt = makeJwt({ username: 'dmedaglia', userId: '1' });
    const req = makeRequest('POST', { wrongField: 123 }, `Bearer ${jwt}`, 'S');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('devuelve 400 si "enabled" no es boolean', async () => {
    const jwt = makeJwt({ username: 'dmedaglia', userId: '1' });
    const req = makeRequest('POST', { enabled: 'yes' }, `Bearer ${jwt}`, 'S');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
