import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Mapea un item del body de Genexus (PascalCase) a las columnas de la tabla moviles_zonas.
 *
 * Soporta DOS formatos de GX:
 *
 * Formato A (legacy, un móvil por item):
 *   { Movil: 330, EscenarioId: 1000, TipoDeZona: "...", TipoDeServicio: "GAS", Zona: "10", PrioridadOTransito: 0 }
 *
 * Formato B (nuevo, array de móviles por item):
 *   { Moviles: [304, 305], EscenarioId: 1000, TipoDeZona: "Distribucion", TipoDeServicio: "URGENTE", Zona: "3", PrioridadOTransito: 1 }
 *
 * Tabla:   { movil_id, escenario_id, tipo_de_zona, tipo_de_servicio, zona_id, prioridad_o_transito, activa }
 *
 * Esta función devuelve un ARRAY de filas (1 por móvil) para soportar el formato B.
 */
function mapGxItem(item: any): Record<string, any>[] {
  // Extraer datos comunes de la zona
  const zona_id = parseInt(String(item.Zona ?? item.zona_id ?? '0'), 10);
  const escenario_id = parseInt(String(item.EscenarioId ?? item.escenario_id ?? '1000'), 10);
  const tipo_de_zona = (item.TipoDeZona ?? item.tipo_de_zona ?? '').trim();
  const tipo_de_servicio = (item.TipoDeServicio ?? item.tipo_de_servicio ?? '').trim().toUpperCase();
  const prioridad_o_transito = parseInt(String(item.PrioridadOTransito ?? item.prioridad_o_transito ?? '0'), 10);
  const activa = item.activa !== undefined ? item.activa : true;

  // Determinar los móviles: puede ser Moviles (array), Movil (solo uno), o movil_id (snake_case)
  let movilIds: string[] = [];

  if (Array.isArray(item.Moviles) && item.Moviles.length > 0) {
    // Formato B: array de móviles
    movilIds = item.Moviles.map((m: any) => String(m));
  } else if (item.Movil !== undefined) {
    // Formato A: un solo móvil
    movilIds = [String(item.Movil)];
  } else if (item.movil_id !== undefined) {
    // snake_case
    movilIds = [String(item.movil_id)];
  }

  // Generar una fila por cada móvil
  return movilIds.map(movil_id => ({
    movil_id,
    zona_id,
    escenario_id,
    tipo_de_zona,
    tipo_de_servicio,
    prioridad_o_transito,
    activa,
  }));
}

/**
 * POST /api/import/movZonaServicio
 * Importar asignaciones móvil-zona desde Genexus.
 *
 * Formato nuevo (con TipoDeServicio a nivel raíz):
 * {
 *   "TipoDeServicio": "GAS",
 *   "MovZonas": [
 *     { "EscenarioId": 1000, "TipoDeZona": "Distribucion", "TipoDeServicio": "GAS", "Zona": "3", "PrioridadOTransito": 1, "Moviles": [304, 305] },
 *     ...
 *   ]
 * }
 * Cuando viene TipoDeServicio a nivel raíz, solo se borran las asignaciones
 * del escenario con ese tipo_de_servicio antes de insertar las nuevas.
 *
 * Formato legacy (sin TipoDeServicio raíz, borra TODO el escenario):
 * {
 *   "MovZonas": [
 *     { "Movil": 330, "EscenarioId": 1000, "TipoDeZona": "...", "TipoDeServicio": "GAS", "Zona": "10", "PrioridadOTransito": 0 },
 *     ...
 *   ]
 * }
 *
 * También acepta: { "asignaciones": [...] } o un array directo.
 */
export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();

    // 🔍 DEBUG: Log completo de lo que llega
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 POST /api/import/movZonaServicio');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('🔑 Headers:', JSON.stringify({
      'content-type': request.headers.get('content-type'),
      'x-api-key': request.headers.get('x-api-key') ? '***' : '(no key)',
      'user-agent': request.headers.get('user-agent'),
    }));
    console.log('📦 Body crudo (keys):', Object.keys(body));
    console.log('📦 Body completo:', JSON.stringify(body, null, 2).substring(0, 3000));

    // Leer TipoDeServicio del nivel raíz si existe (nuevo formato GX)
    const rootTipoDeServicio = (body.TipoDeServicio || '').trim().toUpperCase();
    if (rootTipoDeServicio) {
      console.log(`🏷️ TipoDeServicio raíz detectado: "${rootTipoDeServicio}"`);
    }

    // Aceptar body de Genexus (MovZonas), formato legacy (asignaciones), o array directo
    let rawItems = body.MovZonas || body.asignaciones || body;
    if (!Array.isArray(rawItems)) rawItems = [rawItems];

    console.log(`📋 Items crudos recibidos: ${rawItems.length}`);
    if (rawItems.length > 0) {
      console.log('📋 Primer item crudo:', JSON.stringify(rawItems[0]));
      if (rawItems.length > 1) console.log('📋 Último item crudo:', JSON.stringify(rawItems[rawItems.length - 1]));
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una asignación móvil-zona' },
        { status: 400 }
      );
    }

    // Mapear todos los items al formato de la tabla (flatMap porque un item con Moviles[] genera múltiples filas)
    const items = rawItems.flatMap(mapGxItem);

    // 🔍 DEBUG: Mostrar resultado del mapeo
    if (items.length > 0) {
      console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));
      if (items.length > 1) console.log('🔄 Último item mapeado:', JSON.stringify(items[items.length - 1]));
    }

    // Determinar escenario_ids involucrados para limpiar antes de insertar
    const escenarioIds = [...new Set(items.map((i: any) => i.escenario_id))];

    console.log(`📦 Importando ${items.length} asignación(es) móvil-zona para escenarios [${escenarioIds.join(', ')}]${rootTipoDeServicio ? ` tipo_de_servicio="${rootTipoDeServicio}"` : ''}...`);

    const supabase = getServerSupabaseClient();

    // 1) Borrar asignaciones anteriores
    // Si viene TipoDeServicio en el body raíz, borrar solo ese tipo de servicio por escenario
    // Si no, borrar todo el escenario (comportamiento legacy)
    for (const escId of escenarioIds) {
      let deleteQuery = (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId);

      if (rootTipoDeServicio) {
        deleteQuery = deleteQuery.eq('tipo_de_servicio', rootTipoDeServicio);
        console.log(`🗑️ Borrando moviles_zonas escenario=${escId} tipo_de_servicio="${rootTipoDeServicio}"`);
      } else {
        console.log(`🗑️ Borrando ALL moviles_zonas escenario=${escId}`);
      }

      const { error: delError } = await deleteQuery;
      if (delError) {
        console.error(`❌ Error al limpiar escenario ${escId}:`, delError);
      }
    }

    // 2) Insertar en lotes de 500 (límite seguro de Supabase)
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const { data, error } = await (supabase as any)
        .from('moviles_zonas')
        .insert(batch)
        .select();

      if (error) {
        console.error(`❌ Error al importar lote ${i / BATCH_SIZE + 1}:`, error);
        return NextResponse.json(
          { error: 'Error al importar asignaciones', details: error.message, inserted_so_far: totalInserted },
          { status: 500 }
        );
      }
      totalInserted += data?.length || 0;
    }

    console.log(`✅ ${totalInserted} asignaciones importadas (escenarios: ${escenarioIds.join(', ')})`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return NextResponse.json({
      success: true,
      message: `${totalInserted} asignaciones importadas correctamente`,
      count: totalInserted,
      escenarios: escenarioIds,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en POST /api/import/movZonaServicio:', error);
    console.error('❌ Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/import/movZonaServicio
 * Upsert asignaciones móvil-zona (insertar o actualizar por movil_id + zona_id).
 * Acepta tanto formato Genexus (MovZonas / PascalCase) como snake_case.
 */
export async function PUT(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();

    // 🔍 DEBUG: Log completo de lo que llega
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 PUT /api/import/movZonaServicio');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('📦 Body crudo (keys):', Object.keys(body));
    console.log('📦 Body completo:', JSON.stringify(body, null, 2).substring(0, 3000));

    let rawItems = body.MovZonas || body.asignaciones || body;
    if (!Array.isArray(rawItems)) rawItems = [rawItems];

    console.log(`📋 Items crudos recibidos: ${rawItems.length}`);
    if (rawItems.length > 0) {
      console.log('📋 Primer item crudo:', JSON.stringify(rawItems[0]));
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una asignación para actualizar' },
        { status: 400 }
      );
    }

    const items = rawItems.flatMap(mapGxItem);

    console.log('🔄 PUT items mapeados:', items.length);
    if (items.length > 0) console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));

    const supabase = getServerSupabaseClient();

    // Borrar las filas existentes que coincidan (por movil_id + zona_id + escenario_id + tipo_de_servicio)
    // y luego insertar las nuevas, evitando problemas de constraint
    for (const item of items) {
      const { error: delError } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('movil_id', item.movil_id)
        .eq('zona_id', item.zona_id)
        .eq('escenario_id', item.escenario_id)
        .eq('tipo_de_servicio', item.tipo_de_servicio);

      if (delError) {
        console.error('❌ Error al borrar fila previa:', delError);
      }
    }

    // Insertar todas las filas nuevas
    const { data, error } = await (supabase as any)
      .from('moviles_zonas')
      .insert(items)
      .select();

    if (error) {
      console.error('❌ Error al actualizar moviles_zonas:', error);
      return NextResponse.json(
        { error: 'Error al actualizar asignaciones', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} asignaciones actualizadas`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} asignaciones actualizadas correctamente`,
      count: data?.length || 0,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en PUT /api/import/movZonaServicio:', error);
    console.error('❌ Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import/movZonaServicio
 * Eliminar asignaciones por movil_id, zona_id o ambos
 */
export async function DELETE(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { movil_id, zona_id, ids } = body;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 DELETE /api/import/movZonaServicio');
    console.log('📦 Body:', JSON.stringify(body));

    const supabase = getServerSupabaseClient();
    let query = (supabase as any).from('moviles_zonas').delete();

    if (ids && Array.isArray(ids)) {
      // Eliminar por IDs específicos
      query = query.in('id', ids);
    } else if (movil_id && zona_id) {
      // Eliminar asignación específica
      query = query.eq('movil_id', movil_id).eq('zona_id', zona_id);
    } else if (movil_id) {
      // Eliminar todas las zonas de un móvil
      query = query.eq('movil_id', movil_id);
    } else if (zona_id) {
      // Eliminar todos los móviles de una zona
      query = query.eq('zona_id', zona_id);
    } else {
      return NextResponse.json(
        { error: 'Se requiere movil_id, zona_id o ids para eliminar' },
        { status: 400 }
      );
    }

    const { data, error } = await query.select();

    if (error) {
      console.error('❌ Error al eliminar moviles_zonas:', error);
      return NextResponse.json(
        { error: 'Error al eliminar asignaciones', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} asignaciones eliminadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} asignaciones eliminadas`,
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
