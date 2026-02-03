import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 🚪 Logout - Cerrar Sesión de Supabase
 * 
 * Este endpoint cierra la sesión de Supabase creada durante el login.
 * El frontend también debe limpiar el localStorage y la sesión de GeneXus.
 * 
 * SEGURIDAD:
 * - ✅ Sin autenticación previa requerida (estamos cerrando sesión)
 * - ✅ Rate limiting aplicado por proxy.ts
 */

export async function POST(request: NextRequest) {
  console.log('\n🚪 ═══════════════════════════════════════════════════════');
  console.log('🚪 LOGOUT - Iniciando cierre de sesión');
  console.log('🚪 ═══════════════════════════════════════════════════════');

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
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignorar errores de cookies
            }
          },
        },
      }
    );

    console.log('🔐 Cliente de Supabase creado');
    console.log('🔐 Cerrando sesión...');

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.warn('⚠️ Error cerrando sesión de Supabase:', error.message);
      // No fallar - la sesión local se limpiará de todas formas
      return NextResponse.json({
        success: true,
        message: 'Sesión local cerrada (Supabase pudo tener error)',
        warning: error.message,
      });
    }

    console.log('✅ Sesión de Supabase cerrada exitosamente');
    console.log('🚪 ═══════════════════════════════════════════════════════');
    console.log('🚪 LOGOUT - Completado');
    console.log('🚪 ═══════════════════════════════════════════════════════\n');

    return NextResponse.json({
      success: true,
      message: 'Sesión cerrada correctamente',
    });
  } catch (error) {
    console.error('❌ Error en logout:', error);
    
    // Retornar éxito de todas formas - el cliente limpiará localStorage
    return NextResponse.json({
      success: true,
      message: 'Sesión local cerrada',
      warning: 'Error al comunicarse con Supabase',
    });
  }
}
