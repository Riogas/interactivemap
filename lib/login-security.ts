/**
 * Sistema de seguridad de login: auditoría + bloqueo anti-bruteforce
 *
 * Reglas de bloqueo:
 * - Usuario: 3 fails en 10 min → bloqueo de 10 min
 * - IP: 5 usernames distintos fallidos en 10 min → bloqueo de 15 min
 * - Username === password: rechazado sin penalty
 * - IPs whitelisted: nunca se bloquean (pero se registran)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

// ==============================================================================
// CONSTANTES CONFIGURABLES
// ==============================================================================

const USER_FAIL_THRESHOLD = 3;
const USER_FAIL_WINDOW_MINUTES = 10;
const USER_BLOCK_MINUTES = 10;

const IP_DISTINCT_USERS_THRESHOLD = 5;
const IP_FAIL_WINDOW_MINUTES = 10;
const IP_BLOCK_MINUTES = 15;

// ==============================================================================
// TIPOS
// ==============================================================================

export type LoginAttemptEstado = 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass';

export interface CheckBlockResult {
  blocked: boolean;
  type?: 'user' | 'ip';
  reason?: string;
  retryAfterSeconds?: number;
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
 * Lista explícita de IPs internas (sin bloqueo)
 */
const WHITELISTED_IPS = [
  '127.0.0.1',           // Localhost
  '::1',                 // Localhost IPv6
  '192.168.7.13',        // Track server (self)
  '192.168.7.12',        // SGM server (importación masiva)
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
 * Verificar si una IP está en la whitelist
 * (incluye lista explícita + rangos privados)
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
 * Obtener la IP del cliente desde el request
 */
function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0].trim();
    const normalized = normalizeIp(ip);
    // Rechazar IPs privadas en el header para prevenir spoofing de whitelist
    if (!isWhitelistedIp(normalized) && !normalized.startsWith('0.')) {
      return normalized;
    }
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const normalized = normalizeIp(realIp);
    if (!isWhitelistedIp(normalized)) {
      return normalized;
    }
  }
  // request.ip fue removido en Next.js 13+. El fallback usa solo los headers.
  return '127.0.0.1';
}

// ==============================================================================
// FUNCIONES CORE
// ==============================================================================

/**
 * Verifica si username o IP están actualmente bloqueados
 */
export async function checkLoginBlock(username: string, ip: string): Promise<CheckBlockResult> {
  try {
    // Cast a any: la inferencia de tipos del cliente Supabase falla para las
    // tablas login_attempts/login_blocks (patrón consistente con otros lib/ del repo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const now = new Date();

    // Normalizar IP
    const normalizedIp = normalizeIp(ip);

    // Buscar bloqueo de usuario (query 1)
    const { data: userBlock } = await client
      .from('login_blocks')
      .select('*')
      .eq('block_type', 'user')
      .eq('key', username)
      .gte('blocked_until', now.toISOString())
      .maybeSingle();

    if (userBlock) {
      const retryAfterSeconds = Math.ceil((new Date(userBlock.blocked_until).getTime() - now.getTime()) / 1000);
      return {
        blocked: true,
        type: 'user',
        reason: userBlock.reason || 'too_many_failed_attempts',
        retryAfterSeconds,
      };
    }

    // Buscar bloqueo de IP (query 2)
    const { data: ipBlock } = await client
      .from('login_blocks')
      .select('*')
      .eq('block_type', 'ip')
      .eq('key', normalizedIp)
      .gte('blocked_until', now.toISOString())
      .maybeSingle();

    if (ipBlock) {
      const retryAfterSeconds = Math.ceil((new Date(ipBlock.blocked_until).getTime() - now.getTime()) / 1000);
      return {
        blocked: true,
        type: 'ip',
        reason: ipBlock.reason || 'too_many_failed_attempts',
        retryAfterSeconds,
      };
    }

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
 * Evalúa si hay que aplicar bloqueos y los crea si corresponde
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

    let userBlocked, ipBlocked;

    // 1. Contar fails del username en los últimos 10 min
    const { count: userFailCount } = await client
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('username', username)
      .eq('estado', 'fail')
      .gte('ts', windowStart.toISOString());

    if (userFailCount && userFailCount >= USER_FAIL_THRESHOLD) {
      const blockedUntil = new Date(now.getTime() + USER_BLOCK_MINUTES * 60 * 1000);
      await client
        .from('login_blocks')
        .upsert({
          block_type: 'user',
          key: username,
          blocked_until: blockedUntil.toISOString(),
          reason: 'too_many_failed_attempts',
        }, { onConflict: 'block_type,key' });
      userBlocked = { until: blockedUntil };
    }

    // 2. Contar fails desde la IP con usernames DISTINTOS en los últimos 10 min
    // IMPORTANTE: Solo si la IP NO está whitelisted
    if (!isWhitelistedIp(normalizedIp)) {
      const { data: ipFails } = await client
        .from('login_attempts')
        .select('username')
        .eq('ip', normalizedIp)
        .eq('estado', 'fail')
        .gte('ts', windowStart.toISOString());

      // Contar usernames únicos
      const distinctUsernames = new Set((ipFails as { username: string }[] | null)?.map(r => r.username) || []);

      if (distinctUsernames.size >= IP_DISTINCT_USERS_THRESHOLD) {
        const blockedUntil = new Date(now.getTime() + IP_BLOCK_MINUTES * 60 * 1000);
        await client
          .from('login_blocks')
          .upsert({
            block_type: 'ip',
            key: normalizedIp,
            blocked_until: blockedUntil.toISOString(),
            reason: 'too_many_failed_attempts',
          }, { onConflict: 'block_type,key' });
        ipBlocked = { until: blockedUntil };
      }
    }

    return { userBlocked, ipBlocked };
  } catch (error) {
    console.error('[login-security] Supabase error in evaluateAndApplyBlocks:', error);
    return {}; // No aplicar bloqueos si hay error
  }
}

/**
 * Limpia los contadores tras un login exitoso
 * (Opcional - implementación simple: no hacer nada)
 */
export async function onSuccessfulLogin(_username: string): Promise<void> {
  // Implementación simple: dejar que la ventana de 10 min "olvide" naturalmente los fails
  // Si se requiere borrar explícitamente, descomentar:
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
 * @param upstreamFn - Función que llama al backend de autenticación
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

    // Paso 3: Check user==pass
    if (UserName === Password) {
      await recordLoginAttempt({
        username: UserName,
        ip,
        userAgent,
        estado: 'user_eq_pass',
        escenarioId,
      });
      return NextResponse.json(
        {
          success: false,
          message: 'El nombre de usuario y la contraseña no pueden coincidir.',
          code: 'USER_EQ_PASS',
        },
        { status: 400 }
      );
    }

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
      const message = blockCheck.type === 'user'
        ? `Usuario bloqueado temporalmente. Intentá de nuevo en ${mins} minutos.`
        : `Demasiados intentos desde esta IP. Probá de nuevo en ${mins} minutos.`;

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
      await recordLoginAttempt({
        username: UserName,
        ip,
        userAgent,
        estado: 'fail',
        escenarioId,
        extra: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
      return NextResponse.json(
        { success: false, message: 'Error al conectar con el servidor de autenticación' },
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
      });
      await onSuccessfulLogin(UserName);
      return NextResponse.json(upstreamResult, { status: 200 });
    }

    // Paso 7: Si upstream FAIL
    await recordLoginAttempt({
      username: UserName,
      ip,
      userAgent,
      estado: 'fail',
      escenarioId,
    });
    await evaluateAndApplyBlocks(UserName, ip);

    return NextResponse.json(
      {
        success: false,
        message: upstreamResult.message || 'Usuario o contraseña inválidos',
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
