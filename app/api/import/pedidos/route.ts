import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';
import { recomputeMovilCounters } from '@/lib/movil-counters';

/**
 * Lee el body del request respetando el charset del Content-Type.
 * GeneXus/AS400 envía Latin-1 (ISO-8859-1) — request.text() siempre
 * decodifica como UTF-8 y corrompe caracteres como ñ, á, é, etc.
 */
async function readRequestBody(request: NextRequest): Promise<string> {
  const contentType = request.headers.get('content-type') || '';
  const charsetMatch = contentType.match(/charset=([\w-]+)/i);
  // GeneXus/AS400 raramente especifica charset — asumir iso-8859-1 por defecto
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'iso-8859-1';

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
 *
 * Estrategia: usa la posición del error para encontrar la comilla
 * interna que rompió el parseo, la escapa, y reintenta.
 */
function safeParseJSON(rawBody: string): any {
  // Paso 0: reemplazar caracteres de control ASCII (<0x20) que sean ilegales
  // en strings JSON pero que AS400/GeneXus puede enviar sin escapar.
  // Tabs (\t=0x09), newlines (\n=0x0A) y CR (\r=0x0D) se escapan;
  // el resto (backspace, etc.) se eliminan.
  const sanitized = rawBody.replace(/[\x00-\x1F]/g, (ch) => {
    if (ch === '\t') return '\\t';
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    return ''; // eliminar otros control chars
  });

  try {
    return JSON.parse(sanitized);
  } catch (firstError) {
    console.warn('⚠️  JSON.parse falló, intentando sanitizar comillas internas...');

    let text = sanitized;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = JSON.parse(text);
        console.log(`✅ JSON reparado después de ${attempt + 1} correcciones`);
        return result;
      } catch (err: any) {
        const posMatch = err.message.match(/position\s+(\d+)/);
        if (!posMatch) throw firstError;

        const errorPos = parseInt(posMatch[1], 10);

        let fixPos = -1;
        for (let i = errorPos - 1; i >= 0; i--) {
          if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
            fixPos = i;
            break;
          }
        }

        if (fixPos < 0) throw firstError;

        console.log(`🔧 Escapando comilla en posición ${fixPos} (intento ${attempt + 1})`);
        text = text.substring(0, fixPos) + '\\' + text.substring(fixPos);
      }
    }

    throw firstError;
  }
}

/**
 * Convierte un valor numérico arbitrario a number o null. Acepta strings parseables.
 * Negativos válidos (anticipación). Devuelve null para NaN, undefined, '' y no-números.
 */
function parseNumOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Transforma campos de PascalCase a snake_case para Supabase
 */
function transformPedidoToSupabase(pedido: any) {
  // Manejar fechas inválidas de AS400: "0000-00-00T00:00:00", "100-00-01T00:00:00", etc.
  const parseDate = (dateStr: string) => {
    if (!dateStr || dateStr.startsWith('0000-00-00')) {
      return null;
    }
    // Rechazar años menores a 1900 o mayores a 2100 (basura de AS400)
    const yearMatch = dateStr.match(/^(\d{1,4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (year < 1900 || year > 2100) return null;
    }
    return dateStr;
  };

  /**
   * Convierte fecha en formato YYYYMMDD (sin ceros a la izquierda) a ISO 8601
   * Ejemplos:
   *   "202624"   -> "2026-02-04" (4 de febrero)
   *   "2026214"  -> "2026-02-14" (14 de febrero)
   *   "20261231" -> "2026-12-31" (31 de diciembre)
   */
  const parseDateYYYYMMDD = (dateStr: string) => {
    if (!dateStr || dateStr === '0' || dateStr.startsWith('0000')) {
      return null;
    }

    try {
      const str = dateStr.toString().trim();

      // Si ya está en formato ISO (YYYY-MM-DD), devolver tal cual
      if (str.includes('-') || str.includes('T')) {
        return parseDate(str);
      }

      // Parsear formato YYYYMMDD (sin ceros a la izquierda)
      // Extraer año (primeros 4 dígitos)
      const year = str.substring(0, 4);

      // El resto son mes y día sin ceros
      const monthDay = str.substring(4);

      // Determinar dónde termina el mes y empieza el día
      // Si quedan 3+ dígitos: mes es 1 dígito, día son los últimos 2
      // Si quedan 4 dígitos: mes son 2 dígitos, día son los últimos 2
      let month, day;

      if (monthDay.length <= 2) {
        // Solo día (mes implícito = 01)
        month = '01';
        day = monthDay.padStart(2, '0');
      } else if (monthDay.length === 3) {
        // Mes de 1 dígito, día de 2 dígitos
        month = monthDay.substring(0, 1).padStart(2, '0');
        day = monthDay.substring(1);
      } else {
        // Mes de 2 dígitos, día de 2 dígitos
        month = monthDay.substring(0, 2);
        day = monthDay.substring(2);
      }

      const isoDate = `${year}-${month}-${day}`;

      // Validar que sea fecha válida
      const testDate = new Date(isoDate);
      if (isNaN(testDate.getTime())) {
        console.warn(`⚠️ Fecha inválida después de parseo: ${dateStr} -> ${isoDate}`);
        return null;
      }

      console.log(`📅 Fecha parseada: ${dateStr} -> ${isoDate}`);
      return isoDate;

    } catch (error) {
      console.error(`❌ Error parseando fecha YYYYMMDD: ${dateStr}`, error);
      return null;
    }
  };

  return {
    id: pedido.id,
    escenario: pedido.escenario,

    // Datos del cliente
    cliente_ciudad: pedido.ClienteCiudad?.trim() || pedido.cliente_ciudad,
    cliente_direccion: pedido.ClienteDireccion?.trim() || pedido.cliente_direccion,
    cliente_direccion_esq1: pedido.ClienteDireccionEsq1?.trim() || pedido.cliente_direccion_esq1,
    cliente_direccion_obs: pedido.ClienteDireccionObs?.trim() || pedido.cliente_direccion_obs,
    cliente_nombre: pedido.ClienteNombre?.trim() || pedido.cliente_nombre,
    cliente_nro: pedido.ClienteNro ?? pedido.cliente_nro,
    cliente_obs: pedido.ClienteObs?.trim() || pedido.cliente_obs,
    cliente_tel: pedido.ClienteTel?.trim() || pedido.cliente_tel,

    // Info del pedido
    demora_informada: pedido.DemoraInformada ?? pedido.demora_informada ?? 0,
    detalle_html: pedido.DetalleHTML || pedido.detalle_html || '',
    empresa_fletera_id: pedido.EFleteraId ?? pedido.empresa_fletera_id,
    empresa_fletera_nom: pedido.EFleteraNom?.trim() || pedido.empresa_fletera_nom,
    estado_nro: pedido.EstadoNro ?? pedido.estado_nro,
    fpago_obs1: pedido.FPagoObs1?.trim() || pedido.fpago_obs1,

    // Fechas
    fch_hora_max_ent_comp: parseDate(pedido.FchHoraMaxEntComp || pedido.fch_hora_max_ent_comp),
    fch_hora_mov: parseDate(pedido.FchHoraMov || pedido.fch_hora_mov),
    fch_hora_finalizacion: parseDate(pedido.FchHoraCump || pedido.fch_hora_finalizacion),
    fch_hora_para: parseDate(pedido.FchHoraPara || pedido.fch_hora_para),
    fch_hora_upd_firestore: parseDate(pedido.FchHoraUPDFireStore || pedido.fch_hora_upd_firestore),
    fch_para: parseDateYYYYMMDD(pedido.FchPara || pedido.fch_para), // Formato especial YYYYMMDD

    // URLs y precios
    google_maps_url: pedido.GoogleMapsURL || pedido.google_maps_url || '',
    imp_bruto: pedido.ImpBruto ? parseFloat(pedido.ImpBruto) : pedido.imp_bruto,
    imp_flete: pedido.ImpFlete ? parseFloat(pedido.ImpFlete) : pedido.imp_flete,

    // Asignación y estado
    movil: pedido.Movil ?? pedido.movil,
    orden_cancelacion: pedido.OrdenCancelacion || pedido.orden_cancelacion || 'N',
    otros_productos: pedido.OtrosProductos || pedido.otros_productos || 'N',
    pedido_obs: pedido.PedidoObs?.trim() || pedido.pedido_obs,
    precio: pedido.Precio ? parseFloat(pedido.Precio) : pedido.precio,
    prioridad: pedido.Prioridad ?? pedido.prioridad ?? 0,

    // Producto
    producto_cant: pedido.ProductoCant ? parseFloat(pedido.ProductoCant) : pedido.producto_cant,
    producto_cod: pedido.ProductoCod?.trim() || pedido.producto_cod,
    producto_nom: pedido.ProductoNom?.trim() || pedido.producto_nom,
    servicio_nombre: pedido.ServicioNombre?.trim() || pedido.servicio_nombre,

    // Sub estado
    sub_estado_desc: pedido.SubEstadoDesc?.trim() || pedido.sub_estado_desc,
    sub_estado_nro: pedido.SubEstadoNro ?? pedido.sub_estado_nro,
    pedido_hijo: pedido.PedidoHijo ?? pedido.pedido_hijo ?? null,
    pedido_padre: pedido.PedidoPadre ?? pedido.pedido_padre ?? null,

    // Otros
    tipo: pedido.Tipo || pedido.tipo || '',
    visible_en_app: pedido.VisibleEnApp || pedido.visible_en_app || 'S',
    waze_url: pedido.WazeURL || pedido.waze_url || '',
    zona_nro: pedido.ZonaNro ?? pedido.zona_nro,
    ubicacion: pedido.ubicacion || '',

    // Coordenadas geográficas
    latitud: pedido.Latitud ?? pedido.latitud ?? null,
    longitud: pedido.Longitud ?? pedido.longitud ?? null,

    // Campos adicionales
    prodsadicionales: pedido.prodsadicionales ?? pedido.ProdsAdicionales ?? '',
    campana: pedido.campana ?? pedido.Campana ?? '',
    obsfletero: pedido.obsfletero ?? pedido.ObsFletero ?? '',
    fletero: pedido.Fletero?.trim() || pedido.fletero || '',

    // Métricas de atraso/demora (AS400)
    atraso_cump_mins: parseNumOrNull(pedido.AtrasoCumpMins ?? pedido.atraso_cump_mins),
    demora_movil_desde_asignacion_mins: parseNumOrNull(
      pedido.DemoraMovilDesdeAsignacionMins ?? pedido.demora_movil_desde_asignacion_mins
    ),
  };
}

/**
 * Helper: extrae movil nros únicos y no nulos de un array de registros,
 * luego recomputa los contadores para cada uno (best-effort).
 */
async function recomputeCountersForMoviles(records: any[], label: string): Promise<void> {
  if (!records || records.length === 0) return;
  const movilNros = [...new Set(
    records.map((r: any) => r.movil).filter((m: any) => m != null && m !== 0)
  )];
  for (const nro of movilNros) {
    try {
      await recomputeMovilCounters(supabase as any, nro);
    } catch (err) {
      console.error(`⚠️ [movil-counters] ${label} falló recompute para movil ${nro}:`, err);
      // best-effort: no aborta el response
    }
  }
}

/**
 * POST /api/import/pedidos
 * Importar o actualizar pedidos desde fuente externa (UPSERT)
 * Si el pedido existe (mismo id), lo actualiza. Si no existe, lo inserta.
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log('\n' + '═'.repeat(100));
  console.log(`📦 INICIO IMPORTACIÓN DE PEDIDOS [${timestamp}]`);
  console.log('═'.repeat(100));

  try {
    console.log('📥 1. Leyendo body del request...');
    let rawBody = '';
    let body;
    try {
      rawBody = await readRequestBody(request);
      console.log('📊 Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      console.log('📊 Longitud total del body:', rawBody.length, 'caracteres');
      body = safeParseJSON(rawBody);
      console.log('✅ Body parseado correctamente');
    } catch (parseError: any) {
      console.error('❌ ERROR al parsear JSON en POST /api/import/pedidos:', parseError.message);
      console.error('📛 Body RAW completo:', rawBody);
      return NextResponse.json(
        { error: 'JSON inválido en el body', details: parseError.message, bodyPreview: rawBody.substring(0, 500) },
        { status: 400 }
      );
    }
    console.log('📊 Claves del body:', Object.keys(body));

    console.log('\n🔍 2. Normalizando estructura...');
    let { pedidos } = body;

    // Si no viene "pedidos", asumir que el body ES el pedido
    if (!pedidos) {
      console.log('⚠️  No hay propiedad "pedidos", asumiendo que body ES el pedido');
      pedidos = body;
    }

    // Normalizar a array si es un solo objeto
    const pedidosArray = Array.isArray(pedidos) ? pedidos : [pedidos];
    console.log(`✅ Estructura normalizada: ${pedidosArray.length} pedido(s)`);

    if (pedidosArray.length === 0) {
      console.error('❌ Array de pedidos está vacío');
      return NextResponse.json(
        { error: 'Se requiere al menos un pedido' },
        { status: 400 }
      );
    }

    console.log('\n' + '─'.repeat(100));
    console.log('📦 3. Transformando pedidos a formato Supabase...');
    console.log('📄 Pedido #1 (sin transformar):');
    console.log(JSON.stringify(pedidosArray[0], null, 2));

    // Transformar campos a formato Supabase
    const transformedPedidos = pedidosArray.map(transformPedidoToSupabase);

    console.log('\n📄 Pedido #1 (transformado):');
    console.log(JSON.stringify(transformedPedidos[0], null, 2));
    console.log('─'.repeat(100) + '\n');

    console.log('🔄 4. Haciendo UPSERT en Supabase (conflict: id,escenario)...');
    const { data, error } = await supabase
      .from('pedidos')
      .upsert(transformedPedidos as any, {
        onConflict: 'id,escenario', // PRIMARY KEY compuesta (id, escenario)
      })
      .select();

    if (error) {
      console.error('\n' + '❌'.repeat(50));
      console.error('💥 ERROR DE SUPABASE:');
      console.error('📛 Código:', error.code);
      console.error('📛 Mensaje:', error.message);
      console.error('📛 Detalles:', error.details);
      console.error('📛 Hint:', error.hint);
      console.error('❌'.repeat(50) + '\n');
      return NextResponse.json(
        { error: 'Error al importar pedidos', details: error.message },
        { status: 500 }
      );
    }

    const finalTimestamp = new Date().toISOString();
    console.log('\n' + '✅'.repeat(50));
    console.log(`🎉 IMPORTACIÓN/ACTUALIZACIÓN EXITOSA [${finalTimestamp}]`);
    console.log(`📊 5. Pedidos procesados (insertados o actualizados): ${data?.length || 0}`);
    console.log('✅'.repeat(50) + '\n');

    // Recomputar contadores cant_ped/cant_serv/capacidad para moviles afectados (best-effort)
    await recomputeCountersForMoviles(data || [], 'POST import/pedidos');

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} pedidos procesados correctamente (insertados o actualizados)`,
      data,
    });
  } catch (error: any) {
    console.error('\n' + '💥'.repeat(50));
    console.error('⚠️  ERROR INESPERADO EN POST:');
    console.error('📛 Tipo:', typeof error);
    console.error('📛 Nombre:', error?.name);
    console.error('📛 Mensaje:', error?.message);
    console.error('📛 Stack trace:');
    console.error(error?.stack);
    console.error('💥'.repeat(50) + '\n');
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/import/pedidos
 * Actualizar pedidos existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  const timestamp = new Date().toISOString();
  console.log('\n' + '═'.repeat(100));
  console.log(`🔄 INICIO ACTUALIZACIÓN DE PEDIDOS [${timestamp}]`);
  console.log('═'.repeat(100));

  try {
    console.log('📥 1. Leyendo body del request...');
    let rawBody = '';
    let body;
    try {
      rawBody = await readRequestBody(request);
      console.log('📊 Body raw (primeros 500 chars):', rawBody.substring(0, 500));
      body = safeParseJSON(rawBody);
      console.log('✅ Body parseado correctamente');
    } catch (parseError: any) {
      console.error('❌ ERROR al parsear JSON en PUT /api/import/pedidos:', parseError.message);
      console.error('📛 Body RAW completo:', rawBody);
      return NextResponse.json(
        { error: 'JSON inválido en el body', details: parseError.message, bodyPreview: rawBody.substring(0, 500) },
        { status: 400 }
      );
    }
    console.log('📊 Claves del body:', Object.keys(body));

    console.log('\n🔍 2. Normalizando estructura...');
    let { pedidos } = body;

    // Si no viene "pedidos", asumir que el body ES el pedido
    if (!pedidos) {
      console.log('⚠️  No hay propiedad "pedidos", asumiendo que body ES el pedido');
      pedidos = body;
    }

    // Normalizar a array si es un solo objeto
    const pedidosArray = Array.isArray(pedidos) ? pedidos : [pedidos];
    console.log(`✅ Estructura normalizada: ${pedidosArray.length} pedido(s)`);

    if (pedidosArray.length === 0) {
      console.error('❌ Array de pedidos está vacío');
      return NextResponse.json(
        { error: 'Se requiere al menos un pedido para actualizar' },
        { status: 400 }
      );
    }

    console.log('\n' + '─'.repeat(100));
    console.log('🔄 3. Transformando pedidos a formato Supabase...');
    console.log('📄 Pedido #1 (sin transformar):');
    console.log(JSON.stringify(pedidosArray[0], null, 2));

    // Transformar campos a formato Supabase
    const transformedPedidos = pedidosArray.map(transformPedidoToSupabase);

    console.log('\n📄 Pedido #1 (transformado):');
    console.log(JSON.stringify(transformedPedidos[0], null, 2));
    console.log('─'.repeat(100) + '\n');

    console.log('🔄 4. Haciendo UPSERT en Supabase (conflict: id,escenario)...');
    const { data, error } = await supabase
      .from('pedidos')
      .upsert(transformedPedidos as any, {
        onConflict: 'id,escenario', // PRIMARY KEY compuesta (id, escenario)
      })
      .select();

    if (error) {
      console.error('\n' + '❌'.repeat(50));
      console.error('💥 ERROR DE SUPABASE AL ACTUALIZAR:');
      console.error('📛 Código:', error.code);
      console.error('📛 Mensaje:', error.message);
      console.error('📛 Detalles:', error.details);
      console.error('📛 Hint:', error.hint);
      console.error('❌'.repeat(50) + '\n');
      return NextResponse.json(
        { error: 'Error al actualizar pedidos', details: error.message },
        { status: 500 }
      );
    }

    const finalTimestamp = new Date().toISOString();
    console.log('\n' + '✅'.repeat(50));
    console.log(`🎉 ACTUALIZACIÓN EXITOSA [${finalTimestamp}]`);
    console.log(`📊 5. Pedidos actualizados: ${data?.length || 0}`);
    console.log('✅'.repeat(50) + '\n');

    // Recomputar contadores cant_ped/cant_serv/capacidad para moviles afectados (best-effort)
    await recomputeCountersForMoviles(data || [], 'PUT import/pedidos');

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} pedidos actualizados correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('\n' + '💥'.repeat(50));
    console.error('⚠️  ERROR INESPERADO EN PUT:');
    console.error('📛 Tipo:', typeof error);
    console.error('📛 Nombre:', error?.name);
    console.error('📛 Mensaje:', error?.message);
    console.error('📛 Stack trace:');
    console.error(error?.stack);
    console.error('💥'.repeat(50) + '\n');
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import/pedidos
 * Eliminar pedidos por IDs
 */
export async function DELETE(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { pedido_ids } = body;

    if (!pedido_ids || !Array.isArray(pedido_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de pedido_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${pedido_ids.length} pedidos...`);

    const { data, error } = await supabase
      .from('pedidos')
      .delete()
      .in('id', pedido_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar pedidos:', error);
      return NextResponse.json(
        { error: 'Error al eliminar pedidos', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} pedidos eliminados`);

    // Recomputar contadores para moviles afectados (best-effort)
    await recomputeCountersForMoviles(data || [], 'DELETE import/pedidos');

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} pedidos eliminados correctamente`,
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
