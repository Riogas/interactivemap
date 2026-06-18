/**
 * Helper para leer y escribir la configuracion global de limites de bloqueo.
 *
 * La configuracion se persiste en la tabla `login_security_config` (single-row, id=1).
 * - getLoginSecurityConfig(): lee la config activa. Graceful degradation: si Supabase falla, retorna defaults.
 * - setLoginSecurityConfig(): actualiza la config global. Lanza excepcion si falla (el caller decide que hacer).
 */

import { getServerSupabaseClient } from '@/lib/supabase';

// ==============================================================================
// TIPOS
// ==============================================================================

export interface LoginSecurityConfig {
  /** Cantidad de intentos fallidos antes de bloquear al usuario. */
  maxIntentosUsuario: number;
  /** Cantidad de intentos totales fallidos desde una IP antes de bloquear la IP. */
  maxIntentosIp: number;
  /** Duracion del bloqueo de usuario en minutos tras alcanzar el threshold. */
  tiempoBloqueoUsuarioMinutos: number;
  /** Duracion del bloqueo de IP en minutos tras alcanzar el threshold. */
  tiempoBloqueoIpMinutos: number;
  /** Patrones de IP con asteriscos como wildcard (ej: '192.168.*.*'). IPs que matcheen no se bloquean (pero se loguean). */
  ipWhitelistPatterns: string[];
  /** Mensaje que se muestra al usuario cuando intenta login y esta bloqueado. */
  mensajeBloqueo: string;
  /** Mensaje especifico cuando el bloqueo es por IP (si vacio, se usa mensajeBloqueo). */
  mensajeBloqueoIp: string;
}

// ==============================================================================
// DEFAULTS (deben coincidir con los valores INSERT en la migracion SQL)
// ==============================================================================

export const DEFAULT_LOGIN_SECURITY_CONFIG: LoginSecurityConfig = {
  maxIntentosUsuario: 3,
  maxIntentosIp: 5,
  tiempoBloqueoUsuarioMinutos: 15,
  tiempoBloqueoIpMinutos: 15,
  ipWhitelistPatterns: [],
  mensajeBloqueo: 'Tu acceso esta bloqueado temporalmente. Contacta al administrador.',
  mensajeBloqueoIp: 'Tu acceso fue bloqueado por demasiados intentos desde tu red. Contacta al administrador.',
};

// ==============================================================================
// FUNCIONES
// ==============================================================================

/**
 * Lee la configuracion global de limites de bloqueo.
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
      .select('max_intentos_usuario, max_intentos_ip, tiempo_bloqueo_usuario_minutos, tiempo_bloqueo_ip_minutos, ip_whitelist_patterns, mensaje_bloqueo, mensaje_bloqueo_ip')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.error('[login-security-config] Error al leer config:', error);
      return DEFAULT_LOGIN_SECURITY_CONFIG;
    }

    if (!data) {
      // Row no existe (primera vez, antes de correr la migracion)
      console.warn('[login-security-config] No hay row de config en DB, usando defaults');
      return DEFAULT_LOGIN_SECURITY_CONFIG;
    }

    const maxIntentosUsuario = typeof data.max_intentos_usuario === 'number' && data.max_intentos_usuario > 0
      ? data.max_intentos_usuario
      : DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosUsuario;

    const maxIntentosIp = typeof data.max_intentos_ip === 'number' && data.max_intentos_ip > 0
      ? data.max_intentos_ip
      : DEFAULT_LOGIN_SECURITY_CONFIG.maxIntentosIp;

    const tiempoBloqueoUsuarioMinutos = typeof data.tiempo_bloqueo_usuario_minutos === 'number' && data.tiempo_bloqueo_usuario_minutos > 0
      ? data.tiempo_bloqueo_usuario_minutos
      : DEFAULT_LOGIN_SECURITY_CONFIG.tiempoBloqueoUsuarioMinutos;

    const tiempoBloqueoIpMinutos = typeof data.tiempo_bloqueo_ip_minutos === 'number' && data.tiempo_bloqueo_ip_minutos > 0
      ? data.tiempo_bloqueo_ip_minutos
      : DEFAULT_LOGIN_SECURITY_CONFIG.tiempoBloqueoIpMinutos;

    const ipWhitelistPatterns = Array.isArray(data.ip_whitelist_patterns)
      ? (data.ip_whitelist_patterns as unknown[]).filter((p): p is string => typeof p === 'string')
      : DEFAULT_LOGIN_SECURITY_CONFIG.ipWhitelistPatterns;

    const mensajeBloqueo = typeof data.mensaje_bloqueo === 'string' && data.mensaje_bloqueo.trim().length > 0
      ? data.mensaje_bloqueo.trim()
      : DEFAULT_LOGIN_SECURITY_CONFIG.mensajeBloqueo;

    const mensajeBloqueoIp = typeof data.mensaje_bloqueo_ip === 'string' && data.mensaje_bloqueo_ip.trim().length > 0
      ? data.mensaje_bloqueo_ip.trim()
      : DEFAULT_LOGIN_SECURITY_CONFIG.mensajeBloqueoIp;

    return { maxIntentosUsuario, maxIntentosIp, tiempoBloqueoUsuarioMinutos, tiempoBloqueoIpMinutos, ipWhitelistPatterns, mensajeBloqueo, mensajeBloqueoIp };
  } catch (error) {
    console.error('[login-security-config] Excepcion inesperada al leer config:', error);
    return DEFAULT_LOGIN_SECURITY_CONFIG;
  }
}

/**
 * Actualiza la configuracion global de limites de bloqueo.
 *
 * @param config - Nuevos valores de configuracion.
 * @param updatedBy - Username del admin que hace el cambio (para audit trail).
 * @throws Error si Supabase falla (el caller debe manejar la excepcion).
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
      tiempo_bloqueo_usuario_minutos: config.tiempoBloqueoUsuarioMinutos,
      tiempo_bloqueo_ip_minutos: config.tiempoBloqueoIpMinutos,
      ip_whitelist_patterns: config.ipWhitelistPatterns,
      mensaje_bloqueo: config.mensajeBloqueo,
      mensaje_bloqueo_ip: config.mensajeBloqueoIp,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }, { onConflict: 'id' });

  if (error) {
    console.error('[login-security-config] Error al guardar config:', error);
    throw new Error(`Error al guardar configuracion: ${error.message}`);
  }
}
