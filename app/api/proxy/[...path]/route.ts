import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import https from 'https';

/**
 * Proxy genérico para todas las peticiones a la API
 * Ruta: /api/proxy/[...path]
 * 
 * Ejemplos:
 * - POST /api/proxy/gestion/login
 * - GET /api/proxy/gestion/moviles
 * - PUT /api/proxy/gestion/moviles/123
 */

// Agente HTTPS que ignora errores de certificado SSL
// NOTA: Solo para desarrollo o certificados auto-firmados internos
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

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
  try {
    // Construir la URL completa
    const path = pathSegments.join('/');
    const url = `${API_BASE_URL}/${path}`;

    // Obtener query parameters
    const searchParams = new URL(request.url).searchParams;
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    // Construir headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Copiar Authorization header si existe
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
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
        const requestBody = await request.json();
        body = JSON.stringify(requestBody);
      } catch {
        // No hay body o no es JSON
      }
    }

    console.log(`🔄 Proxy ${method} ${fullUrl}`);
    console.log(`📤 Headers:`, headers);
    if (body) {
      console.log(`📤 Body:`, body);
    }

    // Hacer la petición con agente HTTPS que ignora certificados
    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
      credentials: 'include', // Importante para cookies
      // @ts-ignore - Node.js fetch acepta agent
      agent: fullUrl.startsWith('https:') ? httpsAgent : undefined,
    });

    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📥 Response Headers:`, Object.fromEntries(response.headers.entries()));

    // Intentar parsear como JSON
    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
      console.log(`📥 Response Data:`, JSON.stringify(data, null, 2));
    } else {
      const text = await response.text();
      console.log(`📥 Response Text:`, text);
      
      // Intentar parsear como JSON aunque el Content-Type no lo indique
      try {
        data = JSON.parse(text);
        console.log(`📥 Parsed as JSON:`, JSON.stringify(data, null, 2));
      } catch {
        data = { response: text };
      }
    }

    // Copiar cookies de la respuesta si existen
    const setCookieHeader = response.headers.get('set-cookie');
    const responseHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (setCookieHeader) {
      responseHeaders['Set-Cookie'] = setCookieHeader;
    }

    // Retornar respuesta
    return NextResponse.json(data, { 
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('❌ Error en proxy:', error);
    return NextResponse.json(
      { 
        error: 'Error al conectar con el servidor',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    );
  }
}
