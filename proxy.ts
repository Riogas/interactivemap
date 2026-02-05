import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { autoRateLimit, detectSuspiciousActivity } from './lib/rate-limit';

/**
 * Proxy/Middleware de Next.js 16
 * Maneja CORS, Rate Limiting y Seguridad
 * RENAMED: middleware -> proxy para Next.js 16 compatibility
 */
export function proxy(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const { pathname, search } = request.nextUrl;
  const fullUrl = pathname + search;

  console.log(`\n🌐 ╔${'═'.repeat(78)}╗`);
  console.log(`🌐 ║ PROXY/MIDDLEWARE - Request Received`);
  console.log(`🌐 ╚${'═'.repeat(78)}╝`);
  console.log(`🕐 Timestamp: ${timestamp}`);
  console.log(`📍 Method: ${request.method}`);
  console.log(`📍 Pathname: ${pathname}`);
  console.log(`📍 Search: ${search}`);
  console.log(`📍 Full URL: ${fullUrl}`);
  console.log(`📍 Origin: ${request.headers.get('origin') || '(none)'}`);
  console.log(`📍 Referer: ${request.headers.get('referer') || '(none)'}`);
  console.log(`📍 User-Agent: ${request.headers.get('user-agent')?.substring(0, 50) || '(none)'}...`);

  // 🔒 DETECCIÓN DE ACTIVIDAD SOSPECHOSA
  console.log(`🔍 Verificando actividad sospechosa...`);
  const isSuspicious = detectSuspiciousActivity(request);
  if (isSuspicious) {
    console.error(`🚨 ¡ACTIVIDAD SOSPECHOSA DETECTADA!`);
    console.error(`🚨 Bloqueando request: ${fullUrl}`);
    return NextResponse.json(
      { success: false, error: 'Solicitud bloqueada', code: 'SUSPICIOUS_ACTIVITY' },
      { status: 403 }
    );
  }
  console.log(`✅ Actividad normal - no sospechosa`);

  // 🔒 RATE LIMITING AUTOMÁTICO
  console.log(`🚦 Verificando rate limits...`);
  const rateLimitCheck = autoRateLimit(request);
  if (rateLimitCheck instanceof NextResponse) {
    console.warn(`⚠️ Rate limit excedido para: ${fullUrl}`);
    return rateLimitCheck;
  }
  console.log(`✅ Rate limit OK`);

  // 📝 LOGGING (solo desarrollo)
  if (process.env.NODE_ENV === 'development' && pathname.startsWith('/api/')) {
    console.log(`📝 [${timestamp}] ${request.method} ${fullUrl}`);
  }

  // 🔒 CORS RESTRICTIVO - Lista Blanca de Orígenes
  console.log(`🔒 Configurando CORS...`);
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.ALLOWED_ORIGIN_1,
    process.env.ALLOWED_ORIGIN_2,
    process.env.ALLOWED_ORIGIN_3,
    process.env.ALLOWED_ORIGIN_4,
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'] : []),
  ].filter(Boolean) as string[];

  console.log(`🔒 Allowed Origins (${allowedOrigins.length}):`, allowedOrigins);

  const origin = request.headers.get('origin');
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  console.log(`🔒 Request Origin: ${origin || '(none)'}`);
  console.log(`🔒 Is Allowed: ${isAllowedOrigin}`);

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '3600',
  };

  if (isAllowedOrigin) {
    console.log(`✅ Origin permitido - configurando CORS para: ${origin}`);
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  } else if (allowedOrigins.length > 0) {
    // Usar el primer origen como fallback
    console.log(`⚠️ Origin no en lista - usando fallback: ${allowedOrigins[0]}`);
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigins[0];
  } else {
    // En producción con NGINX, no necesitamos configurar ALLOWED_ORIGINS
    // NGINX maneja el CORS correctamente
    console.log('ℹ️ No hay ALLOWED_ORIGINS configurados - usando wildcard (NGINX maneja CORS)');
    corsHeaders['Access-Control-Allow-Origin'] = '*';
  }

  console.log(`🔒 CORS Headers configurados:`, corsHeaders);

  // Manejar preflight requests
  if (request.method === 'OPTIONS') {
    console.log(`✈️ Preflight request (OPTIONS) - retornando 204`);
    console.log(`${'─'.repeat(80)}\n`);
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // Continuar con la request y agregar headers
  console.log(`➡️ Continuando al handler de ruta...`);
  const response = NextResponse.next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // 🔒 SECURITY HEADERS
  console.log(`🔒 Agregando security headers...`);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  console.log(`✅ Security headers agregados`);
  console.log(`${'─'.repeat(80)}\n`);

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
