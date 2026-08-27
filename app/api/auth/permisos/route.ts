import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizationHeader } from '@/lib/api-auth-gates';

/**
 * API: POST /api/auth/permisos
 *
 * Proxy a POST ${SECURITY_SUITE_URL}/api/db/permisos con el token del usuario.
 *
 * Contrato con el cliente (contexts/AuthContext.tsx → fetchPermisos): el STATUS
 * es lo que distingue "no tenés permisos" de "no tenés sesión". Por eso:
 *   401 — sin token propio, o token rechazado por el SecuritySuite
 *         (TOKEN_INVALIDO / TOKEN_VENCIDO / SIN_TOKEN / USUARIO_NO_ENCONTRADO).
 *         El cliente cierra la sesión y manda al login.
 *   503 — el SecuritySuite no tiene configurado el secreto de firma
 *         (SECRETO_NO_CONFIGURADO). Re-loguearse no arregla nada.
 *   502 — no se pudo contactar al SecuritySuite (red). El cliente degrada sin
 *         romper la sesión: un kiosko sin conectividad no debe desloguearse.
 * El status del upstream se pasa tal cual; nunca colapsar todo a 500, porque el
 * cliente pierde la única señal que tiene para diferenciar los casos.
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const auth = requireAuthorizationHeader(request);
  if (typeof auth !== 'string') return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Body JSON inválido', code: 'BODY_INVALIDO' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${SECURITY_SUITE_URL}/api/db/permisos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? { error: 'Respuesta ilegible del SecuritySuite' }, {
      status: res.status,
    });
  } catch (error) {
    // Falla de RED contra el SecuritySuite. 502 (no 500) para que el cliente lo
    // lea como "no llegué a preguntar", distinto de "me dijeron que no".
    console.error('Error en proxy permisos:', error);
    return NextResponse.json(
      { error: 'Error al consultar permisos', code: 'UPSTREAM_UNREACHABLE' },
      { status: 502 },
    );
  }
}
