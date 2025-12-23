import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware para CORS y logging detallado
 * Permite peticiones desde GeneXus y otros orígenes externos
 */
export function middleware(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const { pathname, search } = request.nextUrl;
  const fullUrl = pathname + search;

  // Log detallado de TODAS las peticiones a /api/
  if (pathname.startsWith('/api/')) {
    console.log('\n' + '━'.repeat(80));
    console.log(`🌐 MIDDLEWARE [${timestamp}]`);
    console.log('━'.repeat(80));
    console.log('📍 URL:', fullUrl);
    console.log('🔧 Método:', request.method);
    console.log('🌍 Origin:', request.headers.get('origin') || 'NO ORIGIN');
    console.log('📱 User-Agent:', request.headers.get('user-agent') || 'NO USER-AGENT');
    console.log('📦 Content-Type:', request.headers.get('content-type') || 'NO CONTENT-TYPE');
    console.log('🔑 Authorization:', request.headers.get('authorization') ? '***PRESENTE***' : 'NO');
    
    // Log de headers completos (útil para debugging CORS)
    if (process.env.NODE_ENV === 'development') {
      console.log('\n� Headers completos:');
      request.headers.forEach((value, key) => {
        console.log(`  ${key}: ${value}`);
      });
    }
    console.log('━'.repeat(80) + '\n');
  }

  // Headers CORS permisivos para APIs de importación
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // En producción, especifica el dominio de GeneXus
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 
      'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-API-Key, User-Agent',
    'Access-Control-Max-Age': '86400', // 24 horas
    'Access-Control-Allow-Credentials': 'true',
  };

  // Responder a OPTIONS (preflight)
  if (request.method === 'OPTIONS') {
    console.log('✅ Respondiendo a preflight OPTIONS con CORS headers');
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Continuar con la petición normal pero agregar headers CORS
  const response = NextResponse.next();
  
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Configuración: aplicar middleware solo a rutas de API
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/api/import/:path*',
  ],
};
