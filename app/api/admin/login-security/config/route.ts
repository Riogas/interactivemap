import { NextRequest, NextResponse } from 'next/server';
import { getLoginSecurityConfig, setLoginSecurityConfig } from '@/lib/login-security-config';

/**
 * GET  /api/admin/login-security/config — Leer config global de limites de bloqueo
 * PUT  /api/admin/login-security/config — Actualizar config global
 *
 * Gate: header x-track-isroot: 'S' (mismo patron que todos los endpoints admin)
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
      tiempoBloqueoMinutos: config.tiempoBloqueoMinutos,
      mensajeBloqueo: config.mensajeBloqueo,
    });
  } catch (error) {
    console.error('[api/admin/login-security/config] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al leer configuracion' },
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
      { success: false, error: 'Body invalido' },
      { status: 400 }
    );
  }

  const { maxIntentosUsuario, maxIntentosIp, tiempoBloqueoMinutos, mensajeBloqueo } = body as Record<string, unknown>;

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

  // Validar tiempoBloqueoMinutos
  if (
    typeof tiempoBloqueoMinutos !== 'number' ||
    !Number.isInteger(tiempoBloqueoMinutos) ||
    tiempoBloqueoMinutos < 1 ||
    tiempoBloqueoMinutos > 1440
  ) {
    return NextResponse.json(
      { success: false, error: 'tiempoBloqueoMinutos debe ser un entero entre 1 y 1440' },
      { status: 400 }
    );
  }

  // Validar mensajeBloqueo
  if (
    typeof mensajeBloqueo !== 'string' ||
    mensajeBloqueo.trim().length === 0 ||
    mensajeBloqueo.trim().length > 500
  ) {
    return NextResponse.json(
      { success: false, error: 'mensajeBloqueo debe ser un texto de 1 a 500 caracteres' },
      { status: 400 }
    );
  }

  try {
    const updatedBy = request.headers.get('x-track-user') ?? null;
    await setLoginSecurityConfig(
      {
        maxIntentosUsuario,
        maxIntentosIp,
        tiempoBloqueoMinutos,
        mensajeBloqueo: mensajeBloqueo.trim(),
      },
      updatedBy
    );

    return NextResponse.json({
      success: true,
      maxIntentosUsuario,
      maxIntentosIp,
      tiempoBloqueoMinutos,
      mensajeBloqueo: mensajeBloqueo.trim(),
    });
  } catch (error) {
    console.error('[api/admin/login-security/config] PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al guardar configuracion' },
      { status: 500 }
    );
  }
}
