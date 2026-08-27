import { NextRequest, NextResponse } from 'next/server';
import {
  describirErrorUpstream,
  requireAuthorizationHeader,
  requireFuncionalidad,
} from '@/lib/api-auth-gates';
import { HEADER_AUTH_GUARD } from '@/lib/securitysuite-guard';

/**
 * API: POST /api/admin/usuarios-empresa/toggle
 *
 * Gates: sesión (header Authorization usable) + funcionalidad 'Gestion de
 * Usuarios' (via x-track-funcs). La sesión se chequea primero: sin token el
 * problema es 401 (sesión), no 403 (permisos).
 *
 * Proxía al endpoint del SecuritySuite:
 *   POST ${SECURITY_SUITE_URL}/api/db/usuarios/{userId}/permite-login
 *   body: { accion: "grant" | "revoke" | "toggle" }
 *
 * Request body esperado del cliente:
 *   {
 *     userId: number,           // id numérico del usuario (NO el username)
 *     accion?: "grant"|"revoke"|"toggle",  // opcional
 *     enabled?: boolean         // alternativa: si se manda, se traduce a grant/revoke
 *   }
 *
 * Si no se especifica accion ni enabled, se asume "toggle" (invierte estado actual).
 *
 * Response del upstream — pasamos tal cual:
 *   { success: true, usuarioId, username, accion, resultado, habilitado }
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

type Accion = 'grant' | 'revoke' | 'toggle';

export async function POST(request: NextRequest) {
  // Sesión primero: esto es una ESCRITURA que habilita o deshabilita el acceso
  // de una persona al sistema. Si no hay token, cortamos con un 401 propio y un
  // mensaje que dice que fue por sesión, en vez de mandar un `Authorization`
  // vacío al SecuritySuite y devolver su 401 opaco como si el servicio fallara.
  const auth = requireAuthorizationHeader(request);
  if (typeof auth !== 'string') return auth;

  const gate = requireFuncionalidad(request, 'Gestion de Usuarios');
  if (gate !== true) return gate;

  let body: {
    userId?: number;
    username?: string;
    accion?: string;
    enabled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body JSON inválido' },
      { status: 400 },
    );
  }

  const { userId, accion, enabled } = body;

  if (typeof userId !== 'number' || !Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json(
      { success: false, error: 'Campo userId (number > 0) requerido' },
      { status: 400 },
    );
  }

  // Resolver acción final:
  // 1) Si viene `accion` válida, usarla.
  // 2) Si viene `enabled` boolean, traducirlo a grant/revoke.
  // 3) Default: toggle.
  let accionFinal: Accion = 'toggle';
  if (accion === 'grant' || accion === 'revoke' || accion === 'toggle') {
    accionFinal = accion;
  } else if (typeof enabled === 'boolean') {
    accionFinal = enabled ? 'grant' : 'revoke';
  }

  const callerUser = request.headers.get('x-track-user') ?? 'unknown';
  const authHeader = auth; // ya validado arriba por requireAuthorizationHeader
  const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/${userId}/permite-login`;

  console.log(
    `[usuarios-empresa/toggle] POST upstream → ${upstreamUrl} body={accion:"${accionFinal}"} (caller: ${callerUser})`,
  );

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accion: accionFinal }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstreamRes.json().catch(() => null);

    if (!upstreamRes.ok) {
      console.error(
        `[usuarios-empresa/toggle] upstream error ${upstreamRes.status}:`,
        JSON.stringify(data),
      );
      // El 401/403/503 del SecuritySuite trae el código interno (TOKEN_INVALIDO,
      // TOKEN_VENCIDO, SIN_POLITICA, SECRETO_NO_CONFIGURADO, ERROR_GUARD, ...)
      // en el header `x-auth-guard`, NO en el body — el body trae un mensaje
      // genérico del upstream. Se lo pasamos a describirErrorUpstream para poder
      // separar, por ejemplo, "falta el secreto" (permanente) de "el guard se
      // cayó" (transitorio). En los casos con ocultarDetalle NO reenviamos
      // `detail`: el cliente prioriza `detail.error` sobre `error`, así que
      // dejarlo pisaría el mensaje traducido. El body upstream igual queda en el
      // log de arriba.
      const desc = describirErrorUpstream(
        upstreamRes.status,
        upstreamRes.headers.get(HEADER_AUTH_GUARD),
      );
      return NextResponse.json(
        {
          success: false,
          error: desc.error,
          code: desc.code,
          upstream_status: upstreamRes.status,
          upstream_url: upstreamUrl,
          ...(desc.ocultarDetalle ? {} : { detail: data }),
        },
        { status: upstreamRes.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('[usuarios-empresa/toggle] excepción al llamar upstream:', err);
    return NextResponse.json(
      { success: false, error: 'Error de red al contactar el servicio de permisos' },
      { status: 502 },
    );
  }
}
