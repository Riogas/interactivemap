import { NextRequest, NextResponse } from 'next/server';
import { getLoginSecurityConfig, setLoginSecurityConfig } from '@/lib/login-security-config';

/**
 * GET  /api/admin/login-security/config — Leer config global de límites de bloqueo
 * PUT  /api/admin/login-security/config — Actualizar config global
 *
 * Gate: header x-track-isroot: 'S' (mismo patrón que todos los endpoints admin)
 */

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

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  try {
    const config = await getLoginSecurityConfig();
    return NextResponse.json({
      success: true,
      maxIntentosUsuario: config.maxIntentosUsuario,
      maxIntentosIp: config.maxIntentosIp,
    });
  } catch (error) {
    console.error('[api/admin/login-security/config] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al leer configuración' },
      { status: 500 }
    );
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body inválido' },
      { status: 400 }
    );
  }

  const { maxIntentosUsuario, maxIntentosIp } = body as Record<string, unknown>;

  // Validar maxIntentosUsuario
  if (
    typeof maxIntentosUsuario !== 'number' ||
    !Number.isInteger(maxIntentosUsuario) ||
    maxIntentosUsuario < 1 ||
    maxIntentosUsuario > 100
  ) {
    return NextResponse.json(
      { success: false, error: 'maxIntentosUsuario debe ser un entero entre 1 y 100' },
      { status: 400 }
    );
  }

  // Validar maxIntentosIp
  if (
    typeof maxIntentosIp !== 'number' ||
    !Number.isInteger(maxIntentosIp) ||
    maxIntentosIp < 1 ||
    maxIntentosIp > 100
  ) {
    return NextResponse.json(
      { success: false, error: 'maxIntentosIp debe ser un entero entre 1 y 100' },
      { status: 400 }
    );
  }

  try {
    const updatedBy = request.headers.get('x-track-user') ?? null;
    await setLoginSecurityConfig({ maxIntentosUsuario, maxIntentosIp }, updatedBy);

    return NextResponse.json({
      success: true,
      maxIntentosUsuario,
      maxIntentosIp,
    });
  } catch (error) {
    console.error('[api/admin/login-security/config] PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al guardar configuración' },
      { status: 500 }
    );
  }
}
