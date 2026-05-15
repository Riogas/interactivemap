import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { isNotifActive, matchesUserRole } from '@/lib/notificaciones-matching';
import type { Notificacion, NotificacionUserState } from '@/types/supabase';

// GET /api/notificaciones/pending
// Devuelve la notificacion mas reciente pendiente para el usuario logueado.
// Query params:
//   roles — comma-separated lista de RolNombre del usuario (ej: "Distribuidor,Dashboard")
//
// Returns: { success, notificacion: Notificacion | null }
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get('x-track-user') || '';
    if (!username) {
      return NextResponse.json({ success: false, error: 'Usuario no autenticado' }, { status: 401 });
    }

    const url = new URL(request.url);
    const rolesParam = url.searchParams.get('roles') || '';
    const userRoles = rolesParam
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => ({ RolNombre: r }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;
    const now = new Date();
    const nowIso = now.toISOString();

    // Obtener candidatas: activas y dentro del rango de fechas
    const { data: candidates, error } = await client
      .from('notificaciones')
      .select(`
        *,
        notificaciones_user_state!left (
          notificacion_id,
          username,
          dismissed_at
        )
      `)
      .eq('activa', true)
      .lte('fecha_inicio', nowIso)
      .gte('fecha_fin', nowIso)
      .order('created_at', { ascending: false })
      .limit(50); // tomar mas que suficientes para filtrar

    if (error) {
      console.error('[notificaciones/pending] GET error:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener notificaciones pendientes' },
        { status: 500 }
      );
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ success: true, notificacion: null });
    }

    // Filtrar en JS: excluir dismissed por este usuario y verificar roles
    let found: Notificacion | null = null;

    for (const notif of candidates) {
      const states: NotificacionUserState[] = notif.notificaciones_user_state || [];

      // Verificar si ya fue dismissed por este usuario
      const userState = states.find(
        (s: NotificacionUserState) => s.username === username
      );
      if (userState?.dismissed_at) continue;

      // Verificar roles (si no se pasaron roles, no matchea a nadie)
      if (userRoles.length === 0) continue;
      if (!matchesUserRole(notif, userRoles)) continue;

      // Extra check: isNotifActive por si el index no filtro perfectamente
      if (!isNotifActive(notif, now)) continue;

      found = notif;
      break;
    }

    // Limpiar el campo de join del objeto devuelto
    if (found) {
      const { notificaciones_user_state: _, ...notifClean } = found as Notificacion & { notificaciones_user_state: unknown };
      return NextResponse.json({ success: true, notificacion: notifClean });
    }

    return NextResponse.json({ success: true, notificacion: null });
  } catch (error) {
    console.error('[notificaciones/pending] Error en GET:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}
