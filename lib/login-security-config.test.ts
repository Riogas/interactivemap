/**
 * Tests para lib/login-security-config.ts
 *
 * Prueba lectura y escritura de la config global de límites de bloqueo.
 * Usa vi.mock para evitar conexión real a Supabase.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLoginSecurityConfig,
  setLoginSecurityConfig,
  DEFAULT_LOGIN_SECURITY_CONFIG,
} from './login-security-config';

// ==============================================================================
// MOCK DE SUPABASE
// ==============================================================================

function createMockSupabaseClient() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error: null }),
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
// TESTS
// ==============================================================================

describe('getLoginSecurityConfig', () => {
  beforeEach(() => {
    mockSupabaseClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  it('retorna config de DB cuando hay row', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: { max_intentos_usuario: 7, max_intentos_ip: 12 },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    expect(config.maxIntentosUsuario).toBe(7);
    expect(config.maxIntentosIp).toBe(12);
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('login_security_config');
  });

  it('retorna defaults cuando no hay row (data=null)', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const config = await getLoginSecurityConfig();

    expect(config).toEqual(DEFAULT_LOGIN_SECURITY_CONFIG);
    expect(config.maxIntentosUsuario).toBe(3);
    expect(config.maxIntentosIp).toBe(5);
  });

  it('retorna defaults cuando Supabase retorna error', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    });

    const config = await getLoginSecurityConfig();

    expect(config).toEqual(DEFAULT_LOGIN_SECURITY_CONFIG);
  });

  it('retorna defaults cuando Supabase lanza excepcion', async () => {
    mockSupabaseClient.from.mockImplementationOnce(() => {
      throw new Error('Network error');
    });

    const config = await getLoginSecurityConfig();

    expect(config).toEqual(DEFAULT_LOGIN_SECURITY_CONFIG);
  });

  it('usa defaults para campos invalidos (0 o negativo)', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: { max_intentos_usuario: 0, max_intentos_ip: -1 },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    // Campos invalidos → defaults
    expect(config.maxIntentosUsuario).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosUsuario);
    expect(config.maxIntentosIp).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosIp);
  });

  it('acepta valores positivos validos', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: { max_intentos_usuario: 10, max_intentos_ip: 20 },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    expect(config.maxIntentosUsuario).toBe(10);
    expect(config.maxIntentosIp).toBe(20);
  });
});

describe('setLoginSecurityConfig', () => {
  beforeEach(() => {
    mockSupabaseClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  it('hace upsert con los valores correctos', async () => {
    await setLoginSecurityConfig({ maxIntentosUsuario: 8, maxIntentosIp: 15 }, 'admin');

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('login_security_config');
    expect(mockSupabaseClient.__mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        max_intentos_usuario: 8,
        max_intentos_ip: 15,
        updated_by: 'admin',
      }),
      { onConflict: 'id' }
    );
  });

  it('acepta updatedBy null', async () => {
    await setLoginSecurityConfig({ maxIntentosUsuario: 5, maxIntentosIp: 10 }, null);

    expect(mockSupabaseClient.__mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ updated_by: null }),
      { onConflict: 'id' }
    );
  });

  it('lanza excepcion si Supabase retorna error', async () => {
    mockSupabaseClient.__mockQuery.upsert.mockResolvedValueOnce({
      error: { message: 'DB error' },
    });

    await expect(
      setLoginSecurityConfig({ maxIntentosUsuario: 5, maxIntentosIp: 10 }, 'admin')
    ).rejects.toThrow('Error al guardar configuración');
  });
});
