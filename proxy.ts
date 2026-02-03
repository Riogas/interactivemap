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

  // 🔒 DETECCIÓN DE ACTIVIDAD SOSPECHOSA
  const isSuspicious = detectSuspiciousActivity(request);
  if (isSuspicious) {
    return NextResponse.json(
      { success: false, error: 'Solicitud bloqueada', code: 'SUSPICIOUS_ACTIVITY' },
      { status: 403 }
    );
  }

  // 🔒 RATE LIMITING AUTOMÁTICO
  const rateLimitCheck = autoRateLimit(request);
  if (rateLimitCheck instanceof NextResponse) {
    return rateLimitCheck;
  }

  // 📝 LOGGING (solo desarrollo)
  if (process.env.NODE_ENV === 'development' && pathname.startsWith('/api/')) {
    console.log(`[${timestamp}] ${request.method} ${fullUrl}`);
  }

  // 🔒 CORS RESTRICTIVO - Lista Blanca de Orígenes
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.ALLOWED_ORIGIN_1,
    process.env.ALLOWED_ORIGIN_2,
    process.env.ALLOWED_ORIGIN_3,
    process.env.ALLOWED_ORIGIN_4,
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'] : []),
  ].filter(Boolean) as string[];

  const origin = request.headers.get('origin');
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '3600',
  };

  if (isAllowedOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
  } else if (allowedOrigins.length > 0) {
    // Usar el primer origen como fallback
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigins[0];
  } else {
    console.warn('⚠️ No hay ALLOWED_ORIGINS configurados - usando wildcard (*)');
    corsHeaders['Access-Control-Allow-Origin'] = '*';
  }

  // Manejar preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // Continuar con la request y agregar headers
  const response = NextResponse.next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // 🔒 SECURITY HEADERS
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
