import { NextRequest, NextResponse } from 'next/server';
import { logger, verbose } from '@/lib/logger';

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';
const SISTEMA = process.env.LOGIN_SISTEMA || 'GOYA';

export async function POST(request: NextRequest) {
  logger.info('login request iniciado');

  try {
    const body = await request.json();
    const { UserName, Password } = body;

    if (!UserName || !Password) {
      return NextResponse.json(
        { success: false, message: 'UserName y Password son requeridos' },
        { status: 400 }
      );
    }

    // El username es PII; solo se loguea en modo verbose (debug local)
    verbose('login intento de usuario', { username: UserName });

    const res = await fetch(`${SECURITY_SUITE_URL}/api/db/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UserName, Password, Sistema: SISTEMA }),
      signal: AbortSignal.timeout(20000),
    });

    const data = await res.json();
    logger.info('login resultado', {
      success: !!data.success,
      verifiedBy: data.verifiedBy ?? null,
      status: res.status,
    });

    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    logger.error('login error', error);
    return NextResponse.json(
      { success: false, message: 'Error al conectar con el servidor de autenticación' },
      { status: 500 }
    );
  }
}
