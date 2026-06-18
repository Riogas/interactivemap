/**
 * Sistema de seguridad de login: auditoria + bloqueo anti-bruteforce
 *
 * Reglas de bloqueo:
 * - Usuario: 3 fails en 10 min → bloqueo configurable (default 15 min)
 * - IP: 5 intentos TOTALES fallidos en 10 min → bloqueo configurable (default 15 min)
 * - Username === password: rechazado sin penalty
 * - IPs whitelisted: nunca se bloquean (pero se registran con whitelisted=true)
 *
 * La duracion del bloqueo y el mensaje al usuario se leen desde login_security_config
 * (campos tiempo_bloqueo_usuario_minutos, tiempo_bloqueo_ip_minutos y mensaje_bloqueo).
 * Los patrones de whitelist dinamicos se leen desde ip_whitelist_patterns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { getLoginSecurityConfig } from '@/lib/login-security-config';
import { ipMatchesAnyPattern } from '@/lib/ip-whitelist';

// ==============================================================================
// CONSTANTES CONFIGURABLES
// ==============================================================================
// NOTA: USER_FAIL_THRESHOLD e IP_FAIL_THRESHOLD ahora se leen desde
// la tabla login_security_config via getLoginSecurityConfig() en evaluateAndApplyBlocks.
// Las constantes se mantienen aqui solo como referencia/documentacion de los defaults.

const USER_FAIL_THRESHOLD = 3;       // Default: ver login_security_config.max_intentos_usuario
const USER_FAIL_WINDOW_MINUTES = 10;

const IP_FAIL_THRESHOLD = 5;         // Default: ver login_security_config.max_intentos_ip (total intentos, no distincts)
const IP_FAIL_WINDOW_MINUTES = 10;

// ==============================================================================
// TIPOS
// ==============================================================================

export type LoginAttemptEstado = 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass';

export interface CheckBlockResult {
  blocked: boolean;
  type?: 'user' | 'ip';
  reason?: string;
  retryAfterSeconds?: number;
  mensajeBloqueo?: string;
}

export interface RecordLoginAttemptInput {
  ts?: Date;
  escenarioId?: number | null;
  username: string;
  ip: string;
  userAgent?: string;
  estado: LoginAttemptEstado;
  blockedUntil?: Date;
  whitelisted?: boolean;
  extra?: Record<string, unknown>;
}

// ==============================================================================
// FUNCIONES DE UTILIDAD (IP NORMALIZATION + WHITELIST)
// ==============================================================================
// Copiadas de lib/rate-limit.ts para evitar dependencia circular

/**
 * Lista explicita de IPs internas (sin bloqueo automatico)
 * Estas IPs siempre se excluyen del bloqueo automatico independientemente de
 * la configuracion de ip_whitelist_patterns.
 */
const WHITELISTED_IPS = [
  '127.0.0.1',           // Localhost
  '::1',                 // Localhost IPv6
  '192.168.7.13',        // Track server (self)
  '192.168.7.12',        // SGM server (importacion masiva)
];

/**
 * Normalizar IP (convertir IPv6-mapped IPv4 a IPv4)
 * Ejemplo: ::ffff:127.0.0.1 → 127.0.0.1
 */
function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
}

/**
 * Verificar si una IP esta en la whitelist estatica hardcoded
 * (incluye lista explicita + rangos privados RFC1918)
 * No incluye la whitelist dinamica de config — esa se chequea por separado.
 */
function isWhitelistedIp(ip: string): boolean {
  const normalizedIp = normalizeIp(ip);
  if (WHITELISTED_IPS.includes(normalizedIp)) return true;
  if (normalizedIp.startsWith('192.168.') || normalizedIp.startsWith('10.')) return true;
  if (normalizedIp.startsWith('172.')) {
    const segments = normalizedIp.split('.');
    if (segments.length === 4) {
      const second = parseInt(segments[1]);
      if (second >= 16 && second <= 31) return true;
    }
  }
  return false;
}

/**
 * Obtener la IP del cliente desde el request.
 *
 * FIX: La version anterior rechazaba IPs whitelisted (privadas RFC1918) del header
 * x-forwarded-for como mitigacion anti-spoofing, causando que usuarios en la red
 * corporativa (192.168.x.x) siempre cayeran al fallback 127.0.0.1.
 *
 * La nueva version confia en el primer IP no-vacio de x-forwarded-for sin filtrar
 * por whitelist. El check de whitelist sigue aplicandose correctamente en
 * recordLoginAttempt (campo whitelisted) y evaluateAndApplyBlocks (skip de bloqueo IP).
 *
 * ASUNCION DE DEPLOY: la app corre detras de nginx que sanitiza/reescribe el header
 * x-forwarded-for (escribe solo la IP real del cliente, descartando lo que el
 * cliente pudiera haber enviado). Si en algun momento se quiere defensa-en-profundidad
 * sin nginx, usar el ULTIMO IP del header (los proxies confiables van anteponiendo).
 */
function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0].trim();
    if (ip) return normalizeIp(ip);
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return normalizeIp(realIp);
  // request.ip fue removido en Next.js 13+. El fallback usa solo los headers.
  return '127.0.0.1';
}

// ==============================================================================
// FUNCIONES CORE
// ==============================================================================

/**
 * Verifica si username o IP estan actualmente bloqueados.
 *
 * FIX: filtra por is_active=true para respetar desbloqueos manuales.
 * Un row con is_active=false fue desbloqueado por admin — no bloquear aunque blocked_until sea futuro.
 *
 * Incluye mensajeBloqueo en el resultado (leido desde config) para que el caller
 * pueda usarlo en la respuesta HTTP en lugar de un hardcoded.
 */
export async function checkLoginBlock(username: string, ip: string): Promise<CheckBlockResult> {
  try {
    // Cast a any: la inferencia de tipos del cliente Supabase falla para las
    // tablas login_attempts/login_blocks (patron consistente con otros lib/ del repo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const now = new Date();

    // Normalizar IP
    const normalizedIp = normalizeIp(ip);

    // Leer mensaje de bloqueo desde config (para incluirlo en la respuesta)
    const config = await getLoginSecurityConfig();

    // Buscar bloqueo de usuario activo (query 1)
    // FIX: agregar .eq('is_active', true) para respetar desbloqueos manuales
    const { data: userBlock } = await client
      .from('login_blocks')
      .select('*')
      .eq('block_type', 'user')
      .eq('key', username)
      .eq('is_active', true)
      .gte('blocked_until', now.toISOString())
      .maybeSingle();

    if (userBlock) {
      const retryAfterSeconds = Math.ceil((new Date(userBlock.blocked_until).getTime() - now.getTime()) / 1000);
      console.log(`[login-security] user=${username} ip=${normalizedIp} → DENY (block_id=${userBlock.id}, type=user, retryAfter=${retryAfterSeconds}s)`);
      return {
        blocked: true,
        type: 'user',
        reason: userBlock.reason || 'too_many_failed_attempts',
        retryAfterSeconds,
        mensajeBloqueo: config.mensajeBloqueo,
      };
    }

    // Buscar bloqueo de IP activo (query 2)
    // FIX: agregar .eq('is_active', true) para respetar desbloqueos manuales
    const { data: ipBlock } = await client
      .from('login_blocks')
      .select('*')
      .eq('block_type', 'ip')
      .eq('key', normalizedIp)
      .eq('is_active', true)
      .gte('blocked_until', now.toISOString())
      .maybeSingle();

    if (ipBlock) {
      const retryAfterSeconds = Math.ceil((new Date(ipBlock.blocked_until).getTime() - now.getTime()) / 1000);
      console.log(`[login-security] user=${username} ip=${normalizedIp} → DENY (block_id=${ipBlock.id}, type=ip, retryAfter=${retryAfterSeconds}s)`);
      return {
        blocked: true,
        type: 'ip',
        reason: ipBlock.reason || 'too_many_failed_attempts',
        retryAfterSeconds,
        mensajeBloqueo: config.mensajeBloqueoIp || config.mensajeBloqueo,
      };
    }

    console.log(`[login-security] user=${username} ip=${normalizedIp} is_active_blocks=0 → ALLOW`);
    return { blocked: false };
  } catch (error) {
    console.error('[login-security] Supabase error in checkLoginBlock:', error);
    return { blocked: false }; // No bloquear si no podemos verificar
  }
}

/**
 * Registra un intento de login en la BD
 */
export async function recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const normalizedIp = normalizeIp(input.ip);

    await client
      .from('login_attempts')
      .insert({
        ts: input.ts?.toISOString() || new Date().toISOString(),
        escenario_id: input.escenarioId ?? null,
        username: input.username,
        ip: normalizedIp,
        user_agent: input.userAgent || null,
        estado: input.estado,
        blocked_until: input.blockedUntil?.toISOString() || null,
        whitelisted: input.whitelisted ?? isWhitelistedIp(normalizedIp),
        extra: input.extra || null,
      });
  } catch (error) {
    console.error('[login-security] Supabase error in recordLoginAttempt:', error);
    // No propagar — continuar sin registrar es mejor que bloquear el login
  }
}

/**
 * Evalua si hay que aplicar bloqueos y los crea si corresponde.
 *
 * FIX (Opcion A — Issue 3): el threshold de IP ahora es el TOTAL de intentos
 * fallidos desde esa IP (no usernames distintos). Asi, 5 intentos con el mismo
 * username desde la misma IP ya disparan el bloqueo de IP.
 *
 * FIX (Issue 4): el upsert ahora siempre setea is_active=true explicitamente,
 * asegurando que un bloqueo nuevo no herede un is_active=false de un row previo
 * desbloqueado (el ON CONFLICT actualiza todos los campos especificados).
 *
 * FIX (Opcion C — reset de contador al desbloquear): al contar fails del usuario,
 * se busca el ultimo unblocked_at en login_blocks para ese username. Si existe,
 * solo se cuentan fails POSTERIORES a ese timestamp. Asi, un admin-unblock
 * actua como "punto cero" sin modificar el historico de login_attempts.
 * Lo mismo aplica para el conteo de IP: se busca el ultimo unblocked_at de esa IP.
 *
 * FIX (nuevo — tiempos independientes): la duracion del bloqueo de usuario se lee
 * desde config.tiempoBloqueoUsuarioMinutos y la del bloqueo de IP desde
 * config.tiempoBloqueoIpMinutos (antes ambas usaban el mismo campo tiempoBloqueoMinutos).
 *
 * FIX (nuevo — whitelist dinamica): ademas de la whitelist estatica (WHITELISTED_IPS
 * + rangos RFC1918), se chequea config.ipWhitelistPatterns. Una IP que matchea
 * cualquier patron NO entra al sistema de bloqueo. Los attempts se siguen logeando
 * con whitelisted=true.
 *
 * Retorna info de bloqueos aplicados
 */
export async function evaluateAndApplyBlocks(username: string, ip: string): Promise<{
  userBlocked?: { until: Date };
  ipBlocked?: { until: Date };
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const now = new Date();
    const normalizedIp = normalizeIp(ip);
    const windowStart = new Date(now.getTime() - USER_FAIL_WINDOW_MINUTES * 60 * 1000);

    // Leer umbrales desde la config global (con graceful degradation a defaults)
    const config = await getLoginSecurityConfig();

    let userBlocked, ipBlocked;

    // FIX (Opcion C): buscar el ultimo unblocked_at para el username.
    // Solo se cuentan fails posteriores a ese timestamp (el mas reciente entre
    // windowStart y el ultimo unblocked_at). Esto garantiza que un desbloqueo
    // manual actua como "punto cero" del contador sin alterar el historico.
    const { data: lastUserUnblock } = await client
      .from('login_blocks')
      .select('unblocked_at')
      .eq('block_type', 'user')
      .eq('key', username)
      .not('unblocked_at', 'is', null)
      .order('unblocked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const userCountFrom = lastUserUnblock?.unblocked_at
      ? new Date(Math.max(
          new Date(lastUserUnblock.unblocked_at).getTime(),
          windowStart.getTime()
        )).toISOString()
      : windowStart.toISOString();

    // 1. Contar fails del username desde el punto cero efectivo
    const { count: userFailCount } = await client
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('username', username)
      .eq('estado', 'fail')
      .gte('ts', userCountFrom);

    console.log(`[login-security] user=${username} ip=${normalizedIp} user_fails=${userFailCount ?? 0} max_user=${config.maxIntentosUsuario} count_from=${userCountFrom}`);

    if (userFailCount && userFailCount >= config.maxIntentosUsuario) {
      // Usar tiempo de bloqueo de usuario (independiente del de IP)
      const blockMinutes = config.tiempoBloqueoUsuarioMinutos;
      const blockedUntil = new Date(now.getTime() + blockMinutes * 60 * 1000);
      await client
        .from('login_blocks')
        .upsert({
          block_type: 'user',
          key: username,
          blocked_until: blockedUntil.toISOString(),
          reason: 'too_many_failed_attempts',
          is_active: true,  // FIX: setear explicitamente para reactivar si fue desbloqueado manualmente
        }, { onConflict: 'block_type,key' });
      userBlocked = { until: blockedUntil };
      console.log(`[login-security] user=${username} ip=${normalizedIp} attempts=${userFailCount} max=${config.maxIntentosUsuario} blockMin=${blockMinutes} → DECISION=block-user until=${blockedUntil.toISOString()}`);
    }

    // 2. Contar TOTAL de intentos fallidos desde la IP en los ultimos 10 min
    // FIX (Opcion A): cambiado de "usernames distintos" a "total intentos"
    // FIX (Opcion C): igual que para usuario, respetar el ultimo unblocked_at de la IP
    // IMPORTANTE: Solo si la IP NO esta whitelisted (estatica NI dinamica)
    const ipIsStaticWhitelisted = isWhitelistedIp(normalizedIp);
    const ipIsDynamicWhitelisted = ipMatchesAnyPattern(normalizedIp, config.ipWhitelistPatterns);
    const ipIsWhitelisted = ipIsStaticWhitelisted || ipIsDynamicWhitelisted;

    if (!ipIsWhitelisted) {
      const { data: lastIpUnblock } = await client
        .from('login_blocks')
        .select('unblocked_at')
        .eq('block_type', 'ip')
        .eq('key', normalizedIp)
        .not('unblocked_at', 'is', null)
        .order('unblocked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const ipCountFrom = lastIpUnblock?.unblocked_at
        ? new Date(Math.max(
            new Date(lastIpUnblock.unblocked_at).getTime(),
            windowStart.getTime()
          )).toISOString()
        : windowStart.toISOString();

      const { count: ipFailCount } = await client
        .from('login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('ip', normalizedIp)
        .eq('estado', 'fail')
        .gte('ts', ipCountFrom);

      console.log(`[login-security] user=${username} ip=${normalizedIp} ip_fails=${ipFailCount ?? 0} max_ip=${config.maxIntentosIp} count_from=${ipCountFrom}`);

      if (ipFailCount && ipFailCount >= config.maxIntentosIp) {
        // Usar tiempo de bloqueo de IP (independiente del de usuario)
        const blockMinutes = config.tiempoBloqueoIpMinutos;
        const blockedUntil = new Date(now.getTime() + blockMinutes * 60 * 1000);
        await client
          .from('login_blocks')
          .upsert({
            block_type: 'ip',
            key: normalizedIp,
            blocked_until: blockedUntil.toISOString(),
            reason: 'too_many_failed_attempts',
            is_active: true,  // FIX: setear explicitamente para reactivar si fue desbloqueado manualmente
          }, { onConflict: 'block_type,key' });
        ipBlocked = { until: blockedUntil };
        console.log(`[login-security] user=${username} ip=${normalizedIp} ip_attempts=${ipFailCount} max=${config.maxIntentosIp} blockMin=${blockMinutes} → DECISION=block-ip until=${blockedUntil.toISOString()}`);
      }
    } else {
      console.log(`[login-security] user=${username} ip=${normalizedIp} → IP whitelisted (static=${ipIsStaticWhitelisted} dynamic=${ipIsDynamicWhitelisted}), skip ip-block check`);
    }

    if (!userBlocked && !ipBlocked) {
      console.log(`[login-security] user=${username} ip=${normalizedIp} → DECISION=allow (thresholds not reached)`);
    }

    return { userBlocked, ipBlocked };
  } catch (error) {
    console.error('[login-security] Supabase error in evaluateAndApplyBlocks:', error);
    return {}; // No aplicar bloqueos si hay error
  }
}

/**
 * Limpia los contadores tras un login exitoso
 * (Opcional - implementacion simple: no hacer nada)
 */
export async function onSuccessfulLogin(username: string): Promise<void> {
  void username;
  // Implementacion simple: dejar que la ventana de 10 min "olvide" naturalmente los fails
  // Si se requiere borrar explicitamente, descomentar:
  // const client = getServerSupabaseClient();
  // await client.from('login_attempts').delete().eq('username', username).eq('estado', 'fail');
}

// ==============================================================================
// HELPER PRINCIPAL PARA ENDPOINTS
// ==============================================================================

/**
 * Wrapper completo de seguridad de login
 *
 * Ejecuta el flow de 8 pasos:
 * 1. Parsear body
 * 2. Extraer metadata (ip, userAgent)
 * 3. Check user==pass
 * 4. Check blocks
 * 5. Llamar upstream
 * 6. Si OK: registrar success
 * 7. Si FAIL: registrar fail + evaluar bloqueos
 * 8. Si error de red: registrar fail + extra
 *
 * @param req - NextRequest
 * @param upstreamFn - Funcion que llama al backend de autenticacion
 * @returns NextResponse listo para devolver
 */
export async function runLoginSecurity(
  req: NextRequest,
  upstreamFn: (body: { UserName: string; Password: string; [key: string]: unknown }) => Promise<{
    success: boolean;
    message?: string;
    [key: string]: unknown;
  }>
): Promise<NextResponse> {
  try {
    // Paso 1: Parsear body
    const body = await req.json();
    const { UserName, Password, EscenarioId } = body;

    if (!UserName || !Password) {
      return NextResponse.json(
        { success: false, message: 'UserName y Password son requeridos', code: 'MISSING_FIELDS' },
        { status: 400 }
      );
    }

    // Paso 2: Extraer metadata
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || undefined;
    const escenarioId = EscenarioId ? Number(EscenarioId) : null;

    // Paso 3: Check user==pass — NO bloquea, solo flagea warning.
    // El doc lo pide como alerta (no impedimento) y "no se contara como
    // inicio de sesion incorrecto", asi que tampoco dispara bloqueo aunque
    // el upstream falle. El frontend muestra la alerta post-login.
    const userEqualsPassword = (UserName === Password);

    // Paso 4: Check blocks
    const blockCheck = await checkLoginBlock(UserName, ip);
    if (blockCheck.blocked) {
      await recordLoginAttempt({
        username: UserName,
        ip,
        userAgent,
        estado: blockCheck.type === 'user' ? 'blocked_user' : 'blocked_ip',
        blockedUntil: new Date(Date.now() + (blockCheck.retryAfterSeconds || 0) * 1000),
        escenarioId,
      });

      const mins = blockCheck.retryAfterSeconds ? Math.ceil(blockCheck.retryAfterSeconds / 60) : 10;
      // Usar mensajeBloqueo de config si esta disponible, sino fallback a mensaje generico
      const message = blockCheck.mensajeBloqueo
        ? blockCheck.mensajeBloqueo
        : blockCheck.type === 'user'
          ? `Usuario bloqueado temporalmente. Intenta de nuevo en ${mins} minutos.`
          : `Demasiados intentos desde esta IP. Proba de nuevo en ${mins} minutos.`;

      return NextResponse.json(
        {
          success: false,
          message,
          code: blockCheck.type === 'user' ? 'BLOCKED_USER' : 'BLOCKED_IP',
          retryAfterSeconds: blockCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // Paso 5: Llamar upstream
    let upstreamResult;
    try {
      upstreamResult = await upstreamFn(body);
    } catch (error) {
      // Paso 8: Error de red/timeout
      console.error('[login-security] upstreamFn threw:', error);
      await recordLoginAttempt({
        username: UserName,
        ip,
        userAgent,
        estado: 'fail',
        escenarioId,
        extra: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
      return NextResponse.json(
        { success: false, message: 'Error al conectar con el servidor de autenticacion' },
        { status: 500 }
      );
    }

    // Paso 6: Si upstream OK
    if (upstreamResult.success) {
      await recordLoginAttempt({
        username: UserName,
        ip,
        userAgent,
        estado: 'success',
        escenarioId,
        extra: userEqualsPassword ? { userEqualsPassword: true } : undefined,
      });
      await onSuccessfulLogin(UserName);
      return NextResponse.json(
        userEqualsPassword
          ? { ...upstreamResult, warning: 'USER_EQ_PASS' }
          : upstreamResult,
        { status: 200 }
      );
    }

    // Paso 7: Si upstream FAIL
    // Si user==pass: registrar como 'user_eq_pass' (no como 'fail') y NO disparar
    // bloqueos — el doc dice que el caso "user==pass" no cuenta como inicio de
    // sesion incorrecto a efectos de rate-limit / lockout.
    await recordLoginAttempt({
      username: UserName,
      ip,
      userAgent,
      estado: userEqualsPassword ? 'user_eq_pass' : 'fail',
      escenarioId,
      extra: userEqualsPassword ? { upstreamFailed: true } : undefined,
    });
    if (!userEqualsPassword) {
      await evaluateAndApplyBlocks(UserName, ip);
    }

    return NextResponse.json(
      {
        success: false,
        message: upstreamResult.message || 'Usuario o contrasena invalidos',
        code: 'INVALID_CREDENTIALS',
      },
      { status: 401 }
    );
  } catch (unexpectedError) {
    console.error('[login-security] Unexpected error in login security:', unexpectedError);
    // Fallback: permitir que el upstream intente procesar el login directamente
    // Esto evita que Supabase sea un SPOF (Single Point of Failure)
    try {
      const body = await (unexpectedError as { request?: NextRequest })?.request?.json?.() || {};
      const upstreamResult = await upstreamFn(body);
      return NextResponse.json(upstreamResult, { status: upstreamResult.success ? 200 : 401 });
    } catch (fallbackError) {
      console.error('[login-security] Fallback also failed:', fallbackError);
      return NextResponse.json(
        { success: false, message: 'Error interno del servidor' },
        { status: 500 }
      );
    }
  }
}

// Keep unused constants referenced to avoid TS/ESLint unused-variable errors
void USER_FAIL_THRESHOLD;
void IP_FAIL_WINDOW_MINUTES;
void IP_FAIL_THRESHOLD;
