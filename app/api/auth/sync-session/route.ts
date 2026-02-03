import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 🔄 Sincronización de Sesión: GeneXus → Supabase
 * 
 * Este endpoint crea una sesión de Supabase después de un login exitoso
 * en GeneXus, permitiendo que las rutas protegidas con requireAuth() funcionen.
 * 
 * SEGURIDAD:
 * - ✅ Sin autenticación previa (es parte del proceso de login)
 * - ✅ Rate limiting aplicado por proxy.ts
 * 
 * Flujo:
 * 1. Usuario hace login en GeneXus → obtiene JWT
 * 2. Frontend llama a este endpoint con JWT + user data
 * 3. Este endpoint crea sesión anónima en Supabase con metadata de GeneXus
 * 4. Usuario ahora tiene ambas sesiones activas
 */

interface SyncSessionRequest {
  token: string;
  user: {
    id: string;
    username: string;
    email?: string;
    nombre?: string;
    isRoot?: string;
    roles?: Array<{
      RolId: string;
      RolNombre: string;
      RolTipo: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  console.log('\n🔄 ═══════════════════════════════════════════════════════');
  console.log('🔄 SYNC SESSION - Iniciando sincronización');
  console.log('🔄 ═══════════════════════════════════════════════════════');

  try {
    const body: SyncSessionRequest = await request.json();
    console.log('📦 Body recibido:', {
      hasToken: !!body.token,
      tokenLength: body.token?.length,
      userId: body.user?.id,
      username: body.user?.username,
    });

    if (!body.token || !body.user) {
      console.error('❌ Faltan campos requeridos');
      return NextResponse.json(
        { error: 'Token y usuario requeridos' },
        { status: 400 }
      );
    }

    if (!body.user.id || !body.user.username) {
      console.error('❌ Datos de usuario incompletos');
      return NextResponse.json(
        { error: 'Datos de usuario incompletos (id y username requeridos)' },
        { status: 400 }
      );
    }

    console.log('✅ Validación de entrada exitosa');
    console.log('🔐 Creando cliente de Supabase...');

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
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignorar errores de cookies en middleware
            }
          },
        },
      }
    );

    console.log('🔐 Cliente de Supabase creado');
    console.log('🔐 Intentando crear sesión anónima con metadata...');

    // Crear sesión anónima en Supabase con metadata de GeneXus
    // Esto permite que requireAuth() encuentre una sesión válida
    const { data, error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          // Metadata de GeneXus que se guarda en la sesión
          genexus_token: body.token,
          genexus_user_id: body.user.id,
          genexus_username: body.user.username,
          genexus_email: body.user.email || '',
          genexus_nombre: body.user.nombre || body.user.username,
          genexus_is_root: body.user.isRoot || 'N',
          genexus_roles: JSON.stringify(body.user.roles || []),
          synced_at: new Date().toISOString(),
        }
      }
    });

    if (error) {
      console.error('❌ Error creando sesión en Supabase:');
      console.error('   Error code:', error.code);
      console.error('   Error message:', error.message);
      console.error('   Error status:', error.status);
      
      return NextResponse.json(
        { 
          error: 'Error al crear sesión de Supabase',
          details: error.message,
        },
        { status: 500 }
      );
    }

    console.log('✅ Sesión de Supabase creada exitosamente');
    console.log('   Session ID:', data.session?.access_token?.substring(0, 20) + '...');
    console.log('   User ID:', data.user?.id);
    console.log('   Expires at:', data.session?.expires_at);

    console.log('🔄 ═══════════════════════════════════════════════════════');
    console.log('🔄 SYNC SESSION - Completado exitosamente');
    console.log('🔄 ═══════════════════════════════════════════════════════\n');

    return NextResponse.json({
      success: true,
      supabase_session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_at: data.session?.expires_at,
        user_id: data.user?.id,
      },
      message: 'Sesión sincronizada correctamente',
    });
  } catch (error) {
    console.error('❌ ═══════════════════════════════════════════════════════');
    console.error('❌ ERROR EN SYNC SESSION');
    console.error('❌ ═══════════════════════════════════════════════════════');
    console.error('❌ Error:', error);
    console.error('❌ Stack:', error instanceof Error ? error.stack : 'N/A');
    console.error('❌ ═══════════════════════════════════════════════════════\n');
    
    return NextResponse.json(
      { 
        error: 'Error interno del servidor',
        details: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}
