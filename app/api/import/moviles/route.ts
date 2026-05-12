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
import { importLog, importWarn, importError, importDebug } from '@/lib/logger';
import { recomputeMovilCounters } from '@/lib/movil-counters';

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
  importLog(`🔤 Body decodificado con charset: ${charset}`);
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
    importWarn('⚠️  JSON.parse falló, intentando sanitizar comillas internas...');

    let text = rawBody;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = JSON.parse(text);
        importLog(`✅ JSON reparado después de ${attempt + 1} correcciones`);
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

        importLog(`🔧 Escapando comilla en posición ${fixPos} (intento ${attempt + 1})`);
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
    importDebug(`[gps-autocreate] candidatos con pto_vta: ${candidatos.length}`);
    if (needing.length === 0) {
      importLog('[gps-autocreate] todos los candidatos ya tienen GPS del día — nada que autocrear');
      return 0;
    }
    importLog(`[gps-autocreate] ${needing.length}/${candidatos.length} móvil(es) necesitan seed del día`);
    needing.forEach((c) => importDebug(`  → seed movil_id=${c.movil_id} (${c.lat}, ${c.lng})`));

    const rows = buildHistoryInsertRows(needing);
    const { error } = await supabase
      .from('gps_tracking_history')
      .insert(rows as any);
    if (error) {
      importError('[gps-autocreate] insert gps_tracking_history falló', error);
      return 0;
    }
    importLog(`✅ [gps-autocreate] insertados ${rows.length} registros iniciales del día`);
    return rows.length;
  } catch (err) {
    importError('[gps-autocreate] error inesperado', err);
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
  importLog('\n' + '='.repeat(80));
  importLog(`🚀 [${timestamp}] POST /api/import/moviles - INICIO`);
  importLog('='.repeat(80));

  try {
    // PASO 1: Verificar headers de la petición
    importLog('\n📋 PASO 1: Headers de la petición');
    importLog('----------------------------------------');
    const headers = {
      'content-type': request.headers.get('content-type'),
      'accept': request.headers.get('accept'),
      'origin': request.headers.get('origin'),
      'user-agent': request.headers.get('user-agent'),
      'authorization': request.headers.get('authorization') ? '***PRESENTE***' : 'NO PRESENTE',
    };
    importLog(JSON.stringify(headers, null, 2));

    // PASO 2: Intentar parsear el body
    importLog('\n📦 PASO 2: Parseando body JSON');
    importLog('----------------------------------------');
    let body;
    let rawBody = '';
    try {
      rawBody = await readRequestBody(request);
      importLog('Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      importLog('Longitud total del body:', rawBody.length, 'caracteres');

      body = safeParseJSON(rawBody);
      importLog('✅ JSON parseado correctamente');
      importLog('Claves en el body:', Object.keys(body));
    } catch (parseError: any) {
      importError('❌ ERROR al parsear JSON:', parseError.message);
      importError('Stack trace:', parseError.stack);
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
    importLog('\n🔍 PASO 3: Extrayendo móviles del body');
    importLog('----------------------------------------');
    let { moviles } = body;

    // Si no viene "moviles", asumir que el body ES el movil
    if (!moviles) {
      importLog('⚠️  No se encontró clave "moviles", asumiendo que el body ES el móvil');
      moviles = body;
    } else {
      importLog(`✅ Clave "moviles" encontrada`);
    }

    // Normalizar a array si es un solo objeto
    const movilesArray = Array.isArray(moviles) ? moviles : [moviles];
    importLog(`📊 Cantidad de móviles a procesar: ${movilesArray.length}`);

    // PASO 4: Validación
    importLog('\n✔️  PASO 4: Validación de datos');
    importLog('----------------------------------------');
    if (movilesArray.length === 0) {
      importError('❌ VALIDACIÓN FALLIDA: Array de móviles vacío');
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
    importLog('✅ Validación exitosa');

    // PASO 5: Resumen de móviles recibidos (verbose detallado solo en DEBUG).
    importLog(`\n📥 PASO 5: ${movilesArray.length} móviles recibidos`);
    if (process.env.IMPORT_VERBOSE === '1') {
      movilesArray.forEach((movil, index) => {
        importLog(`Móvil #${index + 1}:`, JSON.stringify(movil, null, 2));
      });
    }

    // PASO 6: Transformar datos (verbose: shape de cada uno).
    importLog('\n🔄 PASO 6: Transformando');
    const transformedMoviles = movilesArray.map(transformMovilToSupabase);
    importLog(`✅ Transformados ${transformedMoviles.length}`);
    transformedMoviles.forEach((m, i) => {
      importDebug(
        `  [${i + 1}/${transformedMoviles.length}] id=${m.id} esc=${m.escenario_id} ` +
        `empresa=${m.empresa_fletera_id} estado=${m.estado_nro} ` +
        `pto_vta=${m.pto_vta_lat},${m.pto_vta_lng} mapa=${m.mostrar_en_mapa}`
      );
    });

    // PASO 7: Insertar/Actualizar en Supabase (UPSERT)
    importLog('\n💾 PASO 7: Insertando/Actualizando en Supabase (UPSERT)');
    importLog('----------------------------------------');
    importLog('Conectando a Supabase...');
    importLog('🔄 Usando UPSERT - Si existe actualiza, si no existe inserta');

    const { data, error } = await supabase
      .from('moviles')
      .upsert(transformedMoviles as any, {
        onConflict: 'escenario_id,id', // PK compuesta
        ignoreDuplicates: false // Actualizar si existe
      })
      .select();

    // PASO 8: Verificar resultado de Supabase
    importLog('\n🔍 PASO 8: Verificando resultado de Supabase');
    importLog('----------------------------------------');
    if (error) {
      importError('❌ ERROR DE SUPABASE:');
      importError('  - Mensaje:', error.message);
      importError('  - Código:', error.code);
      importError('  - Detalles:', error.details);
      importError('  - Hint:', error.hint);
      importError('  - Error completo:', JSON.stringify(error, null, 2));

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

    importLog('✅ UPSERT exitoso en Supabase');
    importLog('📊 Registros procesados:', data?.length || 0);
    if (data && data.length > 0) {
      importLog('📋 IDs procesados:', data.map((m: any) => m.id).join(', '));
    }

    // Autocreación GPS del día a partir del punto de venta del móvil (best-effort)
    importLog('\n🛰️  PASO 8.5: Autocrear GPS del día desde pto_vta');
    importLog('----------------------------------------');
    const candidatosConPtoVta = transformedMoviles.filter(
      (m) => isValidLatLng(m.pto_vta_lat, m.pto_vta_lng)
    );
    importLog(
      `Móviles con pto_vta válido: ${candidatosConPtoVta.length}/${transformedMoviles.length}`
    );
    const gpsAutocreatedCount = await maybeAutocreateGpsForToday(transformedMoviles);
    importLog(`Autocreados en gps_tracking_history hoy: ${gpsAutocreatedCount}`);

    // PASO 8.6: Recomputar contadores cant_ped/cant_serv/capacidad (best-effort)
    importLog('\n📊 PASO 8.6: Recomputar contadores por movil');
    importLog('----------------------------------------');
    if (data && data.length > 0) {
      const movilNros = [...new Set(
        data.map((m: any) => m.nro).filter((nro: any) => nro != null && nro !== 0)
      )];
      importLog(`Moviles a recomputar: ${movilNros.length}`);
      for (const nro of movilNros) {
        try {
          await recomputeMovilCounters(supabase as any, nro);
          importLog(`✅ [movil-counters] recomputado movil ${nro}`);
        } catch (err) {
          importError(`⚠️ [movil-counters] falló recompute para movil ${nro}:`, err);
          // best-effort: no aborta el response
        }
      }
    }

    // PASO 9: Preparar respuesta exitosa
    importLog('\n📤 PASO 9: Preparando respuesta');
    importLog('----------------------------------------');
    const responseData = {
      count: data?.length || 0,
      gps_autocreated_count: gpsAutocreatedCount,
      moviles: data,
    };
    const message = `${data?.length || 0} móvil(es) importado(s)/actualizado(s) correctamente`;

    importLog('Respuesta a enviar:');
    importLog('  - Success: true');
    importLog('  - Message:', message);
    importLog('  - Status Code: 200');
    importLog('  - Count:', responseData.count);

    importLog('\n' + '='.repeat(80));
    importLog(`✅ POST /api/import/moviles - ÉXITO (UPSERT)`);
    importLog('='.repeat(80) + '\n');

    return successResponse(responseData, message, 200);

  } catch (error: any) {
    importLog('\n' + '='.repeat(80));
    importError(`💥 POST /api/import/moviles - ERROR INESPERADO`);
    importLog('='.repeat(80));
    importError('Tipo de error:', error.constructor.name);
    importError('Mensaje:', error.message);
    importError('Stack trace completo:');
    importError(error.stack);
    importLog('='.repeat(80) + '\n');

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
      importError('❌ ERROR al parsear JSON en PUT /api/import/moviles:', parseError.message);
      importError('📛 Body RAW completo:', rawBody);
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

    importLog(`🔄 Actualizando ${movilesArray.length} móvil(es)...`);

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
      importError('❌ Error de Supabase:', error);
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
    importLog(`✅ ${data?.length || 0} móviles actualizados exitosamente`);

    // Autocreación GPS del día a partir del punto de venta del móvil (best-effort)
    const gpsAutocreatedCount = await maybeAutocreateGpsForToday(transformedMoviles);

    // Recomputar contadores cant_ped/cant_serv/capacidad (best-effort)
    if (data && data.length > 0) {
      const movilNros = [...new Set(
        data.map((m: any) => m.nro).filter((nro: any) => nro != null && nro !== 0)
      )];
      for (const nro of movilNros) {
        try {
          await recomputeMovilCounters(supabase as any, nro);
          importLog(`✅ [movil-counters] recomputado movil ${nro}`);
        } catch (err) {
          importError(`⚠️ [movil-counters] falló recompute para movil ${nro}:`, err);
          // best-effort: no aborta el response
        }
      }
    }

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
    importError('❌ Error inesperado:', error);

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

    importLog(`🗑️ Eliminando ${movil_ids.length} móviles...`);

    const { data, error } = await supabase
      .from('moviles')
      .delete()
      .in('id', movil_ids)
      .select();

    // Manejo de error de Supabase
    if (error) {
      importError('❌ Error de Supabase:', error);
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
    importLog(`✅ ${data?.length || 0} móviles eliminados exitosamente`);

    return successResponse(
      {
        deleted_count: data?.length || 0,
        moviles: data,
      },
      `${data?.length || 0} móvil(es) eliminado(s) correctamente`,
      200
    );
  } catch (error: any) {
    importError('❌ Error inesperado:', error);

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
