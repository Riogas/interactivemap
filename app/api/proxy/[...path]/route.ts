import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { requireAuth } from '@/lib/auth-middleware';
import { logger, verbose } from '@/lib/logger';
import https from 'https';

/**
 * Proxy seguro para peticiones a la API de GeneXus
 * Ruta: /api/proxy/[...path]
 *
 * SEGURIDAD:
 * - ✅ Requiere autenticación de usuario (Supabase)
 * - ✅ Lista blanca de rutas permitidas
 * - ✅ Solo permite proxy a API_BASE_URL configurada
 * - ✅ Logs sensibles (Authorization, headers, bodies) redactados o gateados
 *      detrás de LOG_VERBOSE=1
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
  // 🔒 AUTENTICACIÓN REQUERIDA (excepto para login)
  const path = pathSegments.join('/');
  const isLoginPath = path === 'gestion/login';

  logger.info('proxy request', { method, path, isLoginPath });
  verbose('proxy request detalle', {
    url: request.url,
    pathSegments,
    bodyUsed: request.bodyUsed,
  });

  if (!isLoginPath) {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      logger.warn('proxy auth falló', { method, path });
      return authResult;
    }
  }

  // 🔒 VALIDAR RUTA CONTRA LISTA BLANCA (SSRF Protection)
  if (!isPathAllowed(path)) {
    logger.warn('proxy ruta no permitida', { path });
    return NextResponse.json(
      { error: 'Ruta no permitida por políticas de seguridad' },
      { status: 403 }
    );
  }

  try {
    // Construir la URL completa
    const url = `${API_BASE_URL}/${path}`;

    // Obtener query parameters
    const searchParams = new URL(request.url).searchParams;
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    verbose('proxy URL construida', { fullUrl, queryString: queryString || null });

    // Construir headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Copiar Authorization header si existe (NO loguear el valor — incluye Bearer token)
    const authHeader = request.headers.get('Authorization');
    const hasAuth = !!authHeader;
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    logger.debug('proxy headers preparados', { method, path, hasAuth });

    // verbose: dump completo de headers entrantes (puede tener cookies/auth)
    if (process.env.LOG_VERBOSE === '1') {
      const incomingHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        incomingHeaders[key] = value;
      });
      verbose('proxy incoming headers', incomingHeaders);
    }

    // NO enviar cookies del navegador - pueden causar conflictos
    // La API parece generar su propio GX_CLIENT_ID
    // const cookieHeader = request.headers.get('Cookie');
    // if (cookieHeader) {
    //   headers['Cookie'] = cookieHeader;
    // }

    // Preparar body para métodos que lo requieren
    let body: string | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        // IMPORTANTE: Clonar el request ANTES de leer el body
        // porque el body original podría haber sido consumido
        const clonedRequest = request.clone();
        const textBody = await clonedRequest.text();

        if (textBody) {
          let parsedKeys: string[] | null = null;
          // Intentar parsear como JSON para logging
          try {
            const requestBody = JSON.parse(textBody) as Record<string, unknown>;
            parsedKeys = Object.keys(requestBody);
            verbose('proxy body parseado', { keys: parsedKeys, body: requestBody });
          } catch {
            logger.warn('proxy body no es JSON válido', { method, path });
          }

          body = textBody;
          logger.debug('proxy body listo', { method, path, length: body.length, keys: parsedKeys });
        } else {
          logger.warn('proxy body vacío', { method, path });
        }
      } catch (e) {
        logger.error('proxy error leyendo body', {
          method,
          path,
          contentType: request.headers.get('content-type'),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    verbose('proxy enviando al backend', { method, fullUrl, headers, body });

    // Hacer la petición con agente HTTPS que ignora certificados
    const fetchStartTime = Date.now();

    // 🔧 TIMEOUT MANUAL: AbortController + setTimeout
    // No podemos usar fetchExternalAPI porque httpsAgent puede ignorar el AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      logger.warn('proxy timeout 30s, abortando', { method, fullUrl });
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
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      const errName = error instanceof Error ? error.name : '';
      if (errName === 'AbortError') {
        logger.error('proxy abortado por timeout 30s', { method, fullUrl });
        throw new Error('Request timeout después de 30 segundos');
      }
      throw error;
    }

    const fetchEndTime = Date.now();
    logger.info('proxy backend respondió', {
      method,
      path,
      status: response.status,
      ok: response.ok,
      durationMs: fetchEndTime - fetchStartTime,
    });

    if (process.env.LOG_VERBOSE === '1') {
      const responseHeaders = Object.fromEntries(response.headers.entries());
      verbose('proxy response headers', responseHeaders);
    }

    // Intentar parsear como JSON
    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
      verbose('proxy response body (json)', data);

      // 🔧 FIX: GeneXus devuelve algunos JSONs anidados como strings
      // Si viene "RespuestaLogin" o cualquier campo que termine en "Respuesta" como string, parsearlo
      if (data.RespuestaLogin && typeof data.RespuestaLogin === 'string') {
        try {
          // GeneXus agrega texto basura después del JSON (ej: "} sgm.glp.riogas.com.uy443...")
          // Truncar en el último '}' para obtener JSON válido
          let rawLogin = data.RespuestaLogin;
          const lastBrace = rawLogin.lastIndexOf('}');
          if (lastBrace !== -1 && lastBrace < rawLogin.length - 1) {
            verbose('proxy truncando texto extra en RespuestaLogin', {
              extra: rawLogin.substring(lastBrace + 1),
            });
            rawLogin = rawLogin.substring(0, lastBrace + 1);
          }
          const parsedLogin = JSON.parse(rawLogin);
          verbose('proxy RespuestaLogin parseado', parsedLogin);
          data = parsedLogin; // Reemplazar con el objeto parseado
        } catch (e) {
          logger.error('proxy error al parsear RespuestaLogin', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else {
      const text = await response.text();
      verbose('proxy response body (text)', { length: text.length, text });

      // Intentar parsear como JSON aunque el Content-Type no lo indique
      try {
        data = JSON.parse(text);
        verbose('proxy response body parsed-from-text', data);
      } catch {
        logger.debug('proxy response no parseable como JSON', { method, path });
        data = { response: text };
      }
    }

    // Copiar cookies de la respuesta si existen
    const setCookieHeader = response.headers.get('set-cookie');
    const responseHeadersToSend: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (setCookieHeader) {
      logger.debug('proxy set-cookie presente', { method, path });
      responseHeadersToSend['Set-Cookie'] = setCookieHeader;
    }

    verbose('proxy retornando al cliente', {
      status: response.status,
      headers: responseHeadersToSend,
      data,
    });

    // Retornar respuesta
    return NextResponse.json(data, {
      status: response.status,
      headers: responseHeadersToSend,
    });
  } catch (error) {
    logger.error('proxy error', {
      method,
      path,
      type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'Error al conectar con el servidor',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    );
  }
}
