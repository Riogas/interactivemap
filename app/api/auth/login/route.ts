import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/login
 * 
 * Proxy de login hacia la nueva API de seguridad de Riogas.
 * Endpoint: https://secapi.riogas.com.uy/api/db/login
 * 
 * Recibe: { UserName, Password }
 * Envía:  { UserName, Password, Sistema: "GOYA" }
 */

const LOGIN_API_URL = process.env.LOGIN_API_URL || 'https://secapi.riogas.com.uy/api/db/login';
const SISTEMA = process.env.LOGIN_SISTEMA || 'GOYA';

export async function POST(request: NextRequest) {
  console.log('🔐 [/api/auth/login] Iniciando login...');

  try {
    const body = await request.json();
    const { UserName, Password } = body;

    if (!UserName || !Password) {
      return NextResponse.json(
        { success: false, message: 'UserName y Password son requeridos' },
        { status: 400 }
      );
    }

    console.log(`🔐 [/api/auth/login] Usuario: ${UserName}`);
    console.log(`🔐 [/api/auth/login] Endpoint: ${LOGIN_API_URL}`);

    const response = await fetch(LOGIN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        UserName,
        Password,
        Sistema: SISTEMA,
      }),
    });

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        console.error('❌ [/api/auth/login] Respuesta no es JSON:', text.substring(0, 200));
        return NextResponse.json(
          { success: false, message: 'Respuesta inesperada del servidor de autenticación' },
          { status: 502 }
        );
      }
    }

    console.log(`🔐 [/api/auth/login] Status: ${response.status}`);
    console.log(`🔐 [/api/auth/login] Response:`, JSON.stringify(data, null, 2));

    // Si la API devuelve RespuestaLogin como string (formato GeneXus legacy), parsearlo
    if (data.RespuestaLogin && typeof data.RespuestaLogin === 'string') {
      try {
        let rawLogin = data.RespuestaLogin;
        const lastBrace = rawLogin.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace < rawLogin.length - 1) {
          rawLogin = rawLogin.substring(0, lastBrace + 1);
        }
        data = JSON.parse(rawLogin);
        console.log('🔄 [/api/auth/login] RespuestaLogin parseado');
      } catch (e) {
        console.error('❌ [/api/auth/login] Error parseando RespuestaLogin:', e);
      }
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ [/api/auth/login] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Error al conectar con el servidor de autenticación',
        details: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}
