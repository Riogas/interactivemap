/**
 * Helper para leer y escribir la configuración global de límites de bloqueo.
 *
 * La configuración se persiste en la tabla `login_security_config` (single-row, id=1).
 * - getLoginSecurityConfig(): lee la config activa. Graceful degradation: si Supabase falla, retorna defaults.
 * - setLoginSecurityConfig(): actualiza la config global. Lanza excepción si falla (el caller decide qué hacer).
 */

import { getServerSupabaseClient } from '@/lib/supabase';

// ==============================================================================
// TIPOS
// ==============================================================================

export interface LoginSecurityConfig {
  /** Cantidad de intentos fallidos antes de bloquear al usuario. */
  maxIntentosUsuario: number;
  /** Cantidad de usernames distintos fallidos desde una IP antes de bloquear la IP. */
  maxIntentosIp: number;
}

// ==============================================================================
// DEFAULTS (deben coincidir con los valores INSERT en la migración SQL)
// ==============================================================================

export const DEFAULT_LOGIN_SECURITY_CONFIG: LoginSecurityConfig = {
  maxIntentosUsuario: 3,
  maxIntentosIp: 5,
};

// ==============================================================================
// FUNCIONES
// ==============================================================================

/**
 * Lee la configuración global de límites de bloqueo.
 *
 * Graceful degradation: si Supabase falla o no hay row, retorna DEFAULT_LOGIN_SECURITY_CONFIG.
 * Esto garantiza que evaluateAndApplyBlocks nunca queda bloqueado por un fallo de config.
 */
export async function getLoginSecurityConfig(): Promise<LoginSecurityConfig> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    const { data, error } = await client
      .from('login_security_config')
      .select('max_intentos_usuario, max_intentos_ip')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.error('[login-security-config] Error al leer config:', error);
      return DEFAULT_LOGIN_SECURITY_CONFIG;
    }

    if (!data) {
      // Row no existe (primera vez, antes de correr la migración)
      console.warn('[login-security-config] No hay row de config en DB, usando defaults');
      return DEFAULT_LOGIN_SECURITY_CONFIG;
    }

    const maxIntentosUsuario = typeof data.max_intentos_usuario === 'number' && data.max_intentos_usuario > 0
      ? data.max_intentos_usuario
      : DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosUsuario;

    const maxIntentosIp = typeof data.max_intentos_ip === 'number' && data.max_intentos_ip > 0
      ? data.max_intentos_ip
      : DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosIp;

    return { maxIntentosUsuario, maxIntentosIp };
  } catch (error) {
    console.error('[login-security-config] Excepción inesperada al leer config:', error);
    return DEFAULT_LOGIN_SECURITY_CONFIG;
  }
}

/**
 * Actualiza la configuración global de límites de bloqueo.
 *
 * @param config - Nuevos valores de configuración.
 * @param updatedBy - Username del admin que hace el cambio (para audit trail).
 * @throws Error si Supabase falla (el caller debe manejar la excepción).
 */
export async function setLoginSecurityConfig(
  config: LoginSecurityConfig,
  updatedBy: string | null
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getServerSupabaseClient() as any;

  const { error } = await client
    .from('login_security_config')
    .upsert({
      id: 1,
      max_intentos_usuario: config.maxIntentosUsuario,
      max_intentos_ip: config.maxIntentosIp,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }, { onConflict: 'id' });

  if (error) {
    console.error('[login-security-config] Error al guardar config:', error);
    throw new Error(`Error al guardar configuración: ${error.message}`);
  }
}
