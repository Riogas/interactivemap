import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { successResponse, errorResponse, logRequest } from '@/lib/api-response';
import { requireApiKey } from '@/lib/auth-middleware';
import {
  isValidLatLng,
  selectMovilesNeedingDailyPosition,
  buildHistoryInsertRows,
  type MovilCandidate,
} from '@/lib/import-helpers/gps-autocreate';

/**
 * Lee el body del request respetando el charset del Content-Type.
 * GeneXus/AS400 envía Latin-1 (ISO-8859-1) — request.text() siempre
 * decodifica como UTF-8 y corrompe caracteres como ñ, á, é, etc.
 */
async function readRequestBody(request: NextRequest): Promise<string> {
  const contentType = request.headers.get('content-type') || '';
  const charsetMatch = contentType.match(/charset=([\w-]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'iso-8859-1'; // GeneXus/AS400 raramente especifica charset
  
  if (charset === 'utf-8' || charset === 'utf8') {
    return await request.text();
  }
  
  // Latin-1, ISO-8859-1, Windows-1252, etc.
  const buffer = await request.arrayBuffer();
  const decoder = new TextDecoder(charset);
  const decoded = decoder.decode(buffer);
  console.log(`🔤 Body decodificado con charset: ${charset}`);
  return decoded;
}

/**
 * Intenta reparar JSON con comillas sin escapar dentro de valores string.
 * GeneXus/AS400 a veces envía: "Nombre":"TEXTO "CON COMILLAS"" 
 * que rompe JSON.parse().
 * 
 * Estrategia: usa la posición del error para encontrar la comilla
 * interna que rompió el parseo, la escapa, y reintenta.
 */
function safeParseJSON(rawBody: string): any {
  try {
    return JSON.parse(rawBody);
  } catch (firstError) {
    console.warn('⚠️  JSON.parse falló, intentando sanitizar comillas internas...');
    
    let text = rawBody;
    const maxAttempts = 50;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = JSON.parse(text);
        console.log(`✅ JSON reparado después de ${attempt + 1} correcciones`);
        return result;
      } catch (err: any) {
        // Extraer la posición del error
        const posMatch = err.message.match(/position\s+(\d+)/);
        if (!posMatch) throw firstError;
        
        const errorPos = parseInt(posMatch[1], 10);
        
        // Buscar la comilla sin escapar más cercana ANTES de errorPos
        let fixPos = -1;
        for (let i = errorPos - 1; i >= 0; i--) {
          if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
            fixPos = i;
            break;
          }
        }
        
        if (fixPos < 0) throw firstError;
        
        console.log(`🔧 Escapando comilla en posición ${fixPos} (intento ${attempt + 1})`);
        // Insertar \ antes de la comilla para escaparla
        text = text.substring(0, fixPos) + '\\' + text.substring(fixPos);
      }
    }
    
    throw firstError;
  }
}

/**
 * Transforma campos de PascalCase a snake_case para Supabase
 * 
 * DEFAULTS:
 * - empresa_fletera_id: 999 (empresa genérica "Sin Empresa")
 * - descripcion: "Móvil {ID}"
 * - escenario_id: 1000
 */
/**
 * Sanitiza un valor que puede venir como número, string o NaN/0/fuera de rango
 * y lo devuelve como número válido o null.
 * Reglas: NaN → null, 0 → null (AS400 manda 0 como "sin valor"),
 * fuera de rango lat/lng → null. Acepta strings parseables.
 */
function parseLatLngOrNull(raw: unknown, kind: 'lat' | 'lng'): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  if (kind === 'lat' && (n < -90 || n > 90)) return null;
  if (kind === 'lng' && (n < -180 || n > 180)) return null;
  return n;
}

function transformMovilToSupabase(movil: any) {
  // Detectar empresa fletera con fallback a 999 "Sin Empresa"
  const empresaFleteraId = movil.EFleteraId ?? movil.empresa_fletera_id ?? 999;

  // Sanitizar fechas: AS400 envía fechas inválidas como "0000-00-00T00:00:00" o "100-00-01T00:00:00"
  const parseDate = (dateStr: string | null | undefined) => {
    if (!dateStr || dateStr.startsWith('0000-00-00') || dateStr === '0') return null;
    // Rechazar años menores a 1900 o mayores a 2100 (basura de AS400)
    const yearMatch = dateStr.match(/^(\d{1,4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (year < 1900 || year > 2100) return null;
    }
    return dateStr;
  };
  
  return {
    id: movil.id || movil.IdentificadorId?.toString() || movil.Nro?.toString() || movil.nro?.toString(),
    descripcion: movil.Descripcion || movil.descripcion || `Móvil ${movil.IdentificadorId || movil.Nro || movil.nro || movil.id}`,
    detalle_html: movil.DetalleHTML || movil.detalle_html || '',
    distancia_max_mts_cump_pedidos: movil.DistanciaMaxMtsCumpPedidos ?? movil.distancia_max_mts_cump_pedidos ?? 0,
    empresa_fletera_id: empresaFleteraId, // 999 por defecto si no viene
    empresa_fletera_nom: movil.EFleteraNom || movil.empresa_fletera_nom,
    escenario_id: movil.escenario ?? movil.EscenarioId ?? movil.escenario_id ?? 1000,
    estado_desc: movil.EstadoDesc || movil.estado_desc || '',
    estado_nro: movil.EstadoNro ?? movil.estado_nro ?? 0,
    fch_hora_mov: parseDate(movil.FchHoraMov || movil.fch_hora_mov),
    fch_hora_upd_firestore: parseDate(movil.FchHoraUPDFireStore || movil.fch_hora_upd_firestore),
    matricula: movil.Matricula || movil.matricula,
    mostrar_en_mapa: movil.MostrarEnMapa === 'S' || movil.mostrar_en_mapa === true,
    nro: movil.Nro ?? movil.IdentificadorId ?? movil.nro,
    obs: movil.Obs || movil.obs || '',
    pedidos_pendientes: movil.PedidosPendientes ?? movil.pedidos_pendientes ?? 0,
    permite_baja_momentanea: movil.PermiteBajaMomentanea === 'S' || movil.permite_baja_momentanea === true,
    print_screen: movil.PrintScreen === 'S' || movil.print_screen === true,
    se_puede_activar_desde_la_app: movil.SePuedeActivarDesdeLaApp === 'S' || movil.se_puede_activar_desde_la_app === true,
    se_puede_desactivar_desde_la_app: movil.SePuedeDesactivarDesdeLaApp === 'S' || movil.se_puede_desactivar_desde_la_app === true,
    tamano_lote: movil.TamanoLote ?? movil.tamano_lote,
    visible_en_app: movil.VisibleEnApp === 'S' || movil.visible_en_app === true,
    debug_mode: movil.debugMode ?? movil.debug_mode ?? false,
    gps_n8n: movil.gpsN8n ?? movil.gps_n8n ?? false,
    grabar_pantalla: movil.grabarPantalla ?? movil.grabar_pantalla ?? false,
    pto_vta_lat: parseLatLngOrNull(movil.ptoVtaX ?? movil.pto_vta_lat, 'lat'),
    pto_vta_lng: parseLatLngOrNull(movil.ptoVtaY ?? movil.pto_vta_lng, 'lng'),
  };
}

/**
 * Best-effort: para los móviles transformados que tengan pto_vta_lat/lng válidos,
 * verifica si ya tienen registro del día en gps_latest_positions (TZ Montevideo).
 * Los que falten reciben un INSERT a gps_tracking_history — el trigger
 * sync_gps_latest_position se encarga del upsert. Errores no abortan el import.
 *
 * @returns cantidad de móviles para los que se intentó autocrear posición.
 */
async function maybeAutocreateGpsForToday(
  movilesUpserted: ReadonlyArray<{
    id: string;
    escenario_id: number;
    pto_vta_lat: number | null;
    pto_vta_lng: number | null;
  }>
): Promise<number> {
  try {
    const candidatos: MovilCandidate[] = [];
    for (const m of movilesUpserted) {
      if (!m?.id) continue;
      if (!isValidLatLng(m.pto_vta_lat, m.pto_vta_lng)) continue;
      candidatos.push({
        movil_id: String(m.id),
        escenario_id: Number(m.escenario_id),
        lat: Number(m.pto_vta_lat),
        lng: Number(m.pto_vta_lng),
      });
    }
    if (candidatos.length === 0) return 0;

    const needing = await selectMovilesNeedingDailyPosition(supabase as any, candidatos);
    if (needing.length === 0) return 0;

    const rows = buildHistoryInsertRows(needing);
    const { error } = await supabase
      .from('gps_tracking_history')
      .insert(rows as any);
    if (error) {
      console.error('[gps-autocreate] insert gps_tracking_history falló', error);
      return 0;
    }
    console.log(`✅ [gps-autocreate] insertados ${rows.length} registros iniciales del día`);
    return rows.length;
  } catch (err) {
    console.error('[gps-autocreate] error inesperado', err);
    return 0;
  }
}

/**
 * POST /api/import/moviles
 * Importar móviles desde fuente externa (GeneXus)
 * 
 * @returns 200 - Móviles importados correctamente
 * @returns 400 - Datos de entrada inválidos
 * @returns 500 - Error del servidor o base de datos
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log('\n' + '='.repeat(80));
  console.log(`🚀 [${timestamp}] POST /api/import/moviles - INICIO`);
  console.log('='.repeat(80));

  try {
    // PASO 1: Verificar headers de la petición
    console.log('\n📋 PASO 1: Headers de la petición');
    console.log('----------------------------------------');
    const headers = {
      'content-type': request.headers.get('content-type'),
      'accept': request.headers.get('accept'),
      'origin': request.headers.get('origin'),
      'user-agent': request.headers.get('user-agent'),
      'authorization': request.headers.get('authorization') ? '***PRESENTE***' : 'NO PRESENTE',
    };
    console.log(JSON.stringify(headers, null, 2));

    // PASO 2: Intentar parsear el body
    console.log('\n📦 PASO 2: Parseando body JSON');
    console.log('----------------------------------------');
    let body;
    let rawBody = '';
    try {
      rawBody = await readRequestBody(request);
      console.log('Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      console.log('Longitud total del body:', rawBody.length, 'caracteres');
      
      body = safeParseJSON(rawBody);
      console.log('✅ JSON parseado correctamente');
      console.log('Claves en el body:', Object.keys(body));
    } catch (parseError: any) {
      console.error('❌ ERROR al parsear JSON:', parseError.message);
      console.error('Stack trace:', parseError.stack);
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { 
          originalError: parseError.message,
          receivedBodyLength: rawBody.length,
          receivedBodyPreview: rawBody.substring(0, 200)
        }
      );
    }

    logRequest('POST', '/api/import/moviles', body);

    // PASO 3: Extraer móviles del body
    console.log('\n🔍 PASO 3: Extrayendo móviles del body');
    console.log('----------------------------------------');
    let { moviles } = body;

    // Si no viene "moviles", asumir que el body ES el movil
    if (!moviles) {
      console.log('⚠️  No se encontró clave "moviles", asumiendo que el body ES el móvil');
      moviles = body;
    } else {
      console.log(`✅ Clave "moviles" encontrada`);
    }

    // Normalizar a array si es un solo objeto
    const movilesArray = Array.isArray(moviles) ? moviles : [moviles];
    console.log(`📊 Cantidad de móviles a procesar: ${movilesArray.length}`);

    // PASO 4: Validación
    console.log('\n✔️  PASO 4: Validación de datos');
    console.log('----------------------------------------');
    if (movilesArray.length === 0) {
      console.error('❌ VALIDACIÓN FALLIDA: Array de móviles vacío');
      return errorResponse(
        'Se requiere al menos un móvil en el body',
        400,
        { 
          received: body,
          movilesExtracted: moviles,
          movilesArrayLength: movilesArray.length
        }
      );
    }
    console.log('✅ Validación exitosa');

    // PASO 5: Resumen de móviles recibidos (verbose detallado solo en DEBUG).
    console.log(`\n📥 PASO 5: ${movilesArray.length} móviles recibidos`);
    if (process.env.IMPORT_VERBOSE === '1') {
      movilesArray.forEach((movil, index) => {
        console.log(`Móvil #${index + 1}:`, JSON.stringify(movil, null, 2));
      });
    }

    // PASO 6: Transformar datos (sin loguear cada uno — es O(n) de string alloc).
    console.log('\n🔄 PASO 6: Transformando');
    const transformedMoviles = movilesArray.map(transformMovilToSupabase);
    console.log(`✅ Transformados ${transformedMoviles.length}`);

    // PASO 7: Insertar/Actualizar en Supabase (UPSERT)
    console.log('\n💾 PASO 7: Insertando/Actualizando en Supabase (UPSERT)');
    console.log('----------------------------------------');
    console.log('Conectando a Supabase...');
    console.log('🔄 Usando UPSERT - Si existe actualiza, si no existe inserta');
    
    const { data, error } = await supabase
      .from('moviles')
      .upsert(transformedMoviles as any, {
        onConflict: 'escenario_id,id', // PK compuesta
        ignoreDuplicates: false // Actualizar si existe
      })
      .select();

    // PASO 8: Verificar resultado de Supabase
    console.log('\n🔍 PASO 8: Verificando resultado de Supabase');
    console.log('----------------------------------------');
    if (error) {
      console.error('❌ ERROR DE SUPABASE:');
      console.error('  - Mensaje:', error.message);
      console.error('  - Código:', error.code);
      console.error('  - Detalles:', error.details);
      console.error('  - Hint:', error.hint);
      console.error('  - Error completo:', JSON.stringify(error, null, 2));
      
      return errorResponse(
        'Error al insertar/actualizar móviles en la base de datos',
        500,
        {
          supabaseError: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        }
      );
    }

    console.log('✅ UPSERT exitoso en Supabase');
    console.log('📊 Registros procesados:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('📋 IDs procesados:', data.map((m: any) => m.id).join(', '));
    }

    // Autocreación GPS del día a partir del punto de venta del móvil (best-effort)
    const gpsAutocreatedCount = await maybeAutocreateGpsForToday(transformedMoviles);

    // PASO 9: Preparar respuesta exitosa
    console.log('\n📤 PASO 9: Preparando respuesta');
    console.log('----------------------------------------');
    const responseData = {
      count: data?.length || 0,
      gps_autocreated_count: gpsAutocreatedCount,
      moviles: data,
    };
    const message = `${data?.length || 0} móvil(es) importado(s)/actualizado(s) correctamente`;
    
    console.log('Respuesta a enviar:');
    console.log('  - Success: true');
    console.log('  - Message:', message);
    console.log('  - Status Code: 200');
    console.log('  - Count:', responseData.count);

    console.log('\n' + '='.repeat(80));
    console.log(`✅ POST /api/import/moviles - ÉXITO (UPSERT)`);
    console.log('='.repeat(80) + '\n');
    
    return successResponse(responseData, message, 200);
    
  } catch (error: any) {
    console.log('\n' + '='.repeat(80));
    console.error(`💥 POST /api/import/moviles - ERROR INESPERADO`);
    console.log('='.repeat(80));
    console.error('Tipo de error:', error.constructor.name);
    console.error('Mensaje:', error.message);
    console.error('Stack trace completo:');
    console.error(error.stack);
    console.log('='.repeat(80) + '\n');
    
    // Error al parsear JSON
    if (error instanceof SyntaxError) {
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { originalError: error.message }
      );
    }

    // Error genérico
    return errorResponse(
      'Error interno del servidor',
      500,
      {
        errorType: error.constructor.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }
    );
  }
}

/**
 * PUT /api/import/moviles
 * Actualizar móviles existentes (upsert)
 * 
 * @returns 200 - Móviles actualizados correctamente
 * @returns 400 - Datos de entrada inválidos
 * @returns 500 - Error del servidor o base de datos
 */
export async function PUT(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    let rawBody = '';
    let body;
    try {
      rawBody = await readRequestBody(request);
      body = safeParseJSON(rawBody);
    } catch (parseError: any) {
      console.error('❌ ERROR al parsear JSON en PUT /api/import/moviles:', parseError.message);
      console.error('📛 Body RAW completo:', rawBody);
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { originalError: parseError.message, bodyPreview: rawBody.substring(0, 500) }
      );
    }
    logRequest('PUT', '/api/import/moviles', body);

    let { moviles } = body;

    // Si no viene "moviles", asumir que el body ES el movil
    if (!moviles) {
      moviles = body;
    }

    // Normalizar a array si es un solo objeto
    const movilesArray = Array.isArray(moviles) ? moviles : [moviles];

    // Validación
    if (movilesArray.length === 0) {
      return errorResponse(
        'Se requiere al menos un móvil para actualizar',
        400
      );
    }

    console.log(`🔄 Actualizando ${movilesArray.length} móvil(es)...`);

    // Transformar campos a formato Supabase
    const transformedMoviles = movilesArray.map(transformMovilToSupabase);

    // Upsert: Insertar o actualizar si ya existe
    const { data, error } = await supabase
      .from('moviles')
      .upsert(transformedMoviles as any, {
        onConflict: 'escenario_id,id', // PK compuesta
      })
      .select();

    // Manejo de error de Supabase
    if (error) {
      console.error('❌ Error de Supabase:', error);
      return errorResponse(
        'Error al actualizar móviles en la base de datos',
        500,
        {
          supabaseError: error.message,
          code: error.code,
        }
      );
    }

    // Éxito
    console.log(`✅ ${data?.length || 0} móviles actualizados exitosamente`);

    // Autocreación GPS del día a partir del punto de venta del móvil (best-effort)
    const gpsAutocreatedCount = await maybeAutocreateGpsForToday(transformedMoviles);

    return successResponse(
      {
        count: data?.length || 0,
        gps_autocreated_count: gpsAutocreatedCount,
        moviles: data,
      },
      `${data?.length || 0} móvil(es) actualizado(s) correctamente`,
      200
    );
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    
    if (error instanceof SyntaxError) {
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { originalError: error.message }
      );
    }

    return errorResponse(
      'Error interno del servidor',
      500,
      {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }
    );
  }
}

/**
 * DELETE /api/import/moviles
 * Eliminar móviles por IDs
 * 
 * @returns 200 - Móviles eliminados correctamente
 * @returns 400 - Datos de entrada inválidos
 * @returns 500 - Error del servidor o base de datos
 */
export async function DELETE(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    logRequest('DELETE', '/api/import/moviles', body);

    const { movil_ids } = body;

    // Validación
    if (!movil_ids || !Array.isArray(movil_ids)) {
      return errorResponse(
        'Se requiere un array de movil_ids',
        400,
        { received: body }
      );
    }

    if (movil_ids.length === 0) {
      return errorResponse(
        'El array de movil_ids no puede estar vacío',
        400
      );
    }

    console.log(`🗑️ Eliminando ${movil_ids.length} móviles...`);

    const { data, error } = await supabase
      .from('moviles')
      .delete()
      .in('id', movil_ids)
      .select();

    // Manejo de error de Supabase
    if (error) {
      console.error('❌ Error de Supabase:', error);
      return errorResponse(
        'Error al eliminar móviles de la base de datos',
        500,
        {
          supabaseError: error.message,
          code: error.code,
        }
      );
    }

    // Éxito
    console.log(`✅ ${data?.length || 0} móviles eliminados exitosamente`);
    
    return successResponse(
      {
        deleted_count: data?.length || 0,
        moviles: data,
      },
      `${data?.length || 0} móvil(es) eliminado(s) correctamente`,
      200
    );
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    
    if (error instanceof SyntaxError) {
      return errorResponse(
        'JSON inválido en el body de la petición',
        400,
        { originalError: error.message }
      );
    }

    return errorResponse(
      'Error interno del servidor',
      500,
      {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }
    );
  }
}
