import { NextRequest, NextResponse } from 'next/server';

/**
 * API MOCK: POST /api/admin/usuarios-empresa/toggle
 *
 * Gate: usuario con rol "Distribuidor" O isRoot — mismo que GET.
 *
 * Estado actual: MOCK. Devuelve { success: true, mock: true } y loguea la acción.
 *
 * TODO: cuando el endpoint real esté disponible, reemplazar el bloque MOCK
 * (entre los comentarios "--- INICIO MOCK ---" y "--- FIN MOCK ---") por un proxy
 * real similar al GET de /api/admin/usuarios-empresa/route.ts:
 *
 *   const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/toggle-acceso`;
 *   const res = await fetch(upstreamUrl, {
 *     method: 'POST',
 *     headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ username, enabled }),
 *   });
 *   return NextResponse.json(await res.json(), { status: res.status });
 *
 * NOTA: el banner "modo mock" en la UI desaparece automáticamente cuando este
 * endpoint deja de devolver `mock: true` en el response.
 */

function requireDistribuidorOrRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot === 'S') return true;

  const rolesHeader = request.headers.get('x-track-roles');
  if (rolesHeader) {
    try {
      const roles: string[] = JSON.parse(rolesHeader);
      const isDistribuidor = roles.some(
        (r) => String(r).trim() === 'Distribuidor',
      );
      if (isDistribuidor) return true;
    } catch {
      // header malformado — denegamos acceso
    }
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Acceso denegado',
      code: 'REQUIRES_DISTRIBUIDOR_OR_ROOT',
    },
    { status: 403 },
  );
}

export async function POST(request: NextRequest) {
  const gate = requireDistribuidorOrRoot(request);
  if (gate !== true) return gate;

  let body: { username?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body JSON inválido' },
      { status: 400 },
    );
  }

  const { username, enabled } = body;

  if (typeof username !== 'string' || username.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'Campo username requerido' },
      { status: 400 },
    );
  }

  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'Campo enabled (boolean) requerido' },
      { status: 400 },
    );
  }

  const callerUser = request.headers.get('x-track-user') ?? 'unknown';

  // --- INICIO MOCK ---
  // MOCK — sustituir por proxy real cuando esté disponible. URL pendiente.
  // Ver instrucciones en el comentario del archivo (arriba).
  console.log(
    `[toggle MOCK] user=${username} enabled=${enabled} called by ${callerUser}`,
  );

  return NextResponse.json({ success: true, mock: true });
  // --- FIN MOCK ---
}
