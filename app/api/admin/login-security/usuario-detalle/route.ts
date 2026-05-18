import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/admin/login-security/usuario-detalle?username=X
 *
 * Proxy al endpoint del SecuritySuite para obtener datos de un usuario por username.
 * Gate: header x-track-isroot: 'S'
 *
 * ESTADO: El SecuritySuite no expone un endpoint GET /api/db/usuarios/por-username
 * (solo existen /por-empresa-fletera y /{userId}/permite-login).
 * Hasta que ese endpoint esté disponible, este route devuelve 501 NOT_IMPLEMENTED.
 * El cliente muestra "Detalle no disponible (endpoint upstream pendiente)" sin crashear.
 *
 * Cuando el SecuritySuite exponga el endpoint, descomentar la implementación
 * real en la sección marcada con TODO y eliminar el bloque 501.
 *
 * Blocker documentado: SecuritySuite necesita implementar
 *   GET /api/db/usuarios/por-username?username=X
 * que devuelva { id, username, nombre, apellido, email, telefono, estado,
 *                tipoUsuario, esExterno, fechaCreacion, fechaUltimoLogin, empFletera, ... }
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';
// Suprimir warning de variable no usada hasta que se implemente la llamada real
void SECURITY_SUITE_URL;

function requireRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot !== 'S') {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NOT_ROOT' },
      { status: 403 }
    );
  }
  return true;
}

export async function GET(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  const url = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username || username.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'Parámetro username es requerido', code: 'MISSING_PARAM' },
      { status: 400 }
    );
  }

  // 501 — endpoint upstream pendiente de implementación en SecuritySuite
  return NextResponse.json(
    {
      success: false,
      error: 'Detalle no disponible (endpoint upstream pendiente)',
      code: 'UPSTREAM_NOT_IMPLEMENTED',
      detail:
        'El SecuritySuite aún no expone GET /api/db/usuarios/por-username. ' +
        'Implementar ese endpoint en SecuritySuite y actualizar este proxy.',
      username: username.trim(),
    },
    { status: 501 }
  );

  // TODO: cuando SecuritySuite implemente GET /api/db/usuarios/por-username,
  // reemplazar el bloque 501 de arriba con:
  //
  // const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/por-username?username=${encodeURIComponent(username.trim())}`;
  // const token = request.headers.get('Authorization') ?? '';
  // try {
  //   const res = await fetch(upstreamUrl, {
  //     headers: { Authorization: token, 'Content-Type': 'application/json' },
  //     signal: AbortSignal.timeout(8000),
  //   });
  //   if (!res.ok) {
  //     const errBody = await res.json().catch(() => ({}));
  //     return NextResponse.json(
  //       { success: false, error: errBody.error || `Error upstream: ${res.status}`, code: 'UPSTREAM_ERROR' },
  //       { status: res.status }
  //     );
  //   }
  //   const data = await res.json();
  //   return NextResponse.json({ success: true, usuario: data.usuario ?? data });
  // } catch (err) {
  //   console.error('[usuario-detalle] upstream fetch error:', err);
  //   return NextResponse.json(
  //     { success: false, error: 'Error al conectar con SecuritySuite', code: 'UPSTREAM_UNREACHABLE' },
  //     { status: 502 }
  //   );
  // }
}
