import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * Mapea un item del body de Genexus (PascalCase) a las columnas de la tabla moviles_zonas.
 * Body GX: { Movil, EscenarioId, TipoDeZona, TipoDeServicio, Zona, PrioridadOTransito }
 * Tabla:   { movil_id, escenario_id, tipo_de_zona, tipo_de_servicio, zona_id, prioridad_o_transito, activa }
 *
 * Si el item ya viene con snake_case (movil_id, zona_id, etc.) se usa directo.
 */
function mapGxItem(item: any): Record<string, any> {
  // Detectar si viene en formato Genexus (PascalCase) o ya en snake_case
  if ('Movil' in item || 'Zona' in item) {
    return {
      movil_id: String(item.Movil ?? item.movil_id ?? ''),
      zona_id: parseInt(String(item.Zona ?? item.zona_id ?? '0'), 10),
      escenario_id: parseInt(String(item.EscenarioId ?? item.escenario_id ?? '1000'), 10),
      tipo_de_zona: (item.TipoDeZona ?? item.tipo_de_zona ?? '').trim(),
      tipo_de_servicio: (item.TipoDeServicio ?? item.tipo_de_servicio ?? '').trim().toUpperCase(),
      prioridad_o_transito: parseInt(String(item.PrioridadOTransito ?? item.prioridad_o_transito ?? '0'), 10),
      activa: true,
    };
  }
  // Ya viene en snake_case — pasar directo con defaults
  return {
    movil_id: String(item.movil_id ?? ''),
    zona_id: parseInt(String(item.zona_id ?? '0'), 10),
    escenario_id: parseInt(String(item.escenario_id ?? '1000'), 10),
    tipo_de_zona: (item.tipo_de_zona ?? '').trim(),
    tipo_de_servicio: (item.tipo_de_servicio ?? '').trim().toUpperCase(),
    prioridad_o_transito: parseInt(String(item.prioridad_o_transito ?? '0'), 10),
    activa: item.activa !== undefined ? item.activa : true,
  };
}

/**
 * POST /api/import/movZonaServicio
 * Importar asignaciones móvil-zona desde Genexus.
 *
 * Body esperado de GX:
 * {
 *   "MovZonas": [
 *     { "Movil": 330, "EscenarioId": 1000, "TipoDeZona": "...", "TipoDeServicio": "GAS", "Zona": "10", "PrioridadOTransito": 0 },
 *     ...
 *   ]
 * }
 *
 * También acepta el formato legacy: { "asignaciones": [...] } o un array directo.
 *
 * Comportamiento: REEMPLAZA todas las asignaciones del escenario recibido.
 * 1. Borra todas las filas del escenario_id recibido.
 * 2. Inserta las nuevas filas.
 * Esto asegura consistencia con el estado completo que envía Genexus.
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

    // Mapear todos los items al formato de la tabla
    const items = rawItems.map(mapGxItem);

    // 🔍 DEBUG: Mostrar resultado del mapeo
    if (items.length > 0) {
      console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));
      if (items.length > 1) console.log('🔄 Último item mapeado:', JSON.stringify(items[items.length - 1]));
    }

    // Determinar escenario_ids involucrados para limpiar antes de insertar
    const escenarioIds = [...new Set(items.map((i: any) => i.escenario_id))];

    console.log(`📦 Importando ${items.length} asignación(es) móvil-zona para escenarios [${escenarioIds.join(', ')}]...`);

    const supabase = getServerSupabaseClient();

    // 1) Borrar asignaciones anteriores de los escenarios recibidos
    for (const escId of escenarioIds) {
      const { error: delError } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId);
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

    const items = rawItems.map(mapGxItem);

    console.log('🔄 Upsert items mapeados:', items.length);
    if (items.length > 0) console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));

    console.log(`🔄 Upsert ${items.length} asignación(es) móvil-zona...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('moviles_zonas')
      .upsert(items, {
        onConflict: 'movil_id,zona_id',
      })
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
