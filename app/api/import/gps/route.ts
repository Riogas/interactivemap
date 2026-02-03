import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Transforma campos del body a formato de base de datos
 */
function transformGpsToSupabase(gps: any) {
  return {
    // IDs y referencias
    movil_id: gps.movil || gps.movil_id,
    pedido_id: gps.pedido_id || null,
    escenario: gps.escenario || gps.escenarioid || gps.escenario_id || null,
    device_id: gps.device_id || gps.deviceId || null,
    usuario: gps.usuario || null,
    
    // Ubicación básica
    latitud: gps.latitud,
    longitud: gps.longitud,
    utm_x: gps.utm_x || null,
    utm_y: gps.utm_y || null,
    
    // Precisión GPS
    accuracy: gps.accuracy || null,
    altitude: gps.altitude || null,
    bearing: gps.bearing || null,
    provider: gps.provider || null,
    speed_accuracy: gps.speed_accuracy || null,
    is_mock_location: gps.is_mock_location || false,
    location_age_ms: gps.location_age_ms || null,
    
    // Satélites
    satellites_used: gps.satellites_used || null,
    satellites_total: gps.satellites_total || null,
    satellites_avg_snr: gps.satellites_avg_snr || null,
    
    // Movimiento
    velocidad: gps.velocidad || null,
    distancia_recorrida: gps.distancia_recorrida || null,
    movement_type: gps.movement_type || null,
    
    // App
    app_state: gps.app_state || null,
    app_version: gps.app_version || null,
    
    // Permisos
    permission_fine_location: gps.permission_fine_location || false,
    permission_coarse_location: gps.permission_coarse_location || false,
    permission_background_location: gps.permission_background_location || false,
    notifications_enabled: gps.notifications_enabled || false,
    gps_enabled: gps.gps_enabled !== false, // default true
    
    // Batería
    battery_level: gps.battery_level || null,
    battery_charging: gps.battery_charging || false,
    battery_status: gps.battery_status || null,
    battery_saver_on: gps.battery_saver_on || false,
    battery_optimization_ignored: gps.battery_optimization_ignored || false,
    doze_mode_active: gps.doze_mode_active || false,
    
    // Red
    network_type: gps.network_type || null,
    network_connected: gps.network_connected || false,
    
    // Device
    device_manufacturer: gps.device_manufacturer || null,
    device_model: gps.device_model || null,
    device_brand: gps.device_brand || null,
    android_version: gps.android_version || null,
    android_release: gps.android_release || null,
    
    // Memoria
    memory_available_mb: gps.memory_available_mb || null,
    memory_total_mb: gps.memory_total_mb || null,
    memory_low: gps.memory_low || false,
    
    // Ejecución
    execution_counter: gps.execution_counter || null,
    last_reset_reason: gps.last_reset_reason || null,
    
    // Timestamps
    fecha_hora: gps.timestamp_local || gps.fecha_hora || new Date().toISOString(),
    timestamp_local: gps.timestamp_local || null,
    timestamp_utc: gps.timestamp_utc || null,
  };
}

/**
 * POST /api/import/gps
 * Insertar registros de GPS tracking
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { gps } = body;

    // Si no viene "gps", asumir que el body ES el registro GPS
    if (!gps) {
      gps = body;
    }

    // Normalizar a array si es un solo objeto
    const gpsArray = Array.isArray(gps) ? gps : [gps];

    if (gpsArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un registro GPS' },
        { status: 400 }
      );
    }

    console.log(`📍 Insertando ${gpsArray.length} registro(s) GPS...`);

    // Transformar campos a formato Supabase
    const transformedGps = gpsArray.map(transformGpsToSupabase);

    const { data, error } = await supabase
      .from('gps_tracking_extended')
      .insert(transformedGps)
      .select();

    if (error) {
      console.error('❌ Error al insertar GPS:', error);
      return NextResponse.json(
        { error: 'Error al insertar GPS', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} registros GPS insertados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} registros GPS insertados correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import/gps
 * Eliminar registros GPS por IDs
 */
export async function DELETE(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { gps_ids } = body;

    if (!gps_ids || !Array.isArray(gps_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de gps_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${gps_ids.length} registros GPS...`);

    const { data, error } = await supabase
      .from('gps_tracking_extended')
      .delete()
      .in('id', gps_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar GPS:', error);
      return NextResponse.json(
        { error: 'Error al eliminar GPS', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} registros GPS eliminados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} registros GPS eliminados correctamente`,
      deleted_count: data?.length || 0,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
