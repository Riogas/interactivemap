import { NextRequest, NextResponse } from 'next/server';

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';
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

    const res = await fetch(`${SECURITY_SUITE_URL}/api/db/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UserName, Password, Sistema: SISTEMA }),
      signal: AbortSignal.timeout(20000),
    });

    const data = await res.json();
    console.log(
      `${data.success ? '✅' : '❌'} [SecuritySuite] Login ${data.success ? 'exitoso' : 'fallido'} para: ${UserName}` +
      (data.verifiedBy ? ` (via ${data.verifiedBy})` : '')
    );

    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('❌ [/api/auth/login] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Error al conectar con el servidor de autenticación' },
      { status: 500 }
    );
  }
}
