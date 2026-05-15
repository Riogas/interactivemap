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

// GET /api/admin/notificaciones/[id]/lecturas
// Devuelve el tracking de usuarios para una notificacion especifica.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  try {
    const { id } = await params;
    const notifId = parseInt(id, 10);

    if (!notifId || isNaN(notifId)) {
      return NextResponse.json({ success: false, error: 'ID invalido' }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    const { data: lecturas, error } = await client
      .from('notificaciones_user_state')
      .select('*')
      .eq('notificacion_id', notifId)
      .order('visto_at', { ascending: false });

    if (error) {
      console.error('[notificaciones/lecturas] GET error:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener lecturas' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, lecturas: lecturas || [] });
  } catch (error) {
    console.error('[notificaciones/lecturas] Error en GET:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}
