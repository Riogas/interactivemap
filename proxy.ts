import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { autoRateLimit, detectSuspiciousActivity } from './lib/rate-limit';

/** Logging controlado por ENABLE_MIDDLEWARE_LOGGING env var */
const VERBOSE = process.env.ENABLE_MIDDLEWARE_LOGGING === 'true';
const plog = (...args: unknown[]) => { if (VERBOSE) console.log(...args); };
const pwarn = (...args: unknown[]) => { if (VERBOSE) console.warn(...args); };

/**
 * Proxy/Middleware de Next.js 16
 * Maneja CORS, Rate Limiting y Seguridad
 * RENAMED: middleware -> proxy para Next.js 16 compatibility
 */
export function proxy(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const { pathname, search } = request.nextUrl;
  const fullUrl = pathname + search;

  plog(`\n🌐 ╔${'═'.repeat(78)}╗`);
  plog(`🌐 ║ PROXY/MIDDLEWARE - Request Received`);
  plog(`🌐 ╚${'═'.repeat(78)}╝`);
  plog(`🕐 Timestamp: ${timestamp}`);
  plog(`📍 Method: ${request.method}`);
  plog(`📍 Pathname: ${pathname}`);
  plog(`📍 Search: ${search}`);
  plog(`📍 Full URL: ${fullUrl}`);
  plog(`📍 Origin: ${request.headers.get('origin') || '(none)'}`);
  plog(`📍 Referer: ${request.headers.get('referer') || '(none)'}`);
  plog(`📍 User-Agent: ${request.headers.get('user-agent')?.substring(0, 50) || '(none)'}...`);

  // 🔒 DETECCIÓN DE ACTIVIDAD SOSPECHOSA
  plog(`🔍 Verificando actividad sospechosa...`);
  const isSuspicious = detectSuspiciousActivity(request);
  if (isSuspicious) {
    console.error(`🚨 ¡ACTIVIDAD SOSPECHOSA DETECTADA!`);
    console.error(`🚨 Bloqueando request: ${fullUrl}`);
    return NextResponse.json(
      { success: false, error: 'Solicitud bloqueada', code: 'SUSPICIOUS_ACTIVITY' },
      { status: 403 }
    );
  }
  plog(`✅ Actividad normal - no sospechosa`);

  // 🔒 RATE LIMITING AUTOMÁTICO
  plog(`🚦 Verificando rate limits...`);
  const rateLimitCheck = autoRateLimit(request);
  if (rateLimitCheck instanceof NextResponse) {
    console.warn(`⚠️ Rate limit excedido para: ${fullUrl}`);
    return rateLimitCheck;
  }
  plog(`✅ Rate limit OK`);

  // 📝 LOGGING (solo desarrollo)
  if (VERBOSE && process.env.NODE_ENV === 'development' && pathname.startsWith('/api/')) {
    plog(`📝 [${timestamp}] ${request.method} ${fullUrl}`);
  }

  // 🔒 CORS RESTRICTIVO - Lista Blanca de Orígenes
  plog(`🔒 Configurando CORS...`);
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.ALLOWED_ORIGIN_1,
    process.env.ALLOWED_ORIGIN_2,
    process.env.ALLOWED_ORIGIN_3,
    process.env.ALLOWED_ORIGIN_4,
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'] : []),
  ].filter(Boolean) as string[];

  plog(`🔒 Allowed Origins (${allowedOrigins.length}):`, allowedOrigins);

  const origin = request.headers.get('origin');
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  plog(`🔒 Request Origin: ${origin || '(none)'}`);
  plog(`🔒 Is Allowed: ${isAllowedOrigin}`);

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '3600',
  };

  if (isAllowedOrigin) {
    plog(`✅ Origin permitido - configurando CORS para: ${origin}`);
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  } else if (allowedOrigins.length > 0) {
    plog(`⚠️ Origin no en lista - usando fallback: ${allowedOrigins[0]}`);
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigins[0];
  } else {
    plog('ℹ️ No hay ALLOWED_ORIGINS configurados - usando wildcard (NGINX maneja CORS)');
    corsHeaders['Access-Control-Allow-Origin'] = '*';
  }

  plog(`🔒 CORS Headers configurados:`, corsHeaders);

  // Manejar preflight requests
  if (request.method === 'OPTIONS') {
    plog(`✈️ Preflight request (OPTIONS) - retornando 204`);
    plog(`${'─'.repeat(80)}\n`);
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // Continuar con la request y agregar headers
  plog(`➡️ Continuando al handler de ruta...`);
  const response = NextResponse.next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // 🔒 SECURITY HEADERS
  plog(`🔒 Agregando security headers...`);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  plog(`✅ Security headers agregados`);
  plog(`${'─'.repeat(80)}\n`);

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
