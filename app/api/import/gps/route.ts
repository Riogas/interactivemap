import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Importa un móvil desde el servicio de sincronización de GeneXus
 * cuando no existe en la base de datos
 */
async function importMovilFromGeneXus(movilId: number): Promise<boolean> {
  try {
    console.log(`🔄 Importando móvil ${movilId} desde GeneXus...`);
    
    // Usar la URL de producción (no dev)
    const importUrl = 'https://sgm.glp.riogas.com.uy/tracking/importacion';
    
    const payload = {
      EscenarioId: 1000,
      IdentificadorId: movilId,
      Accion: 'Publicar',
      Entidad: 'Moviles',
      ProcesarEn: 1,
    };
    
    console.log(`📤 Enviando a ${importUrl}:`, JSON.stringify(payload));
    
    // 🔧 TIMEOUT: 30 segundos para importación desde GeneXus
    const response = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30 segundos
    });

    const responseText = await response.text();
    console.log(`📥 Respuesta (${response.status}):`, responseText.substring(0, 200));

    if (!response.ok) {
      console.error(`❌ Error al importar móvil ${movilId}: HTTP ${response.status}`);
      console.error(`📄 Respuesta completa:`, responseText);
      
      // Si falla la importación de GeneXus, crear un registro básico en Supabase
      console.log(`⚠️ Creando registro básico del móvil ${movilId} en Supabase...`);
      const { error: insertError } = await supabase
        .from('moviles')
        .upsert({
          id: movilId.toString(),
          nro: movilId,
          descripcion: `Móvil ${movilId}`,
          empresa_fletera_id: 0,
          mostrar_en_mapa: true,
          estado_nro: 1,
        }, {
          onConflict: 'id'
        });
      
      if (insertError) {
        console.error(`❌ Error al crear registro básico:`, insertError);
        return false;
      }
      
      console.log(`✅ Registro básico creado para móvil ${movilId}`);
      return true;
    }

    // Intentar parsear como JSON
    let result;
    try {
      result = JSON.parse(responseText);
      console.log(`✅ Móvil ${movilId} importado exitosamente:`, result);
    } catch {
      console.log(`✅ Móvil ${movilId} importado (respuesta no-JSON):`, responseText.substring(0, 100));
    }
    
    // Espera más tiempo para que se procese la importación (1.5 segundos)
    console.log(`⏱️ Esperando 1500ms para que se procese la importación...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verificar que el móvil ahora existe en Supabase
    const { data: movilExiste } = await supabase
      .from('moviles')
      .select('id, descripcion')
      .eq('id', movilId.toString())
      .single();
    
    if (!movilExiste) {
      console.warn(`⚠️ Móvil ${movilId} importado pero no aparece en Supabase, creando registro básico...`);
      const { error: insertError } = await supabase
        .from('moviles')
        .upsert({
          id: movilId.toString(),
          nro: movilId,
          descripcion: `Móvil ${movilId}`,
          empresa_fletera_id: 0,
          mostrar_en_mapa: true,
          estado_nro: 1,
        }, {
          onConflict: 'id'
        });
      
      if (insertError) {
        console.error(`❌ Error al crear registro básico:`, insertError);
        return false;
      }
      
      console.log(`✅ Registro básico creado para móvil ${movilId}`);
    } else {
      console.log(`✅ Móvil ${movilId} existe en Supabase:`, movilExiste);
    }
    
    return true;
  } catch (error: any) {
    console.error(`❌ Error al importar móvil ${movilId}:`, error);
    console.error(`❌ Error stack:`, error.stack);
    return false;
  }
}

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
 * 
 * AUTENTICACIÓN:
 * - Opción 1: Header X-API-Key (para uso interno)
 * - Opción 2: Token en el body (para app móvil)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { gps, token } = body;
    
    // 🔒 AUTENTICACIÓN FLEXIBLE
    // Opción 1: Validar API Key en header (uso interno)
    const hasApiKey = request.headers.get('X-API-Key') === process.env.INTERNAL_API_KEY;
    
    // Opción 2: Validar token en body (app móvil)
    const hasValidToken = token && token === process.env.GPS_TRACKING_TOKEN;
    
    if (!hasApiKey && !hasValidToken) {
      console.warn('⚠️ Intento de acceso sin autenticación válida a /api/import/gps');
      return NextResponse.json(
        { error: 'No autorizado. Se requiere X-API-Key en header o token en body.' },
        { status: 403 }
      );
    }
    
    console.log(`✅ Autenticación exitosa (${hasApiKey ? 'API Key' : 'Token'})`);
    
    // Continuar con la lógica normal

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

    // Intentar insertar
    let { data, error } = await supabase
      .from('gps_tracking_extended')
      .insert(transformedGps)
      .select();

    // Si hay error de foreign key (móvil no existe)
    if (error && error.code === '23503' && error.message.includes('fk_gps_movil')) {
      console.warn('⚠️ Error de integridad referencial detectado - móvil no existe');
      
      // Extraer el ID del móvil del mensaje de error
      // Ejemplo: 'Key (movil_id)=(994) is not present in table "moviles".'
      const match = error.details?.match(/\(movil_id\)=\((\d+)\)/);
      
      if (match && match[1]) {
        const movilId = parseInt(match[1]);
        console.log(`🔍 Móvil faltante identificado: ${movilId}`);
        
        // Intentar importar el móvil desde GeneXus
        const imported = await importMovilFromGeneXus(movilId);
        
        if (imported) {
          console.log(`🔄 Reintentando inserción de GPS después de importar móvil ${movilId}...`);
          
          // Reintentar la inserción
          const retryResult = await supabase
            .from('gps_tracking_extended')
            .insert(transformedGps)
            .select();
          
          data = retryResult.data;
          error = retryResult.error;
          
          if (!retryResult.error) {
            console.log(`✅ Inserción exitosa después de importar móvil ${movilId}`);
          } else {
            console.error(`❌ Error al reintentar inserción:`, retryResult.error);
          }
        } else {
          console.error(`❌ No se pudo importar el móvil ${movilId}`);
        }
      } else {
        console.error('❌ No se pudo extraer el ID del móvil del error');
      }
    }

    // Si todavía hay error después del reintento
    if (error) {
      console.error('❌ Error al insertar GPS:', error);
      return NextResponse.json(
        { 
          error: 'Error al insertar GPS', 
          details: error.message,
          code: error.code,
          hint: error.hint 
        },
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
 * 
 * AUTENTICACIÓN:
 * - Opción 1: Header X-API-Key (para uso interno)
 * - Opción 2: Token en el body (para app móvil)
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { gps_ids, token } = body;
    
    // 🔒 AUTENTICACIÓN FLEXIBLE
    const hasApiKey = request.headers.get('X-API-Key') === process.env.INTERNAL_API_KEY;
    const hasValidToken = token && token === process.env.GPS_TRACKING_TOKEN;
    
    if (!hasApiKey && !hasValidToken) {
      console.warn('⚠️ Intento de acceso sin autenticación válida a DELETE /api/import/gps');
      return NextResponse.json(
        { error: 'No autorizado. Se requiere X-API-Key en header o token en body.' },
        { status: 403 }
      );
    }
    
    console.log(`✅ Autenticación exitosa (${hasApiKey ? 'API Key' : 'Token'})`);


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
