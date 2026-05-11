import { NextRequest } from 'next/server';
import { runLoginSecurity } from '@/lib/login-security';

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';
const SISTEMA = process.env.LOGIN_SISTEMA || 'GOYA';

export async function POST(request: NextRequest) {
  console.log('🔐 [/api/auth/login] Iniciando login...');

  return runLoginSecurity(request, async (body) => {
    const { UserName, Password } = body;
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

    return { success: data.success, ...data };
  });
}
