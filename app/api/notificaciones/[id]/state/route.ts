import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

// POST /api/notificaciones/[id]/state
// Registra que el usuario vio o dismissio una notificacion.
// Body: { action: 'viewed' | 'dismissed' }
// Graceful degradation: si Supabase falla, loguea pero devuelve 200 de todas formas
// (no queremos bloquear la UX por un fallo de tracking).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const notifId = parseInt(id, 10);

    if (!notifId || isNaN(notifId)) {
      return NextResponse.json({ success: false, error: 'ID invalido' }, { status: 400 });
    }

    const username = request.headers.get('x-track-user') || '';
    if (!username) {
      return NextResponse.json({ success: false, error: 'Usuario no autenticado' }, { status: 401 });
    }

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body JSON invalido' }, { status: 400 });
    }

    const { action } = body;
    if (action !== 'viewed' && action !== 'dismissed') {
      return NextResponse.json(
        { success: false, error: 'action debe ser "viewed" o "dismissed"' },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const nowIso = new Date().toISOString();

    try {
      if (action === 'viewed') {
        // Para 'viewed', preservar dismissed_at si ya existia
        const { data: existing } = await client
          .from('notificaciones_user_state')
          .select('dismissed_at')
          .eq('notificacion_id', notifId)
          .eq('username', username)
          .maybeSingle();

        await client
          .from('notificaciones_user_state')
          .upsert(
            {
              notificacion_id: notifId,
              username,
              visto_at: nowIso,
              dismissed_at: existing?.dismissed_at ?? null,
            },
            { onConflict: 'notificacion_id,username' }
          );
      } else {
        // 'dismissed' — marcar tambien como visto
        await client
          .from('notificaciones_user_state')
          .upsert(
            {
              notificacion_id: notifId,
              username,
              visto_at: nowIso,
              dismissed_at: nowIso,
            },
            { onConflict: 'notificacion_id,username' }
          );
      }
    } catch (supabaseError) {
      // Graceful degradation: loguear pero no bloquear la UX
      console.error('[notificaciones/state] Error al guardar estado (degraded):', supabaseError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[notificaciones/state] Error en POST:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}
