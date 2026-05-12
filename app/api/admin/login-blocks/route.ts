import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

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

export async function GET(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const now = new Date().toISOString();
    const url = new URL(request.url);

    // showAll=true devuelve también los desbloqueados manualmente (para historial)
    const showAll = url.searchParams.get('showAll') === 'true';

    let query = client
      .from('login_blocks')
      .select('*')
      .gte('blocked_until', now)
      .order('created_at', { ascending: false });

    // FIX (Issue 4 + Issue 2): filtrar solo bloqueos activos (is_active=true)
    // para excluir los desbloqueados manualmente vía el panel.
    // Si showAll=true, el panel quiere ver histórico: omitir el filtro.
    if (!showAll) {
      query = query.eq('is_active', true);
    }

    const { data: blocks, error } = await query;

    if (error) {
      console.error('[login-blocks] Error fetching login_blocks:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener los bloqueos' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      blocks: blocks || [],
    });
  } catch (error) {
    console.error('[login-blocks] Error en GET /api/admin/login-blocks:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
