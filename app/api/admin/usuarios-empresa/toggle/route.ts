import { NextRequest, NextResponse } from 'next/server';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

/**
 * API: POST /api/admin/usuarios-empresa/toggle
 *
 * Gate: funcionalidad 'Gestion de Usuarios' (via x-track-funcs).
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
  const authHeader = request.headers.get('Authorization') ?? '';
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
      return NextResponse.json(
        {
          success: false,
          error: 'Error del servicio upstream',
          upstream_status: upstreamRes.status,
          upstream_url: upstreamUrl,
          detail: data,
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
