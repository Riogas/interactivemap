/**
 * 🔐 MIDDLEWARE DE AUTENTICACIÓN Y SEGURIDAD
 * 
 * Este archivo proporciona funciones de autenticación y autorización
 * para proteger las rutas API de la aplicación TrackMovil.
 * 
 * VARIABLE DE ENTORNO:
 * - ENABLE_SECURITY_CHECKS: true/false (default: false)
 *   Controla si se aplican las validaciones de seguridad (requireAuth, requireApiKey, requireRole)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Tipo de respuesta de autenticación
 */
type AuthResult = {
  session: any;
  user: any;
  error?: string;
};

/**
 * � Variable de control de seguridad
 * Si es false, todos los checks de seguridad se saltan
 */
const SECURITY_ENABLED = process.env.ENABLE_SECURITY_CHECKS === 'true';

/**
 * �🔑 Verificar autenticación de usuario mediante Supabase Auth
 * 
 * Esta función valida que el usuario tenga una sesión válida de Supabase.
 * Se debe usar en todas las rutas que requieren que el usuario esté logueado.
 * 
 * NOTA: Si ENABLE_SECURITY_CHECKS=false, esta validación se salta automáticamente.
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const authResult = await requireAuth(request);
 *   if (authResult instanceof NextResponse) return authResult;
 *   
 *   const { session, user } = authResult;
 *   // ... resto del código
 * }
 * ```
 */
export async function requireAuth(request: NextRequest): Promise<AuthResult | NextResponse> {
  // ⚠️ MODO SIN SEGURIDAD: Bypass de autenticación
  if (!SECURITY_ENABLED) {
    console.log('⚠️ SECURITY_CHECKS DISABLED: Saltando requireAuth()');
    return {
      session: { user: { id: 'bypass-mode' } },
      user: { id: 'bypass-mode', email: 'bypass@disabled.local' }
    };
  }
  try {
    // Crear cliente de Supabase con las cookies del request
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    // Obtener sesión actual
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error('❌ Error al obtener sesión:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Error de autenticación',
          message: error.message,
          code: 'AUTH_ERROR',
        },
        { status: 401 }
      );
    }

    if (!session) {
      console.warn('⚠️  Intento de acceso sin autenticación');
      return NextResponse.json(
        {
          success: false,
          error: 'No autorizado',
          message: 'Debes iniciar sesión para acceder a este recurso',
          code: 'NO_SESSION',
        },
        { status: 401 }
      );
    }

    // Verificar que el token no haya expirado
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at < now) {
      console.warn('⚠️  Token expirado');
      return NextResponse.json(
        {
          success: false,
          error: 'Sesión expirada',
          message: 'Tu sesión ha expirado, por favor inicia sesión nuevamente',
          code: 'TOKEN_EXPIRED',
        },
        { status: 401 }
      );
    }

    console.log('✅ Autenticación exitosa:', session.user.email);

    return {
      session,
      user: session.user,
    };
  } catch (error: any) {
    console.error('❌ Error crítico en requireAuth:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno de autenticación',
        message: 'Ocurrió un error al verificar tu autenticación',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}

/**
 * 🔑 Verificar API Key para endpoints de importación/integración
 * 
 * Esta función valida que el request incluya un API Key válido en el header.
 * Se usa para proteger endpoints que son llamados por sistemas externos
 * como GeneXus o integraciones automáticas.
 * 
 * NOTA: Si ENABLE_SECURITY_CHECKS=false, esta validación se salta automáticamente.
 * 
 * Configuración:
 * 1. Generar API Key: Usa un generador aleatorio de al menos 32 caracteres
 * 2. Agregar a .env: INTERNAL_API_KEY=tu_api_key_secreta
 * 3. En el cliente: Incluir header 'x-api-key: tu_api_key_secreta'
 * 
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const keyValidation = requireApiKey(request);
 *   if (keyValidation instanceof NextResponse) return keyValidation;
 *   
 *   // ... resto del código
 * }
 * ```
 */
export function requireApiKey(request: NextRequest): true | NextResponse {
  // ⚠️ MODO SIN SEGURIDAD: Bypass de API Key
  if (!SECURITY_ENABLED) {
    console.log('⚠️ SECURITY_CHECKS DISABLED: Saltando requireApiKey()');
    return true;
  }

  const apiKey = request.headers.get('x-api-key');
  const validApiKey = process.env.INTERNAL_API_KEY;

  // Verificar que la API Key esté configurada en el servidor
  if (!validApiKey) {
    console.error('❌ INTERNAL_API_KEY no está configurada en .env');
    return NextResponse.json(
      {
        success: false,
        error: 'Configuración de seguridad incompleta',
        message: 'El servidor no está configurado correctamente',
        code: 'SERVER_MISCONFIGURED',
      },
      { status: 500 }
    );
  }

  // Verificar que el request incluya API Key
  if (!apiKey) {
    console.warn('⚠️  Intento de acceso sin API Key');
    return NextResponse.json(
      {
        success: false,
        error: 'API Key requerida',
        message: 'Debes incluir el header x-api-key para acceder a este endpoint',
        code: 'API_KEY_MISSING',
      },
      { status: 403 }
    );
  }

  // Validar que la API Key sea correcta
  if (apiKey !== validApiKey) {
    console.warn('⚠️  API Key inválida:', apiKey.substring(0, 8) + '...');
    return NextResponse.json(
      {
        success: false,
        error: 'API Key inválida',
        message: 'La API Key proporcionada no es válida',
        code: 'API_KEY_INVALID',
      },
      { status: 403 }
    );
  }

  console.log('✅ API Key válida');
  return true;
}

/**
 * 👮 Verificar que el usuario tenga un rol específico
 * 
 * Útil para endpoints de administración que solo deben ser accesibles
 * por usuarios con permisos especiales.
 * 
 * NOTA: Si ENABLE_SECURITY_CHECKS=false, esta validación se salta automáticamente.
 * 
 * @example
 * ```typescript
 * export async function DELETE(request: NextRequest) {
 *   const authResult = await requireAuth(request);
 *   if (authResult instanceof NextResponse) return authResult;
 *   
 *   const roleCheck = requireRole(authResult.user, 'admin');
 *   if (roleCheck instanceof NextResponse) return roleCheck;
 *   
 *   // ... resto del código
 * }
 * ```
 */
export function requireRole(user: any, requiredRole: string): true | NextResponse {
  // ⚠️ MODO SIN SEGURIDAD: Bypass de roles
  if (!SECURITY_ENABLED) {
    console.log(`⚠️ SECURITY_CHECKS DISABLED: Saltando requireRole('${requiredRole}')`);
    return true;
  }

  const userRole = user.user_metadata?.role || user.role || 'user';

  if (userRole !== requiredRole) {
    console.warn(`⚠️  Usuario ${user.email} intentó acceder sin rol ${requiredRole}`);
    return NextResponse.json(
      {
        success: false,
        error: 'Acceso denegado',
        message: `Se requiere rol de ${requiredRole} para acceder a este recurso`,
        code: 'INSUFFICIENT_PERMISSIONS',
      },
      { status: 403 }
    );
  }

  return true;
}

/**
 * 🔓 Verificar autenticación OPCIONAL
 * 
 * Intenta obtener la sesión pero no falla si no existe.
 * Útil para endpoints que tienen funcionalidad diferente según
 * si el usuario está autenticado o no.
 */
export async function getOptionalAuth(request: NextRequest): Promise<AuthResult | null> {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return null;

    return {
      session,
      user: session.user,
    };
  } catch (error) {
    console.error('Error en getOptionalAuth:', error);
    return null;
  }
}

/**
 * 📝 Logger de intentos de acceso no autorizado
 * 
 * Registra intentos fallidos de autenticación para análisis de seguridad
 */
export function logUnauthorizedAccess(request: NextRequest, reason: string) {
  const timestamp = new Date().toISOString();
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const url = request.url;

  console.warn('🚨 ACCESO NO AUTORIZADO', {
    timestamp,
    ip,
    userAgent,
    url,
    reason,
  });

  // Aquí podrías integrar con un sistema de logging más robusto
  // como Winston, Sentry, o enviar a un servicio de monitoreo
}
