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

// PUT /api/admin/notificaciones/[id] — editar notificacion
export async function PUT(
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

    // Verificar que existe
    const { data: existing, error: findError } = await client
      .from('notificaciones')
      .select('id')
      .eq('id', notifId)
      .maybeSingle();

    if (findError || !existing) {
      return NextResponse.json({ success: false, error: 'Notificacion no encontrada' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body JSON invalido' }, { status: 400 });
    }

    // Validaciones basicas si se pasan los campos
    if (body.fecha_inicio && body.fecha_fin) {
      if (new Date(String(body.fecha_fin)) <= new Date(String(body.fecha_inicio))) {
        return NextResponse.json(
          { success: false, error: 'fecha_fin debe ser mayor que fecha_inicio' },
          { status: 400 }
        );
      }
    }

    // Construir el objeto de actualizacion (solo campos presentes en el body)
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.titulo !== undefined) updatePayload.titulo = String(body.titulo).trim();
    if (body.descripcion !== undefined) updatePayload.descripcion = String(body.descripcion).trim();
    if (body.fecha_inicio !== undefined) updatePayload.fecha_inicio = body.fecha_inicio;
    if (body.fecha_fin !== undefined) updatePayload.fecha_fin = body.fecha_fin;
    if (body.activa !== undefined) updatePayload.activa = Boolean(body.activa);
    if (body.roles_target !== undefined) {
      updatePayload.roles_target = Array.isArray(body.roles_target) ? body.roles_target : [];
    }
    if (body.media_url !== undefined) {
      updatePayload.media_url = body.media_url ? String(body.media_url) : null;
    }
    if (body.media_type !== undefined) {
      updatePayload.media_type =
        body.media_type === 'image' || body.media_type === 'video' ? body.media_type : null;
    }

    const { data, error } = await client
      .from('notificaciones')
      .update(updatePayload)
      .eq('id', notifId)
      .select()
      .single();

    if (error) {
      console.error('[notificaciones] PUT error:', error);
      return NextResponse.json({ success: false, error: 'Error al actualizar notificacion' }, { status: 500 });
    }

    return NextResponse.json({ success: true, notificacion: data });
  } catch (error) {
    console.error('[notificaciones] Error en PUT /api/admin/notificaciones/[id]:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}

// DELETE /api/admin/notificaciones/[id] — eliminar notificacion
export async function DELETE(
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

    // La FK en notificaciones_user_state tiene ON DELETE CASCADE — se eliminan automaticamente
    const { error } = await client
      .from('notificaciones')
      .delete()
      .eq('id', notifId);

    if (error) {
      console.error('[notificaciones] DELETE error:', error);
      return NextResponse.json({ success: false, error: 'Error al eliminar notificacion' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Notificacion eliminada' });
  } catch (error) {
    console.error('[notificaciones] Error en DELETE /api/admin/notificaciones/[id]:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}
