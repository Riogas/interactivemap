import { NextRequest, NextResponse } from 'next/server';
import {
  describirErrorUpstream,
  requireAuthorizationHeader,
  requireFuncionalidad,
} from '@/lib/api-auth-gates';
import { HEADER_AUTH_GUARD } from '@/lib/securitysuite-guard';

/**
 * GET /api/admin/login-security/usuario-detalle?username=X
 *
 * Proxy al endpoint del SecuritySuite que devuelve datos del usuario por username.
 * Gate: funcionalidad 'Query Inicios de sesion'
 *
 * Spec del upstream (SecuritySuite):
 *   GET /api/db/usuarios/por-username?username=jperez
 *   200 — { success: true, item: { id, username, email, nombre, apellido,
 *                                  estado, telefono, tipoUsuario, esRoot, ... } }
 *   400 — falta username
 *   404 — username no existe
 *   500 — error de DB
 *
 * El match es exacto (columna username UNIQUE). Forwardea el token del usuario
 * para que SecuritySuite haga su propio gate de permisos.
 *
 * Forma de respuesta de este proxy hacia el cliente:
 *   200 — { success: true, usuario: <item del upstream> }
 *   400 — { success: false, error: 'Parámetro username requerido' }
 *   401 — { success: false, code: 'SIN_SESION' | 'SESION_INVALIDA' } (sin token
 *         propio, o token rechazado por el SecuritySuite)
 *   403 — { success: false, error: 'Acceso denegado' }
 *   404 — { success: false, error: 'Usuario no encontrado', detail: <upstream> }
 *   502 — { success: false, error: 'Error al conectar con SecuritySuite' }
 *   <other> — passthrough del status code del upstream con detail.
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  // Sesión primero: mismo criterio que /api/admin/usuarios-empresa. Sin token
  // el header vacío se forwardeaba al SecuritySuite y su 401 volvía como
  // "Error del servicio upstream", indistinguible de una caída del servicio.
  const auth = requireAuthorizationHeader(request);
  if (typeof auth !== 'string') return auth;

  const gate = requireFuncionalidad(request, 'Query Inicios de sesion');
  if (gate !== true) return gate;

  const url = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username || username.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'Parámetro username es requerido', code: 'MISSING_PARAM' },
      { status: 400 }
    );
  }

  const trimmed = username.trim();
  const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/por-username?username=${encodeURIComponent(trimmed)}`;
  const authHeader = auth; // ya validado arriba por requireAuthorizationHeader
  const callerUser = request.headers.get('x-track-user') ?? 'unknown';

  console.log(
    `[usuario-detalle] GET upstream → ${upstreamUrl} (caller: ${callerUser})`,
  );

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    const body = await upstreamRes.json().catch(() => null);

    if (!upstreamRes.ok) {
      console.error(
        `[usuario-detalle] upstream ${upstreamRes.status}:`,
        JSON.stringify(body),
      );
      // 404 conserva su mensaje propio (es un resultado esperable de la
      // búsqueda). El resto pasa por describirErrorUpstream para que un 401 del
      // SecuritySuite se lea como "se te venció la sesión" y no como una caída.
      // El código del guard viaja en el header `x-auth-guard`, no en el body.
      const desc = describirErrorUpstream(
        upstreamRes.status,
        upstreamRes.headers.get(HEADER_AUTH_GUARD),
      );
      return NextResponse.json(
        {
          success: false,
          error: upstreamRes.status === 404 ? 'Usuario no encontrado' : desc.error,
          ...(upstreamRes.status === 404 ? {} : { code: desc.code }),
          upstream_status: upstreamRes.status,
          ...(desc.ocultarDetalle ? {} : { detail: body }),
        },
        { status: upstreamRes.status },
      );
    }

    // Spec del upstream: { success: true, item: { ... } }
    // Mapeamos a nuestro shape: { success: true, usuario: { ... } } para que el
    // cliente no tenga que conocer el rename. Aceptamos también `usuario` o un
    // objeto plano como fallback defensivo.
    type UpstreamShape = { success?: boolean; item?: unknown; usuario?: unknown };
    const u = (body as UpstreamShape) ?? {};
    const item = u.item ?? u.usuario ?? body;

    return NextResponse.json({ success: true, usuario: item }, { status: 200 });
  } catch (err) {
    console.error('[usuario-detalle] excepción al llamar upstream:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'Error al conectar con SecuritySuite',
        code: 'UPSTREAM_UNREACHABLE',
      },
      { status: 502 },
    );
  }
}
