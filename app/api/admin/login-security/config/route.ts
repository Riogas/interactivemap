import { NextRequest, NextResponse } from 'next/server';
import { getLoginSecurityConfig, setLoginSecurityConfig } from '@/lib/login-security-config';
import { isValidIpPattern } from '@/lib/ip-whitelist';

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
      tiempoBloqueoUsuarioMinutos: config.tiempoBloqueoUsuarioMinutos,
      tiempoBloqueoIpMinutos: config.tiempoBloqueoIpMinutos,
      ipWhitelistPatterns: config.ipWhitelistPatterns,
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

  const {
    maxIntentosUsuario,
    maxIntentosIp,
    tiempoBloqueoUsuarioMinutos,
    tiempoBloqueoIpMinutos,
    ipWhitelistPatterns,
    mensajeBloqueo,
  } = body as Record<string, unknown>;

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

  // Validar tiempoBloqueoUsuarioMinutos
  if (
    typeof tiempoBloqueoUsuarioMinutos !== 'number' ||
    !Number.isInteger(tiempoBloqueoUsuarioMinutos) ||
    tiempoBloqueoUsuarioMinutos < 1 ||
    tiempoBloqueoUsuarioMinutos > 1440
  ) {
    return NextResponse.json(
      { success: false, error: 'tiempoBloqueoUsuarioMinutos debe ser un entero entre 1 y 1440' },
      { status: 400 }
    );
  }

  // Validar tiempoBloqueoIpMinutos
  if (
    typeof tiempoBloqueoIpMinutos !== 'number' ||
    !Number.isInteger(tiempoBloqueoIpMinutos) ||
    tiempoBloqueoIpMinutos < 1 ||
    tiempoBloqueoIpMinutos > 1440
  ) {
    return NextResponse.json(
      { success: false, error: 'tiempoBloqueoIpMinutos debe ser un entero entre 1 y 1440' },
      { status: 400 }
    );
  }

  // Validar ipWhitelistPatterns
  if (!Array.isArray(ipWhitelistPatterns)) {
    return NextResponse.json(
      { success: false, error: 'ipWhitelistPatterns debe ser un array' },
      { status: 400 }
    );
  }

  // Validar que cada pattern sea string valido
  const invalidPatterns: string[] = [];
  for (const pattern of ipWhitelistPatterns) {
    if (typeof pattern !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Cada elemento de ipWhitelistPatterns debe ser un string' },
        { status: 400 }
      );
    }
    if (!isValidIpPattern(pattern)) {
      invalidPatterns.push(pattern);
    }
  }
  if (invalidPatterns.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Patrones de IP invalidos: ${invalidPatterns.join(', ')}`,
        invalidPatterns,
      },
      { status: 400 }
    );
  }

  // Limitar cantidad de patrones (defensa ante abuso)
  if (ipWhitelistPatterns.length > 100) {
    return NextResponse.json(
      { success: false, error: 'Maximo 100 patrones de IP permitidos' },
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
    const cleanPatterns = (ipWhitelistPatterns as string[]).map(p => p.trim());

    await setLoginSecurityConfig(
      {
        maxIntentosUsuario,
        maxIntentosIp,
        tiempoBloqueoUsuarioMinutos,
        tiempoBloqueoIpMinutos,
        ipWhitelistPatterns: cleanPatterns,
        mensajeBloqueo: mensajeBloqueo.trim(),
      },
      updatedBy
    );

    return NextResponse.json({
      success: true,
      maxIntentosUsuario,
      maxIntentosIp,
      tiempoBloqueoUsuarioMinutos,
      tiempoBloqueoIpMinutos,
      ipWhitelistPatterns: cleanPatterns,
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
