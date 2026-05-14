/**
 * Tests para login-security.ts
 *
 * Tests unitarios con mocks de Supabase para evitar dependencias de BD real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkLoginBlock, recordLoginAttempt, evaluateAndApplyBlocks, runLoginSecurity } from './login-security';
import { NextRequest } from 'next/server';

// ==============================================================================
// MOCKS DE SUPABASE
// ==============================================================================

// Mock del cliente Supabase con todas las operaciones chain
function createMockSupabaseClient() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    from: vi.fn(() => mockQuery),
    __mockQuery: mockQuery, // Helper para acceder al mock en los tests
  };
}

let mockSupabaseClient: ReturnType<typeof createMockSupabaseClient>;

// Mock del módulo de supabase
vi.mock('./supabase', () => ({
  getServerSupabaseClient: () => mockSupabaseClient,
}));

// Mock de login-security-config: retorna defaults en todos los tests
// (las pruebas de config específica van en login-security-config.test.ts)
vi.mock('./login-security-config', () => ({
  getLoginSecurityConfig: vi.fn().mockResolvedValue({
    maxIntentosUsuario: 3,
    maxIntentosIp: 5,
  }),
  DEFAULT_LOGIN_SECURITY_CONFIG: { maxIntentosUsuario: 3, maxIntentosIp: 5 },
}));

import { getServerSupabaseClient } from './supabase';

// ==============================================================================
// HELPER — crear NextRequest con headers personalizados
// ==============================================================================

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const url = 'http://localhost/api/auth/login';
  const body = JSON.stringify({ UserName: 'testuser', Password: 'pass123' });
  return new NextRequest(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

describe('Login Security', () => {
  beforeEach(() => {
    // Recrear mock del cliente para cada test
    mockSupabaseClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  describe('checkLoginBlock', () => {
    it('debería retornar blocked=false si no hay bloqueos activos', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await checkLoginBlock('testuser', '1.2.3.4');
      expect(result.blocked).toBe(false);
    });

    it('debería retornar blocked=true para un bloqueo de usuario activo (is_active=true)', async () => {
      const blockedUntil = new Date(Date.now() + 10 * 60 * 1000); // +10 min

      // Primera consulta (usuario): retorna bloqueo con is_active=true
      mockSupabaseClient.__mockQuery.maybeSingle
        .mockResolvedValueOnce({
          data: {
            id: 1,
            block_type: 'user',
            key: 'blockeduser',
            blocked_until: blockedUntil.toISOString(),
            reason: 'too_many_failed_attempts',
            created_at: new Date().toISOString(),
            is_active: true,
          },
          error: null,
        });

      const result = await checkLoginBlock('blockeduser', '1.2.3.4');
      expect(result.blocked).toBe(true);
      expect(result.type).toBe('user');
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('debería retornar blocked=false para un bloqueo desbloqueado manualmente (is_active=false)', async () => {
      // FIX (Issue 2): un bloqueo con is_active=false NO debe bloquear al usuario
      // aunque blocked_until sea futuro. El endpoint filtra is_active=true server-side.
      // En el mock, simular que no viene ningún row (como haría Supabase con el filtro is_active=true).
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await checkLoginBlock('unblockeduser', '1.2.3.4');
      expect(result.blocked).toBe(false);
    });

    it('debería verificar que la query filtra por is_active=true', async () => {
      // Verificar que se llama a .eq('is_active', true) en la cadena de consulta
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      await checkLoginBlock('testuser', '1.2.3.4');

      // El mock .eq debe haber sido llamado con is_active, true en algún momento
      const eqCalls = mockSupabaseClient.__mockQuery.eq.mock.calls;
      const hasIsActiveFilter = eqCalls.some(([field, value]) => field === 'is_active' && value === true);
      expect(hasIsActiveFilter).toBe(true);
    });

    it('debería retornar blocked=true para un bloqueo de IP activo', async () => {
      const blockedUntil = new Date(Date.now() + 15 * 60 * 1000); // +15 min

      // Primera consulta (usuario): sin bloqueo
      mockSupabaseClient.__mockQuery.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null })
        // Segunda consulta (IP): retorna bloqueo
        .mockResolvedValueOnce({
          data: {
            id: 2,
            block_type: 'ip',
            key: '5.6.7.8',
            blocked_until: blockedUntil.toISOString(),
            reason: 'too_many_failed_attempts',
            created_at: new Date().toISOString(),
            is_active: true,
          },
          error: null,
        });

      const result = await checkLoginBlock('anyuser', '5.6.7.8');
      expect(result.blocked).toBe(true);
      expect(result.type).toBe('ip');
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('debería retornar blocked=false si el bloqueo expiró', async () => {
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await checkLoginBlock('expireduser', '1.2.3.4');
      expect(result.blocked).toBe(false);
    });
  });

  describe('recordLoginAttempt', () => {
    it('debería insertar un intento exitoso', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      await recordLoginAttempt({
        username: 'testuser',
        ip: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
        estado: 'success',
        escenarioId: 1000,
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
          ip: '1.2.3.4',
          estado: 'success',
          whitelisted: false,
        })
      );
    });

    it('debería marcar whitelisted=true para IPs privadas', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      await recordLoginAttempt({
        username: 'testuser',
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        estado: 'fail',
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          whitelisted: true,
        })
      );
    });

    it('debería normalizar IPv6-mapped IPv4', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      await recordLoginAttempt({
        username: 'testuser',
        ip: '::ffff:127.0.0.1',
        userAgent: 'Mozilla/5.0',
        estado: 'success',
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: '127.0.0.1',
        })
      );
    });
  });

  describe('evaluateAndApplyBlocks', () => {
    it('debería bloquear usuario tras 3 fails en <10 min', async () => {
      // Mock de count query (3 fails)
      const selectMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const gteMock = vi.fn().mockReturnThis();
      mockSupabaseClient.__mockQuery.select = selectMock;
      mockSupabaseClient.__mockQuery.eq = eqMock;
      mockSupabaseClient.__mockQuery.gte = gteMock;

      // Primera consulta: count de fails del usuario = 3
      selectMock.mockReturnValueOnce({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
      });

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('failuser', '1.2.3.4');

      expect(result.userBlocked).toBeDefined();
      expect(result.userBlocked?.until).toBeInstanceOf(Date);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          block_type: 'user',
          key: 'failuser',
          reason: 'too_many_failed_attempts',
          is_active: true,  // FIX (Issue 4): is_active=true explícito en el upsert
        }),
        { onConflict: 'block_type,key' }
      );
    });

    it('NO debería bloquear usuario si los fails son > 10 min', async () => {
      // Mock de count query (0 fails recientes)
      const selectMock = vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });
      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('oldfailuser', '1.2.3.4');

      expect(result.userBlocked).toBeUndefined();
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('debería bloquear IP tras 5 intentos TOTALES (Opción A) incluso con el mismo username', async () => {
      // FIX (Issue 3 — Opción A): ahora se cuenta el total de intentos, no usernames distintos.
      // Este test era 'NO debería bloquear IP si los fails son del MISMO username' — ahora SÍ debe bloquear.
      const ip = '8.8.8.8';

      // Primera consulta: count de fails del usuario = 0 (para no bloquear usuario)
      // Segunda consulta: count total de fails de IP = 5 (mismo usuario, debe bloquear IP)
      const selectMock = vi.fn()
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        })
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 5, error: null }),  // 5 intentos totales
        });

      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('sameuser', ip);

      // Debe bloquear la IP (Opción A — total intentos)
      expect(result.ipBlocked).toBeDefined();
      expect(result.ipBlocked?.until).toBeInstanceOf(Date);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          block_type: 'ip',
          key: ip,
          reason: 'too_many_failed_attempts',
          is_active: true,
        }),
        { onConflict: 'block_type,key' }
      );
    });

    it('debería bloquear IP tras 5 intentos totales en <10 min (distintos usuarios)', async () => {
      const ip = '9.9.9.9';

      // Primera consulta: count de fails del usuario = 0
      // Segunda consulta: count total de fails de IP = 5 (distintos usuarios, también bloquea)
      const selectMock = vi.fn()
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        })
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 5, error: null }),
        });

      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('user0', ip);

      expect(result.ipBlocked).toBeDefined();
      expect(result.ipBlocked?.until).toBeInstanceOf(Date);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          block_type: 'ip',
          key: ip,
          reason: 'too_many_failed_attempts',
          is_active: true,
        }),
        { onConflict: 'block_type,key' }
      );
    });

    it('NO debería bloquear IP si los intentos totales son < 5', async () => {
      const ip = '7.7.7.7';

      // Primera consulta: count de fails del usuario = 0
      // Segunda consulta: count total de fails de IP = 4 (por debajo del umbral)
      const selectMock = vi.fn()
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        })
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 4, error: null }),
        });

      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('user0', ip);

      expect(result.ipBlocked).toBeUndefined();
    });

    it('debería setear is_active=true en el upsert para reactivar bloqueos previos', async () => {
      // FIX (Issue 4): si se desbloquea manualmente y el mismo user/IP vuelve a fallar,
      // el upsert debe setear is_active=true explícitamente para reactivar el bloqueo.
      const selectMock = vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
      });
      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      await evaluateAndApplyBlocks('reoffender', '1.2.3.4');

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          is_active: true,
        }),
        expect.anything()
      );
    });

    it('NO debería bloquear IP whitelisted (192.168.x.x)', async () => {
      const ip = '192.168.1.100';

      // Primera consulta: count de fails del usuario = 0
      const selectMock = vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });

      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('user0', ip);

      expect(result.ipBlocked).toBeUndefined();
      // No debe hacer consulta de IP ni upsert porque la IP está whitelisted
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  // ==============================================================================
  // Tests de getClientIp (probados via runLoginSecurity — la función no es exportada)
  //
  // FIX: getClientIp ya no rechaza IPs privadas del header x-forwarded-for.
  // Ahora devuelve siempre la primera IP no-vacía del header, sin filtrar por whitelist.
  // ==============================================================================

  describe('getClientIp (via runLoginSecurity)', () => {
    // upstream siempre ok para tests de IP (no queremos probar lógica de auth aquí)
    const upstreamOk = vi.fn().mockResolvedValue({ success: true, token: 'tok' });

    beforeEach(() => {
      upstreamOk.mockClear();
      // Supabase: no hay bloqueos activos (maybeSingle → null) y insert ok
      mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabaseClient.__mockQuery.insert.mockResolvedValue({ error: null });
      // evaluateAndApplyBlocks no se llama en success, pero por si acaso:
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
      });
      mockSupabaseClient.__mockQuery.select = selectMock;
    });

    it('debería loguear la IP privada real del header x-forwarded-for (no 127.0.0.1)', async () => {
      // BUG FIX: antes devolvía 127.0.0.1 para IPs corporativas 192.168.x.x
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      const req = makeRequest({ 'x-forwarded-for': '192.168.1.50' });
      await runLoginSecurity(req, upstreamOk);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '192.168.1.50' })
      );
    });

    it('debería tomar el primer IP de x-forwarded-for cuando hay cadena de proxies', async () => {
      // Formato típico: cliente, proxy1, proxy2 — el primero es el cliente real
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      const req = makeRequest({ 'x-forwarded-for': '203.0.113.5, 192.168.1.50' });
      await runLoginSecurity(req, upstreamOk);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '203.0.113.5' })
      );
    });

    it('debería usar x-real-ip como fallback si no hay x-forwarded-for', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      const req = makeRequest({ 'x-real-ip': '10.0.0.5' });
      await runLoginSecurity(req, upstreamOk);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '10.0.0.5' })
      );
    });

    it('debería retornar 127.0.0.1 si no hay headers de IP', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.insert = insertMock;

      const req = makeRequest(); // sin headers de IP
      await runLoginSecurity(req, upstreamOk);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '127.0.0.1' })
      );
    });
  });
});
