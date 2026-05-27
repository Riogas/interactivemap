import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/manual/current
 *
 * Endpoint PÚBLICO (sin auth) que devuelve la URL actual del manual de usuario.
 * Leída desde app_config WHERE key = 'manual_url'.
 *
 * Si la tabla no existe o la fila no tiene datos, cae al PDF estático de fallback.
 *
 * Response: { url: string, updated_at: string | null, updated_by: string | null }
 * Cache-Control: public, max-age=60 (el botón ? lo usa, no es crítico que sea inmediato)
 */

const FALLBACK_URL = '/manual/InstructivoRiogasTracking.pdf';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60',
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getServerSupabaseClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('app_config')
      .select('value, updated_at, updated_by')
      .eq('key', 'manual_url')
      .maybeSingle();

    if (error || !data) {
      // Fallback graceful al PDF estático
      return NextResponse.json(
        { url: FALLBACK_URL, updated_at: null, updated_by: null },
        { headers: CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        url: data.value,
        updated_at: data.updated_at ?? null,
        updated_by: data.updated_by ?? null,
      },
      { headers: CACHE_HEADERS }
    );
  } catch {
    // Fallback graceful — si Supabase está caído, el botón sigue funcionando
    return NextResponse.json(
      { url: FALLBACK_URL, updated_at: null, updated_by: null },
      { headers: CACHE_HEADERS }
    );
  }
}
