import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * 🚪 Logout — limpieza de cookies residuales de Supabase.
 *
 * Ya no usamos `supabase.auth.signInAnonymously()` en el login, pero históricamente
 * sí: pueden quedar cookies `sb-<ref>-auth-token` expiradas en los browsers de los
 * usuarios. Si no se borran, el cliente las sigue enviando en las requests al WS
 * de Realtime y Supabase las rechaza (sesión expirada + anonymous_provider_disabled),
 * dejando Realtime colgado "Conectando".
 *
 * Este endpoint recorre las cookies del request, marca todas las `sb-*-auth-token`
 * con Max-Age=0 en la respuesta para que el browser las elimine.
 */

export async function POST(_request: NextRequest) {
  console.log('🚪 [logout] Limpiando cookies residuales de Supabase');

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();

    for (const c of all) {
      if (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) {
        cookieStore.set(c.name, '', {
          path: '/',
          maxAge: 0,
        });
        console.log(`   🧹 removiendo ${c.name}`);
      }
    }

    return NextResponse.json({ success: true, message: 'Cookies de Supabase limpiadas' });
  } catch (error) {
    console.warn('⚠️ [logout] Error limpiando cookies:', error);
    // Devolver success igual — el client ya limpió localStorage y lo demás
    return NextResponse.json({ success: true, warning: 'Error server-side' });
  }
}
