/**
 * Tests para lib/login-security-config.ts
 *
 * Prueba lectura y escritura de la config global de limites de bloqueo.
 * Usa vi.mock para evitar conexion real a Supabase.
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
      data: {
        max_intentos_usuario: 7,
        max_intentos_ip: 12,
        tiempo_bloqueo_usuario_minutos: 20,
        tiempo_bloqueo_ip_minutos: 45,
        ip_whitelist_patterns: ['192.168.*.*'],
        mensaje_bloqueo: 'Bloqueado por admin.',
      },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    expect(config.maxIntentosUsuario).toBe(7);
    expect(config.maxIntentosIp).toBe(12);
    expect(config.tiempoBloqueoUsuarioMinutos).toBe(20);
    expect(config.tiempoBloqueoIpMinutos).toBe(45);
    expect(config.ipWhitelistPatterns).toEqual(['192.168.*.*']);
    expect(config.mensajeBloqueo).toBe('Bloqueado por admin.');
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
    expect(config.tiempoBloqueoUsuarioMinutos).toBe(15);
    expect(config.tiempoBloqueoIpMinutos).toBe(15);
    expect(config.ipWhitelistPatterns).toEqual([]);
    expect(typeof config.mensajeBloqueo).toBe('string');
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
      data: {
        max_intentos_usuario: 0,
        max_intentos_ip: -1,
        tiempo_bloqueo_usuario_minutos: 0,
        tiempo_bloqueo_ip_minutos: -5,
        ip_whitelist_patterns: null,
        mensaje_bloqueo: '',
      },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    // Campos invalidos → defaults
    expect(config.maxIntentosUsuario).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosUsuario);
    expect(config.maxIntentosIp).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosIp);
    expect(config.tiempoBloqueoUsuarioMinutos).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.tiempoBloqueoUsuarioMinutos);
    expect(config.tiempoBloqueoIpMinutos).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.tiempoBloqueoIpMinutos);
    expect(config.ipWhitelistPatterns).toEqual([]);
    expect(config.mensajeBloqueo).toBe(DEFAULT_LOGIN_SECURITY_CONFIG.mensajeBloqueo);
  });

  it('acepta valores positivos validos', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: {
        max_intentos_usuario: 10,
        max_intentos_ip: 20,
        tiempo_bloqueo_usuario_minutos: 60,
        tiempo_bloqueo_ip_minutos: 120,
        ip_whitelist_patterns: ['10.0.0.*', '172.16.*.*'],
        mensaje_bloqueo: 'Contacta soporte.',
      },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    expect(config.maxIntentosUsuario).toBe(10);
    expect(config.maxIntentosIp).toBe(20);
    expect(config.tiempoBloqueoUsuarioMinutos).toBe(60);
    expect(config.tiempoBloqueoIpMinutos).toBe(120);
    expect(config.ipWhitelistPatterns).toEqual(['10.0.0.*', '172.16.*.*']);
    expect(config.mensajeBloqueo).toBe('Contacta soporte.');
  });

  it('filtra elementos no-string de ip_whitelist_patterns', async () => {
    mockSupabaseClient.__mockQuery.maybeSingle.mockResolvedValueOnce({
      data: {
        max_intentos_usuario: 3,
        max_intentos_ip: 5,
        tiempo_bloqueo_usuario_minutos: 15,
        tiempo_bloqueo_ip_minutos: 15,
        ip_whitelist_patterns: ['192.168.*.*', 123, null, '10.0.0.*'],
        mensaje_bloqueo: 'Bloqueado.',
      },
      error: null,
    });

    const config = await getLoginSecurityConfig();

    // Solo strings deben sobrevivir el filtrado
    expect(config.ipWhitelistPatterns).toEqual(['192.168.*.*', '10.0.0.*']);
  });
});

describe('setLoginSecurityConfig', () => {
  beforeEach(() => {
    mockSupabaseClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  it('hace upsert con los valores correctos (tiempos independientes)', async () => {
    await setLoginSecurityConfig(
      {
        maxIntentosUsuario: 8,
        maxIntentosIp: 15,
        tiempoBloqueoUsuarioMinutos: 10,
        tiempoBloqueoIpMinutos: 30,
        ipWhitelistPatterns: ['192.168.*.*'],
        mensajeBloqueo: 'Bloqueado.',
        mensajeBloqueoIp: 'Bloqueado IP.',
      },
      'admin'
    );

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('login_security_config');
    expect(mockSupabaseClient.__mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        max_intentos_usuario: 8,
        max_intentos_ip: 15,
        tiempo_bloqueo_usuario_minutos: 10,
        tiempo_bloqueo_ip_minutos: 30,
        ip_whitelist_patterns: ['192.168.*.*'],
        mensaje_bloqueo: 'Bloqueado.',
        updated_by: 'admin',
      }),
      { onConflict: 'id' }
    );
  });

  it('acepta updatedBy null', async () => {
    await setLoginSecurityConfig(
      {
        maxIntentosUsuario: 5,
        maxIntentosIp: 10,
        tiempoBloqueoUsuarioMinutos: 15,
        tiempoBloqueoIpMinutos: 15,
        ipWhitelistPatterns: [],
        mensajeBloqueo: 'Bloqueado.',
        mensajeBloqueoIp: 'Bloqueado IP.',
      },
      null
    );

    expect(mockSupabaseClient.__mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ updated_by: null }),
      { onConflict: 'id' }
    );
  });

  it('acepta whitelist vacia', async () => {
    await setLoginSecurityConfig(
      {
        maxIntentosUsuario: 5,
        maxIntentosIp: 10,
        tiempoBloqueoUsuarioMinutos: 15,
        tiempoBloqueoIpMinutos: 15,
        ipWhitelistPatterns: [],
        mensajeBloqueo: 'Bloqueado.',
        mensajeBloqueoIp: 'Bloqueado IP.',
      },
      'admin'
    );

    expect(mockSupabaseClient.__mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ip_whitelist_patterns: [] }),
      { onConflict: 'id' }
    );
  });

  it('lanza excepcion si Supabase retorna error', async () => {
    mockSupabaseClient.__mockQuery.upsert.mockResolvedValueOnce({
      error: { message: 'DB error' },
    });

    await expect(
      setLoginSecurityConfig(
        {
          maxIntentosUsuario: 5,
          maxIntentosIp: 10,
          tiempoBloqueoUsuarioMinutos: 15,
          tiempoBloqueoIpMinutos: 15,
          ipWhitelistPatterns: [],
          mensajeBloqueo: 'Bloqueado.',
          mensajeBloqueoIp: 'Bloqueado IP.',
        },
        'admin'
      )
    ).rejects.toThrow('Error al guardar configuracion');
  });
});
