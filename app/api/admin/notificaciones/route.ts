import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import type { Notificacion, NotificacionUserState } from '@/types/supabase';

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

// GET /api/admin/notificaciones — lista todas las notificaciones con stats de lecturas
export async function GET(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    const { data: notificaciones, error } = await client
      .from('notificaciones')
      .select(`
        *,
        notificaciones_user_state (
          notificacion_id,
          username,
          visto_at,
          dismissed_at
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[notificaciones] GET error:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener notificaciones' },
        { status: 500 }
      );
    }

    // Calcular stats de lecturas por notificacion
    const result = (notificaciones || []).map((notif: Notificacion & { notificaciones_user_state: NotificacionUserState[] }) => {
      const states: NotificacionUserState[] = notif.notificaciones_user_state || [];
      const vistos = states.filter((s) => s.visto_at !== null).length;
      const dismissed_count = states.filter((s) => s.dismissed_at !== null).length;
      const { notificaciones_user_state: _, ...notifData } = notif;
      return { ...notifData, vistos, dismissed_count };
    });

    return NextResponse.json({ success: true, notificaciones: result });
  } catch (error) {
    console.error('[notificaciones] Error en GET /api/admin/notificaciones:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

// POST /api/admin/notificaciones — crear nueva notificacion
export async function POST(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  try {
    const username = request.headers.get('x-track-user') || 'root';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Body JSON invalido' },
        { status: 400 }
      );
    }

    const { titulo, descripcion, fecha_inicio, fecha_fin, activa, roles_target, media_url, media_type } = body;

    if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
      return NextResponse.json({ success: false, error: 'titulo es requerido' }, { status: 400 });
    }
    if (!descripcion || typeof descripcion !== 'string' || !descripcion.trim()) {
      return NextResponse.json({ success: false, error: 'descripcion es requerida' }, { status: 400 });
    }
    if (!fecha_inicio || typeof fecha_inicio !== 'string') {
      return NextResponse.json({ success: false, error: 'fecha_inicio es requerida' }, { status: 400 });
    }
    if (!fecha_fin || typeof fecha_fin !== 'string') {
      return NextResponse.json({ success: false, error: 'fecha_fin es requerida' }, { status: 400 });
    }
    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return NextResponse.json({ success: false, error: 'fecha_fin debe ser mayor que fecha_inicio' }, { status: 400 });
    }

    const { data, error } = await client
      .from('notificaciones')
      .insert({
        titulo: String(titulo).trim(),
        descripcion: String(descripcion).trim(),
        fecha_inicio,
        fecha_fin,
        activa: activa !== false, // default true
        roles_target: Array.isArray(roles_target) ? roles_target : [],
        media_url: media_url ? String(media_url) : null,
        media_type: media_type === 'image' || media_type === 'video' ? media_type : null,
        created_by: username,
      })
      .select()
      .single();

    if (error) {
      console.error('[notificaciones] POST insert error:', error);
      return NextResponse.json(
        { success: false, error: 'Error al crear notificacion' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, notificacion: data }, { status: 201 });
  } catch (error) {
    console.error('[notificaciones] Error en POST /api/admin/notificaciones:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
