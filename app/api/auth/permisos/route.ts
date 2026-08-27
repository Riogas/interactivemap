import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizationHeader } from '@/lib/api-auth-gates';
import { HEADER_AUTH_GUARD } from '@/lib/securitysuite-guard';

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
 *   503 — dos casos DISTINTOS, y por eso se reenvía el header `x-auth-guard`:
 *         · SECRETO_NO_CONFIGURADO → falta el secreto de firma. Permanente:
 *           re-loguearse no arregla nada.
 *         · ERROR_GUARD → el guard falló (p.ej. Postgres no contesta).
 *           Transitorio: el cliente degrada y reintenta.
 *         Sin ese header el cliente no puede distinguirlos, porque secapi manda
 *         en el body prosa para humanos, NO el código (ver
 *         lib/securitysuite-guard.ts).
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
    // Reenviar el código del guard: es el ÚNICO lugar donde viaja (el body trae
    // el mensaje traducido para humanos). Sin esto, el cliente no puede separar
    // "falta el secreto" (permanente) de "el guard se cayó" (transitorio).
    const codigoGuard = res.headers.get(HEADER_AUTH_GUARD);
    return NextResponse.json(data ?? { error: 'Respuesta ilegible del SecuritySuite' }, {
      status: res.status,
      ...(codigoGuard ? { headers: { [HEADER_AUTH_GUARD]: codigoGuard } } : {}),
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
