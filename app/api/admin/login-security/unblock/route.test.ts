/**
 * Tests para POST /api/admin/login-security/unblock
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// ==============================================================================
// MOCK DE SUPABASE
// ==============================================================================

function createMockSupabaseClient() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    from: vi.fn(() => mockQuery),
    __mockQuery: mockQuery,
  };
}

let mockSupabaseClient: ReturnType<typeof createMockSupabaseClient>;

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: () => mockSupabaseClient,
}));

// ==============================================================================
// HELPERS
// ==============================================================================

function makeRequest(body?: unknown, isRoot: 'S' | 'N' = 'S', user = 'testadmin'): NextRequest {
  const url = 'http://localhost/api/admin/login-security/unblock';
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'x-track-isroot': isRoot,
      'x-track-user': user,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const MOCK_USER_BLOCK = {
  id: 42,
  block_type: 'user',
  key: 'juan',
  blocked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  reason: 'too_many_failed_attempts',
};

const MOCK_IP_BLOCK = {
  id: 99,
  block_type: 'ip',
  key: '1.2.3.4',
  blocked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  reason: 'too_many_failed_attempts',
};

// ==============================================================================
// TESTS
// ==============================================================================

describe('POST /api/admin/login-security/unblock', () => {
  beforeEach(() => {
    mockSupabaseClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  describe('Gate de root', () => {
    it('retorna 403 cuando isRoot != S', async () => {
      const req = makeRequest({ type: 'user', value: 'juan' }, 'N');
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.code).toBe('NOT_ROOT');
    });

    it('retorna 403 cuando no hay header isRoot', async () => {
      const req = new NextRequest('http://localhost/api/admin/login-security/unblock', {
        method: 'POST',
        body: JSON.stringify({ type: 'user', value: 'juan' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(403);
    });
  });

  describe('Validación de body', () => {
    it('retorna 400 para type inválido', async () => {
      const req = makeRequest({ type: 'invalid', value: 'juan' });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('retorna 400 para value vacío', async () => {
      const req = makeRequest({ type: 'user', value: '' });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('retorna 400 para value no string', async () => {
      const req = makeRequest({ type: 'user', value: 123 });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('retorna 400 para body sin type', async () => {
      const req = makeRequest({ value: 'juan' });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe('Unblock exitoso de usuario', () => {
    it('desbloquea usuario existente y retorna audit trail', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: MOCK_USER_BLOCK,
        error: null,
      });
      mockSupabaseClient.__mockQuery.update.mockReturnValue({
        eq: vi.fn().mockResolvedValueOnce({ error: null }),
      });

      const req = makeRequest({ type: 'user', value: 'juan' }, 'S', 'admin_root');
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.unblocked.block_type).toBe('user');
      expect(json.unblocked.key).toBe('juan');
      expect(json.unblocked.unblocked_by).toBe('admin_root');
      expect(json.unblocked.unblocked_at).toBeTruthy();
    });

    it('desbloquea IP existente', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: MOCK_IP_BLOCK,
        error: null,
      });
      mockSupabaseClient.__mockQuery.update.mockReturnValue({
        eq: vi.fn().mockResolvedValueOnce({ error: null }),
      });

      const req = makeRequest({ type: 'ip', value: '1.2.3.4' });
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.unblocked.block_type).toBe('ip');
      expect(json.unblocked.key).toBe('1.2.3.4');
    });
  });

  describe('Casos de error y borde', () => {
    it('retorna 404 cuando no hay bloqueo activo', async () => {
      // data=null → bloqueo no encontrado
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const req = makeRequest({ type: 'user', value: 'noexiste' });
      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.code).toBe('NOT_FOUND');
    });

    it('retorna 500 cuando Supabase falla en busqueda', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error' },
      });

      const req = makeRequest({ type: 'user', value: 'juan' });
      const res = await POST(req);

      expect(res.status).toBe(500);
    });

    it('retorna 500 cuando Supabase falla en update', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: MOCK_USER_BLOCK,
        error: null,
      });
      mockSupabaseClient.__mockQuery.update.mockReturnValue({
        eq: vi.fn().mockResolvedValueOnce({ error: { message: 'update error' } }),
      });

      const req = makeRequest({ type: 'user', value: 'juan' });
      const res = await POST(req);

      expect(res.status).toBe(500);
    });

    it('trim whitespace del value', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
        data: { ...MOCK_USER_BLOCK, key: 'juan' },
        error: null,
      });
      mockSupabaseClient.__mockQuery.update.mockReturnValue({
        eq: vi.fn().mockResolvedValueOnce({ error: null }),
      });

      // Value con espacios extra
      const req = makeRequest({ type: 'user', value: '  juan  ' });
      const res = await POST(req);
      const json = await res.json();

      // Verifica que se trimmeó
      expect(res.status).toBe(200);
      expect(json.unblocked.key).toBe('juan');
    });
  });
});
