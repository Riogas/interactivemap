/**
 * 🚦 SISTEMA DE RATE LIMITING
 * 
 * Previene ataques de fuerza bruta y abuso de la API mediante
 * limitación de peticiones por IP y por endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

/** Logging controlado por ENABLE_MIDDLEWARE_LOGGING env var */
const VERBOSE = process.env.ENABLE_MIDDLEWARE_LOGGING === 'true';
const rlog = (...args: unknown[]) => { if (VERBOSE) console.log(...args); };
const rwarn = (...args: unknown[]) => { if (VERBOSE) console.warn(...args); };

/**
 * Estructura para almacenar intentos de acceso
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
  blockedUntil?: number;
}

/**
 * Almacenamiento en memoria de rate limits
 * En producción, considera usar Redis para aplicaciones distribuidas
 */
const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * 🟢 WHITELIST DE IPS INTERNAS (sin rate limit)
 * 
 * IPs que están exentas de rate limiting (servidores internos de confianza).
 * Útil para:
 * - SGM (servidor de importación masiva)
 * - Servidores internos de la empresa
 * - Scripts automatizados de confianza
 */
const WHITELISTED_IPS = [
  '127.0.0.1',           // Localhost
  '::1',                 // Localhost IPv6
  '192.168.7.13',        // Track server (self)
  '192.168.7.12',        // SGM server (importación masiva)
  // Agregar más IPs internas aquí según sea necesario
];

/**
 * Normalizar IP (convertir IPv6-mapped IPv4 a IPv4)
 * Ejemplo: ::ffff:127.0.0.1 → 127.0.0.1
 */
function normalizeIp(ip: string): string {
  // Detectar y convertir IPv6-mapped IPv4
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7); // Remover "::ffff:" prefix
  }
  
  // IPv6 localhost
  if (ip === '::1') {
    return '127.0.0.1'; // Normalizar a IPv4 localhost
  }
  
  return ip;
}

/**
 * Verificar si una IP está en la whitelist
 */
function isWhitelistedIp(ip: string): boolean {
  // Normalizar IP (::ffff:127.0.0.1 → 127.0.0.1)
  const normalizedIp = normalizeIp(ip);
  
  // Verificar IP exacta
  if (WHITELISTED_IPS.includes(normalizedIp)) {
    return true;
  }
  
  // Verificar rangos de red interna (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  if (normalizedIp.startsWith('192.168.') || normalizedIp.startsWith('10.') || normalizedIp.startsWith('172.')) {
    const segments = normalizedIp.split('.');
    if (segments.length === 4) {
      const second = parseInt(segments[1]);
      // 172.16.0.0 - 172.31.255.255 es rango privado
      if (normalizedIp.startsWith('172.') && second >= 16 && second <= 31) {
        return true;
      }
      // 192.168.x.x y 10.x.x.x son privadas
      return true;
    }
  }
  
  return false;
}

/**
 * Configuraciones de rate limit por tipo de endpoint
 */
export const RATE_LIMIT_CONFIGS = {
  // APIs públicas de lectura (mayor límite)
  public: {
    maxRequests: 100,
    windowMs: 60000, // 1 minuto
    message: 'Demasiadas peticiones. Intenta de nuevo en 1 minuto.',
  },
  
  // APIs de importación/modificación (límite estricto)
  import: {
    maxRequests: 100,    // Aumentado de 20 a 100 para importaciones masivas
    windowMs: 60000,     // 1 minuto
    message: 'Demasiadas peticiones de importación. Intenta de nuevo en 1 minuto.',
  },
  
  // Login (muy estricto para prevenir fuerza bruta)
  auth: {
    maxRequests: 5,
    windowMs: 300000, // 5 minutos
    message: 'Demasiados intentos de login. Intenta de nuevo en 5 minutos.',
    blockDuration: 900000, // 15 minutos de bloqueo tras exceder límite
  },
  
  // Proxy (límite medio)
  proxy: {
    maxRequests: 50,
    windowMs: 60000, // 1 minuto
    message: 'Demasiadas peticiones al proxy. Intenta de nuevo en 1 minuto.',
  },
  
  // General (default)
  default: {
    maxRequests: 60,
    windowMs: 60000, // 1 minuto
    message: 'Demasiadas peticiones. Intenta de nuevo en 1 minuto.',
  },
};

/**
 * Obtener la IP del cliente desde el request
 */
function getClientIp(request: NextRequest): string {
  // Intentar obtener la IP real desde headers de proxy
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for puede contener múltiples IPs, tomamos la primera
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback a un identificador genérico
  return 'unknown';
}

/**
 * Limpiar registros expirados del store (garbage collection)
 */
function cleanupExpiredRecords() {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime && (!record.blockedUntil || now > record.blockedUntil)) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * 🚦 Verificar rate limit para un request
 * 
 * @param request - NextRequest a validar
 * @param type - Tipo de endpoint (determina los límites aplicables)
 * @returns true si está dentro del límite, NextResponse con error 429 si excede
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const rateLimitCheck = checkRateLimit(request, 'public');
 *   if (rateLimitCheck instanceof NextResponse) return rateLimitCheck;
 *   
 *   // ... resto del código
 * }
 * ```
 */
export function checkRateLimit(
  request: NextRequest,
  type: keyof typeof RATE_LIMIT_CONFIGS = 'default'
): true | NextResponse {
  const ip = getClientIp(request);
  const config = RATE_LIMIT_CONFIGS[type];
  const now = Date.now();
  
  rlog(`🚦 checkRateLimit:`);
  rlog(`   - IP: ${ip}`);
  rlog(`   - Type: ${type}`);
  rlog(`   - Config: ${config.maxRequests} req / ${config.windowMs}ms`);
  
  // 🟢 BYPASS: IPs en whitelist no tienen rate limit
  if (isWhitelistedIp(ip)) {
    rlog(`   ✅ IP en whitelist - BYPASS rate limit`);
    return true;
  }
  
  // Generar clave única para este IP + endpoint
  const key = `${ip}:${type}`;
  rlog(`   - Key: ${key}`);
  
  // Limpiar registros antiguos periódicamente
  if (Math.random() < 0.01) { // 1% de probabilidad
    rlog(`   🧹 Limpiando registros expirados...`);
    cleanupExpiredRecords();
  }
  
  const record = rateLimitStore.get(key);
  rlog(`   - Record exists: ${!!record}`);
  if (record) {
    rlog(`   - Record count: ${record.count}`);
    rlog(`   - Record resetTime: ${new Date(record.resetTime).toISOString()}`);
    rlog(`   - Record blockedUntil: ${record.blockedUntil ? new Date(record.blockedUntil).toISOString() : 'none'}`);
  }
  
  // Verificar si la IP está bloqueada
  if (record?.blockedUntil && now < record.blockedUntil) {
    const remainingTime = Math.ceil((record.blockedUntil - now) / 1000);
    rwarn(`🚫 IP bloqueada: ${ip} (${remainingTime}s restantes)`);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Bloqueado temporalmente',
        message: `Has sido bloqueado temporalmente por exceder el límite de peticiones. Intenta de nuevo en ${remainingTime} segundos.`,
        code: 'RATE_LIMIT_BLOCKED',
        retryAfter: remainingTime,
      },
      {
        status: 429,
        headers: {
          'Retry-After': remainingTime.toString(),
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(record.blockedUntil).toISOString(),
        },
      }
    );
  }
  
  // Si no hay registro o la ventana expiró, crear uno nuevo
  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    
    return true;
  }
  
  // Si estamos dentro del límite, incrementar contador
  if (record.count < config.maxRequests) {
    record.count++;
    return true;
  }
  
  // Excedió el límite
  const remainingTime = Math.ceil((record.resetTime - now) / 1000);
  
  // Si el endpoint tiene bloqueo (como auth), bloquear la IP
  if ('blockDuration' in config && config.blockDuration) {
    record.blockedUntil = now + config.blockDuration;
    rwarn(`🚫 IP bloqueada por exceder límite: ${ip} (tipo: ${type})`);
  }
  
  rwarn(`⚠️  Rate limit excedido: ${ip} (tipo: ${type}, intentos: ${record.count})`);
  
  return NextResponse.json(
    {
      success: false,
      error: 'Límite de peticiones excedido',
      message: config.message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: remainingTime,
    },
    {
      status: 429,
      headers: {
        'Retry-After': remainingTime.toString(),
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
      },
    }
  );
}

/**
 * 🔓 Desbloquear una IP manualmente (útil para testing o soporte)
 */
export function unblockIp(ip: string, type?: string) {
  if (type) {
    const key = `${ip}:${type}`;
    rateLimitStore.delete(key);
    rlog(`✅ IP desbloqueada: ${ip} (tipo: ${type})`);
  } else {
    // Desbloquear para todos los tipos
    for (const key of rateLimitStore.keys()) {
      if (key.startsWith(ip + ':')) {
        rateLimitStore.delete(key);
      }
    }
    rlog(`✅ IP desbloqueada: ${ip} (todos los tipos)`);
  }
}

/**
 * 📊 Obtener estadísticas de rate limiting (útil para monitoreo)
 */
export function getRateLimitStats() {
  const stats: Record<string, any> = {
    totalRecords: rateLimitStore.size,
    byType: {} as Record<string, number>,
    blocked: [] as string[],
  };
  
  const now = Date.now();
  
  for (const [key, record] of rateLimitStore.entries()) {
    const [ip, type] = key.split(':');
    
    // Contar por tipo
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    
    // Identificar IPs bloqueadas
    if (record.blockedUntil && now < record.blockedUntil) {
      stats.blocked.push(ip);
    }
  }
  
  return stats;
}

/**
 * 🧹 Limpiar todo el store (útil para testing)
 */
export function clearRateLimitStore() {
  rateLimitStore.clear();
  rlog('🧹 Rate limit store limpiado');
}

/**
 * ⚙️ Middleware helper para aplicar rate limiting automáticamente
 * 
 * Detecta el tipo de endpoint basándose en la URL y aplica
 * el rate limit correspondiente.
 */
export function autoRateLimit(request: NextRequest): true | NextResponse {
  const pathname = request.nextUrl.pathname;
  
  rlog(`🚦 autoRateLimit:`);
  rlog(`   - Pathname: ${pathname}`);
  
  // 🚀 BYPASS para GPS tracking - sin rate limit (muchos móviles reportando)
  if (pathname === '/api/import/gps') {
    rlog(`   - 🚀 GPS Tracking endpoint - SIN RATE LIMIT`);
    return true;
  }
  
  // Determinar tipo basándose en la ruta
  let type: keyof typeof RATE_LIMIT_CONFIGS = 'default';
  
  if (pathname.startsWith('/api/import/')) {
    type = 'import';
    rlog(`   - Tipo detectado: IMPORT`);
  } else if (pathname.includes('/login') || pathname.includes('/auth')) {
    type = 'auth';
    rlog(`   - Tipo detectado: AUTH (login)`);
  } else if (pathname.startsWith('/api/proxy/')) {
    type = 'proxy';
    rlog(`   - Tipo detectado: PROXY`);
  } else if (pathname.startsWith('/api/')) {
    type = 'public';
    rlog(`   - Tipo detectado: PUBLIC`);
  } else {
    rlog(`   - Tipo detectado: DEFAULT`);
  }
  
  const config = RATE_LIMIT_CONFIGS[type];
  rlog(`   - Config: ${config.maxRequests} req / ${config.windowMs}ms`);
  
  const result = checkRateLimit(request, type);
  if (result instanceof NextResponse) {
    rwarn(`   ⚠️ Rate limit excedido!`);
  } else {
    rlog(`   ✅ Rate limit OK`);
  }
  
  return result;
}

/**
 * 📈 Logging de intentos sospechosos
 * 
 * Registra patrones de acceso que podrían indicar un ataque
 */
export function detectSuspiciousActivity(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const pathname = request.nextUrl.pathname;
  
  rlog(`🔍 detectSuspiciousActivity:`);
  rlog(`   - IP: ${ip}`);
  rlog(`   - Pathname: ${pathname}`);
  rlog(`   - User-Agent: ${userAgent.substring(0, 50)}...`);
  
  // Patrones sospechosos
  const suspiciousPatterns = [
    /\.\./,                    // Path traversal
    /etc\/passwd/i,            // Intento de lectura de archivos del sistema
    /wp-admin|wordpress/i,     // Escaneo de WordPress
    /\.env|\.git/i,            // Intento de acceso a archivos sensibles
    /eval\(|exec\(|system\(/i, // Intento de inyección de código
    /<script|javascript:/i,    // XSS
    /union.*select/i,          // SQL Injection
    /\.\.\/|\.\.%2F/i,         // Path traversal URL encoded
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(pathname)) {
      console.error('🚨 ═══════════════════════════════════════════════════════════');
      console.error('🚨 ACTIVIDAD SOSPECHOSA DETECTADA:');
      console.error('🚨 ═══════════════════════════════════════════════════════════');
      console.error('🚨 Timestamp:', new Date().toISOString());
      console.error('🚨 IP:', ip);
      console.error('🚨 User-Agent:', userAgent);
      console.error('🚨 Pathname:', pathname);
      console.error('🚨 Pattern matched:', pattern.source);
      console.error('🚨 ═══════════════════════════════════════════════════════════');
      
      // Aquí podrías integrar con un sistema de alertas
      // como Sentry, Discord webhook, email, etc.
      
      return true; // Actividad sospechosa detectada
    }
  }
  
  rlog(`   ✅ No se detectó actividad sospechosa`);
  return false;
}
