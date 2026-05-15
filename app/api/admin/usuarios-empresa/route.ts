import { NextRequest, NextResponse } from 'next/server';

/**
 * API proxy: GET /api/admin/usuarios-empresa
 *
 * Gate: usuario con rol "Distribuidor" (x-track-roles incluye 'Distribuidor') O isRoot (x-track-isroot === 'S').
 *
 * Proxía al endpoint upstream del SecuritySuite:
 *   GET ${SECURITY_SUITE_URL}/api/db/usuarios/por-empresa-fletera?empresas=<lista>
 *
 * El cliente pasa el parámetro ?empresas=NOMBRE_1,NOMBRE_2 o ?empresas=ID_1,ID_2
 * (los nombres vienen de la preferencia EmpFletera; los IDs son el fallback).
 * El token del usuario se forwarda en el header Authorization.
 *
 * Decisión de formato: primer intento = nombres (strings), fallback = IDs numéricos.
 * Documentado en lib/empresas-del-usuario.ts.
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

function requireDistribuidorOrRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot === 'S') return true;

  // El cliente serializa los roles en x-track-roles como JSON array de RolNombre
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

export async function GET(request: NextRequest) {
  const gate = requireDistribuidorOrRoot(request);
  if (gate !== true) return gate;

  const url = new URL(request.url);
  const empresasParam = url.searchParams.get('empresas') ?? '';

  if (!empresasParam) {
    return NextResponse.json(
      {
        success: false,
        error: 'Parámetro empresas requerido',
        code: 'EMPRESAS_REQUIRED',
      },
      { status: 400 },
    );
  }

  // Forward del token del usuario al upstream (proxy con auth del usuario)
  const authHeader = request.headers.get('Authorization') ?? '';

  const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/por-empresa-fletera?empresas=${encodeURIComponent(empresasParam)}`;

  console.log(
    `[usuarios-empresa] GET proxy → ${upstreamUrl} (caller: ${request.headers.get('x-track-user') ?? 'unknown'})`,
  );

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstreamRes.json();

    if (!upstreamRes.ok) {
      console.error(
        `[usuarios-empresa] Upstream error ${upstreamRes.status}:`,
        data,
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Error del servicio upstream',
          upstream_status: upstreamRes.status,
          detail: data,
        },
        { status: upstreamRes.status },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('[usuarios-empresa] Error de red al llamar upstream:', err);
    return NextResponse.json(
      { success: false, error: 'Error de red al contactar el servicio de usuarios' },
      { status: 502 },
    );
  }
}
