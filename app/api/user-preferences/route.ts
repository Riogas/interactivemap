import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * Mapeo de campos: UserPreferences (camelCase) ↔ DB columns (snake_case)
 */
function preferencesToDb(prefs: Record<string, any>) {
  // Campos mapeados a columnas individuales
  const mapped = {
    moviles_visible: prefs.movilesVisible ?? true,
    pedidos_visible: prefs.pedidosVisible ?? true,
    services_visible: prefs.servicesVisible ?? true,
    data_view_mode: prefs.dataViewMode ?? 'normal',
    default_map_layer: prefs.defaultMapLayer ?? 'streets',
    show_active_moviles_only: prefs.showActiveMovilesOnly ?? false,
    max_coordinate_delay_min: prefs.maxCoordinateDelayMinutes ?? 30,
    realtime_enabled: prefs.realtimeEnabled ?? true,
    show_route_animation: prefs.showRouteAnimation ?? true,
    show_completed_markers: prefs.showCompletedMarkers ?? true,
    movil_marker_style: prefs.markerStyle ?? 'normal',
    pedido_marker_style: prefs.pedidoMarkerStyle ?? 'normal',
    movil_shape: prefs.movilShape ?? 'circle',
    pedido_shape: prefs.pedidoShape ?? 'square',
    service_shape: prefs.serviceShape ?? 'triangle',
    pedidos_cluster: prefs.pedidosCluster ?? true,
    show_demora_labels: prefs.showDemoraLabels ?? false,
  };

  // Campos extra guardados como JSON en preferences_extra
  const extra: Record<string, any> = {};
  const extraKeys = [
    'zonaOpacity', 'nightStartHour', 'dayStartHour',
    'poisVisible', 'hiddenPoiCategories', 'poiMarkerSize', 'poiDefaultIcon',
    'demorasPollingSeconds', 'movilesZonasPollingSeconds',
    'lightMode', 'serviceMarkerStyle',
    'movilHalo', 'pedidoHalo', 'serviceHalo', 'zonaPattern',
  ];
  for (const key of extraKeys) {
    if (prefs[key] !== undefined) extra[key] = prefs[key];
  }

  return { ...mapped, preferences_extra: Object.keys(extra).length > 0 ? extra : null };
}

function dbToPreferences(row: Record<string, any>) {
  const base = {
    movilesVisible: row.moviles_visible,
    pedidosVisible: row.pedidos_visible,
    servicesVisible: row.services_visible,
    dataViewMode: row.data_view_mode,
    defaultMapLayer: row.default_map_layer,
    showActiveMovilesOnly: row.show_active_moviles_only,
    maxCoordinateDelayMinutes: row.max_coordinate_delay_min,
    realtimeEnabled: row.realtime_enabled,
    showRouteAnimation: row.show_route_animation,
    showCompletedMarkers: row.show_completed_markers,
    markerStyle: row.movil_marker_style,
    pedidoMarkerStyle: row.pedido_marker_style,
    movilShape: row.movil_shape,
    pedidoShape: row.pedido_shape,
    serviceShape: row.service_shape,
    pedidosCluster: row.pedidos_cluster,
    showDemoraLabels: row.show_demora_labels,
  };

  // Merge campos extra (si existen)
  const extra = row.preferences_extra ?? {};
  return { ...base, ...extra };
}

/**
 * GET /api/user-preferences?user_id=xxx
 * Obtener preferencias del usuario
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('user_id');
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id es requerido' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found (not an error, just no prefs yet)
      console.error('❌ Error al obtener preferencias:', error);
      return NextResponse.json(
        { error: 'Error al obtener preferencias', details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      // No preferences yet — return null so frontend uses defaults
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: dbToPreferences(data),
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en GET user-preferences:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user-preferences
 * Guardar/actualizar preferencias del usuario (upsert)
 * Body: { user_id: string, preferences: UserPreferences }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, preferences } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: 'user_id es requerido' },
        { status: 400 }
      );
    }

    if (!preferences) {
      return NextResponse.json(
        { error: 'preferences es requerido' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();
    const dbData = preferencesToDb(preferences);

    const { data, error } = await (supabase as any)
      .from('user_preferences')
      .upsert(
        { user_id, ...dbData },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('❌ Error al guardar preferencias:', error);
      return NextResponse.json(
        { error: 'Error al guardar preferencias', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: dbToPreferences(data),
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en PUT user-preferences:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
