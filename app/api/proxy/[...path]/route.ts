import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { requireAuth } from '@/lib/auth-middleware';
import https from 'https';

/**
 * Proxy seguro para peticiones a la API de GeneXus
 * Ruta: /api/proxy/[...path]
 * 
 * SEGURIDAD:
 * - ✅ Requiere autenticación de usuario (Supabase)
 * - ✅ Lista blanca de rutas permitidas
 * - ✅ Solo permite proxy a API_BASE_URL configurada
 * 
 * Ejemplos:
 * - POST /api/proxy/gestion/login
 * - GET /api/proxy/gestion/moviles
 * - PUT /api/proxy/gestion/moviles/123
 */

// 🔒 LISTA BLANCA DE RUTAS PERMITIDAS (SSRF Protection)
const ALLOWED_PATHS = [
  /^gestion\/login$/,
  /^gestion\/moviles$/,
  /^gestion\/moviles\/\d+$/,
  /^gestion\/pedidos$/,
  /^gestion\/pedidos\/\d+$/,
  /^gestion\/zonas$/,
  /^gestion\/puntoventa$/,
  /^gestion\/empresas$/,
  /^gestion\/demoras$/,
  /^gestion\/servicios$/,
  /^gestion\/servicios\/\d+$/,
  /^gestion\/user-atributos$/,
  /^gestion\/user-atributos\/\d+$/,
];

// Agente HTTPS que ignora errores de certificado SSL
// NOTA: Solo para certificados auto-firmados internos de la API de gestión
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? false : true
});

/**
 * Validar que la ruta solicitada esté en la lista blanca
 */
function isPathAllowed(path: string): boolean {
  return ALLOWED_PATHS.some(pattern => pattern.test(path));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path, 'POST');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path, 'DELETE');
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path, 'PATCH');
}

async function proxyRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string
) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 PROXY REQUEST INICIADO`);
  console.log(`${'='.repeat(80)}`);
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
  console.log(`📍 Method: ${method}`);
  console.log(`📍 Path Segments:`, pathSegments);
  console.log(`📍 Full URL: ${request.url}`);
  
  // 🔍 DEBUG: Verificar si el body está disponible INMEDIATAMENTE
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    console.log(`🔍 DEBUG: Verificando disponibilidad de body...`);
    console.log(`🔍 DEBUG: request.body:`, request.body);
    console.log(`🔍 DEBUG: request.bodyUsed:`, request.bodyUsed);
  }
  
  // 🔒 AUTENTICACIÓN REQUERIDA (excepto para login)
  const path = pathSegments.join('/');
  console.log(`📍 Joined Path: ${path}`);
  
  const isLoginPath = path === 'gestion/login';
  console.log(`🔐 Is Login Path: ${isLoginPath}`);
  
  if (!isLoginPath) {
    console.log(`🔐 Requiriendo autenticación (no es login)...`);
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      console.log(`❌ Autenticación falló - retornando respuesta de auth`);
      return authResult;
    }
    console.log(`✅ Autenticación exitosa`);
  } else {
    console.log(`⚠️ SALTANDO autenticación (es login path)`);
  }

  // 🔒 VALIDAR RUTA CONTRA LISTA BLANCA (SSRF Protection)
  console.log(`🔍 Validando ruta contra lista blanca...`);
  if (!isPathAllowed(path)) {
    console.error(`🚫 Ruta no permitida: ${path}`);
    console.error(`🚫 ALLOWED_PATHS:`, ALLOWED_PATHS);
    return NextResponse.json(
      { error: 'Ruta no permitida por políticas de seguridad' },
      { status: 403 }
    );
  }
  console.log(`✅ Ruta permitida`);

  try {
    // Construir la URL completa
    const url = `${API_BASE_URL}/${path}`;
    console.log(`🌐 Base URL: ${API_BASE_URL}`);
    console.log(`🌐 Constructed URL: ${url}`);

    // Obtener query parameters
    const searchParams = new URL(request.url).searchParams;
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    console.log(`🌐 Query String: ${queryString || '(none)'}`);
    console.log(`🌐 Full URL: ${fullUrl}`);

    // Construir headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Copiar Authorization header si existe
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      console.log(`🔑 Authorization header encontrado: ${authHeader.substring(0, 20)}...`);
      headers['Authorization'] = authHeader;
    } else {
      console.log(`⚠️ No Authorization header`);
    }

    // Log de todos los headers de entrada
    console.log(`📥 Request Headers (incoming):`);
    request.headers.forEach((value, key) => {
      if (key.toLowerCase().includes('content') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('cookie')) {
        console.log(`   ${key}: ${value}`);
      }
    });

    // NO enviar cookies del navegador - pueden causar conflictos
    // La API parece generar su propio GX_CLIENT_ID
    // const cookieHeader = request.headers.get('Cookie');
    // if (cookieHeader) {
    //   headers['Cookie'] = cookieHeader;
    // }

    // Preparar body para métodos que lo requieren
    let body: string | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      console.log(`📦 Método requiere body (${method})`);
      try {
        // IMPORTANTE: Clonar el request ANTES de leer el body
        // porque el body original podría haber sido consumido
        const clonedRequest = request.clone();
        const textBody = await clonedRequest.text();
        console.log(`📦 Body leído como texto (${textBody.length} chars):`, textBody.substring(0, 200));
        
        if (textBody) {
          // Intentar parsear como JSON para logging
          try {
            const requestBody = JSON.parse(textBody);
            console.log(`📦 Body parseado exitosamente:`);
            console.log(`   - Type: ${typeof requestBody}`);
            console.log(`   - Keys: [${Object.keys(requestBody).join(', ')}]`);
            console.log(`   - Values:`, requestBody);
          } catch (_parseError) {
            console.warn(`⚠️ Body no es JSON válido, enviando como texto`);
          }
          
          body = textBody;
          console.log(`📦 Body listo para enviar (${body.length} chars)`);
        } else {
          console.warn(`⚠️ Body vacío en request ${method}`);
        }
      } catch (e) {
        console.error(`❌ Error leyendo body:`, e);
        console.error(`   - Content-Type: ${request.headers.get('content-type')}`);
        console.error(`   - Request method: ${request.method}`);
      }
    } else {
      console.log(`📦 Método no requiere body (${method})`);
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`🔄 Enviando request al backend...`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`📤 Method: ${method}`);
    console.log(`📤 URL: ${fullUrl}`);
    console.log(`📤 Headers:`, headers);
    if (body) {
      console.log(`📤 Body (${body.length} chars):`, body);
    }

    // Hacer la petición con agente HTTPS que ignora certificados
    console.log(`🚀 Ejecutando fetch...`);
    const fetchStartTime = Date.now();
    
    // 🔧 TIMEOUT MANUAL: AbortController + setTimeout
    // No podemos usar fetchExternalAPI porque httpsAgent puede ignorar el AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏰ TIMEOUT después de 30 segundos - abortando request`);
      controller.abort();
    }, 30000); // 30 segundos
    
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method,
        headers,
        body,
        credentials: 'include',
        signal: controller.signal,
        // @ts-expect-error - Node.js fetch acepta agent
        agent: fullUrl.startsWith('https:') ? httpsAgent : undefined,
      });
      clearTimeout(timeoutId);
      console.log(`✅ Fetch exitoso - limpiando timeout`);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error(`❌ Request abortado por timeout (30s)`);
        throw new Error('Request timeout después de 30 segundos');
      }
      throw error;
    }

    const fetchEndTime = Date.now();
    console.log(`✅ Fetch completado en ${fetchEndTime - fetchStartTime}ms`);
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📥 RESPUESTA DEL BACKEND`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`📥 Status: ${response.status} ${response.statusText}`);
    console.log(`📥 OK: ${response.ok}`);
    console.log(`📥 Type: ${response.type}`);
    console.log(`📥 URL: ${response.url}`);
    console.log(`📥 Redirected: ${response.redirected}`);
    
    console.log(`📥 Response Headers:`);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    Object.entries(responseHeaders).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });

    // Intentar parsear como JSON
    let data;
    const contentType = response.headers.get('content-type');
    console.log(`📥 Content-Type: ${contentType}`);
    
    if (contentType && contentType.includes('application/json')) {
      console.log(`📥 Parseando como JSON...`);
      data = await response.json();
      console.log(`📥 Response Data (parsed JSON):`, JSON.stringify(data, null, 2));
      
      // 🔧 FIX: GeneXus devuelve algunos JSONs anidados como strings
      // Si viene "RespuestaLogin" o cualquier campo que termine en "Respuesta" como string, parsearlo
      if (data.RespuestaLogin && typeof data.RespuestaLogin === 'string') {
        try {
          // GeneXus agrega texto basura después del JSON (ej: "} sgm.glp.riogas.com.uy443...")
          // Truncar en el último '}' para obtener JSON válido
          let rawLogin = data.RespuestaLogin;
          const lastBrace = rawLogin.lastIndexOf('}');
          if (lastBrace !== -1 && lastBrace < rawLogin.length - 1) {
            console.log('🔧 Truncando texto extra después del JSON:', rawLogin.substring(lastBrace + 1));
            rawLogin = rawLogin.substring(0, lastBrace + 1);
          }
          const parsedLogin = JSON.parse(rawLogin);
          console.log('🔄 RespuestaLogin parseado:', parsedLogin);
          data = parsedLogin; // Reemplazar con el objeto parseado
        } catch (e) {
          console.error('❌ Error al parsear RespuestaLogin:', e);
        }
      }
    } else {
      console.log(`📥 Leyendo como texto (no es JSON)...`);
      const text = await response.text();
      console.log(`📥 Response Text (${text.length} chars):`, text.substring(0, 500));
      
      // Intentar parsear como JSON aunque el Content-Type no lo indique
      try {
        data = JSON.parse(text);
        console.log(`📥 Parsed as JSON:`, JSON.stringify(data, null, 2));
      } catch {
        console.log(`⚠️ No se pudo parsear como JSON`);
        data = { response: text };
      }
    }

    // Copiar cookies de la respuesta si existen
    const setCookieHeader = response.headers.get('set-cookie');
    const responseHeadersToSend: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (setCookieHeader) {
      console.log(`🍪 Set-Cookie header encontrado: ${setCookieHeader.substring(0, 50)}...`);
      responseHeadersToSend['Set-Cookie'] = setCookieHeader;
    } else {
      console.log(`⚠️ No Set-Cookie header en respuesta`);
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📤 RETORNANDO AL CLIENTE`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`📤 Status: ${response.status}`);
    console.log(`📤 Headers:`, responseHeadersToSend);
    console.log(`📤 Data:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    console.log(`${'='.repeat(80)}\n`);

    // Retornar respuesta
    return NextResponse.json(data, { 
      status: response.status,
      headers: responseHeadersToSend,
    });
  } catch (error) {
    console.error(`\n${'!'.repeat(80)}`);
    console.error(`❌ ERROR EN PROXY`);
    console.error(`${'!'.repeat(80)}`);
    console.error(`❌ Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`❌ Error message:`, error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(`❌ Stack trace:`, error.stack);
    }
    console.error(`${'!'.repeat(80)}\n`);
    
    return NextResponse.json(
      { 
        error: 'Error al conectar con el servidor',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    );
  }
}
