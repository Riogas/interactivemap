/**
 * Tests para login-security.ts
 *
 * Tests unitarios con mocks de Supabase para evitar dependencias de BD real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkLoginBlock, recordLoginAttempt, evaluateAndApplyBlocks } from './login-security';

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

    it('debería retornar blocked=true para un bloqueo de usuario activo', async () => {
      const blockedUntil = new Date(Date.now() + 10 * 60 * 1000); // +10 min

      // Primera consulta (usuario): retorna bloqueo
      mockSupabaseClient.__mockQuery.maybeSingle
        .mockResolvedValueOnce({
          data: {
            id: 1,
            block_type: 'user',
            key: 'blockeduser',
            blocked_until: blockedUntil.toISOString(),
            reason: 'too_many_failed_attempts',
            created_at: new Date().toISOString(),
          },
          error: null,
        });

      const result = await checkLoginBlock('blockeduser', '1.2.3.4');
      expect(result.blocked).toBe(true);
      expect(result.type).toBe('user');
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
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

    it('debería bloquear IP tras 5 usernames distintos fallidos en <10 min', async () => {
      const ip = '9.9.9.9';

      // Primera consulta: count de fails del usuario = 0
      // Segunda consulta: usernames desde la IP = 5 distintos
      const selectMock = vi.fn()
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        })
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({
            data: [
              { username: 'user0' },
              { username: 'user1' },
              { username: 'user2' },
              { username: 'user3' },
              { username: 'user4' },
            ],
            error: null,
          }),
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
        }),
        { onConflict: 'block_type,key' }
      );
    });

    it('NO debería bloquear IP si los fails son del MISMO username', async () => {
      const ip = '8.8.8.8';

      // Primera consulta: count de fails del usuario = 10 (bloquea usuario)
      // Segunda consulta: usernames desde IP = 1 único (NO bloquea IP)
      const selectMock = vi.fn()
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 10, error: null }),
        })
        .mockReturnValueOnce({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({
            data: Array(10).fill({ username: 'sameuser' }),
            error: null,
          }),
        });

      mockSupabaseClient.__mockQuery.select = selectMock;

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseClient.__mockQuery.upsert = upsertMock;

      const result = await evaluateAndApplyBlocks('sameuser', ip);

      // Debe bloquear al usuario, NO a la IP
      expect(result.userBlocked).toBeDefined();
      expect(result.ipBlocked).toBeUndefined();

      // Solo debe haberse llamado upsert una vez (para el usuario)
      expect(upsertMock).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          block_type: 'user',
        }),
        { onConflict: 'block_type,key' }
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
});
