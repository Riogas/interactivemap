import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';
import { fetchExternalAPI } from '@/lib/fetch-with-timeout';
import https from 'https';

// Agente HTTPS que ignora errores de certificado SSL
// NOTA: Solo para desarrollo o certificados auto-firmados internos
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('🔐 Login Request');
    console.log('📤 Body:', body);

    const loginUrl = `${API_BASE_URL}/gestion/login`;
    
    // 🔧 TIMEOUT + REINTENTOS: fetchExternalAPI usa 30s timeout y 2 reintentos
    const response = await fetchExternalAPI(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'include', // Importante para cookies
      // @ts-ignore - Node.js fetch acepta agent
      agent: loginUrl.startsWith('https:') ? httpsAgent : undefined,
    });

    console.log('📥 Login Response Status:', response.status);

    // Intentar parsear como JSON
    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
      console.log('📥 Login Response Data:', data);
    } else {
      const text = await response.text();
      console.log('📥 Login Response Text:', text);
      data = { response: text };
    }

    // Copiar cookies de la respuesta si existen
    const setCookieHeader = response.headers.get('set-cookie');
    const responseHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (setCookieHeader) {
      console.log('🍪 Set-Cookie:', setCookieHeader);
      responseHeaders['Set-Cookie'] = setCookieHeader;
    }

    return NextResponse.json(data, { 
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('❌ Error en proxy de login:', error);
    return NextResponse.json(
      { 
        error: 'Error al conectar con el servidor',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    );
  }
}
