import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('🔐 Login Request');
    console.log('📤 Body:', body);

    const response = await fetch(`${API_BASE_URL}/puestos/gestion/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'include', // Importante para cookies
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
