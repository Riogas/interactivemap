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
    const client = getServerSupabaseClient();
    const now = new Date().toISOString();

    // Solo bloqueos activos
    const { data: blocks, error } = await client
      .from('login_blocks')
      .select('*')
      .gte('blocked_until', now)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching login_blocks:', error);
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
    console.error('Error en GET /api/admin/login-blocks:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
