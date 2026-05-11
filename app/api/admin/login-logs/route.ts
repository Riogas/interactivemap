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
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const ip = searchParams.get('ip');
    const estado = searchParams.get('estado');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const client = getServerSupabaseClient();

    // Query base
    let query = client
      .from('login_attempts')
      .select('*', { count: 'exact' })
      .order('ts', { ascending: false })
      .range(offset, offset + limit - 1);

    // Aplicar filtros
    if (username) {
      query = query.ilike('username', `%${username}%`);
    }
    if (ip) {
      query = query.ilike('ip', `%${ip}%`);
    }
    if (estado) {
      query = query.eq('estado', estado);
    }

    const { data: attempts, count, error } = await query;

    if (error) {
      console.error('Error fetching login_attempts:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener los intentos' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      attempts: attempts || [],
      total: count || 0,
    });
  } catch (error) {
    console.error('Error en GET /api/admin/login-logs:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
