import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';
import { recomputeMovilAndCapEntrega } from '@/lib/zonas-cap-entrega';

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
 * Recomputa contadores y zonas_cap_entrega para todos los móviles únicos
 * extraídos de un array de filas de moviles_zonas (best-effort).
 *
 * Llama recomputeMovilAndCapEntrega (compuesta) para cada nro distinto:
 * garantiza que cant_ped/cant_serv/capacidad y zonas_cap_entrega quedan
 * sincronizados después de mutaciones en moviles_zonas.
 *
 * Usa getServerSupabaseClient() para bypassear RLS en UPDATE moviles.
 */
async function recomputeForItems(items: Array<{ movil_id: string }>, trigger: string): Promise<void> {
  if (!items || items.length === 0) return;
  const supabase = getServerSupabaseClient();
  const uniqueNros = [...new Set(
    items
      .map((r) => parseInt(r.movil_id, 10))
      .filter((n) => Number.isFinite(n) && n !== 0),
  )];
  if (uniqueNros.length === 0) return;
  console.log(`[recompute] trigger=${trigger} — moviles a recomputar: ${uniqueNros.join(', ')}`);
  for (const nro of uniqueNros) {
    try {
      await recomputeMovilAndCapEntrega(supabase as any, nro);
      console.log(`[recompute] trigger=${trigger} movilNro=${nro} → recompute+sync OK`);
    } catch (err) {
      console.error(`[recompute] trigger=${trigger} falló recompute para movil ${nro}:`, err);
      // best-effort: no aborta el response principal
    }
  }
}

/**
 * POST /api/import/movZonaServicio
 * Importar asignaciones móvil-zona desde Genexus.
 *
 * Formato esperado (TipoDeServicio a nivel raíz es OBLIGATORIO):
 * {
 *   "TipoDeServicio": "URGENTE",
 *   "MovZonas": [
 *     { "EscenarioId": 1000, "TipoDeZona": "Distribucion", "Zona": "3", "PrioridadOTransito": 1, "Moviles": [304, 305] },
 *     { "EscenarioId": 1000, "TipoDeZona": "Distribucion", "Zona": "10", "PrioridadOTransito": 0, "Movil": 330 },
 *     ...
 *   ]
 * }
 *
 * Comportamiento:
 *   1) Borra filas de moviles_zonas del escenario con tipo_de_servicio = TipoDeServicio (+ vacíos)
 *   2) Inserta las nuevas filas
 *   3) Recomputa contadores + sincroniza zonas_cap_entrega para todos los móviles afectados (best-effort)
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

    // TipoDeServicio a nivel raíz es OBLIGATORIO
    const rootTipoDeServicio = (body.TipoDeServicio || '').trim().toUpperCase();
    if (!rootTipoDeServicio) {
      console.error('❌ Falta TipoDeServicio a nivel raíz');
      return NextResponse.json(
        { error: 'Se requiere TipoDeServicio a nivel raíz del body (ej: "URGENTE", "SERVICE", "NOCTURNO")' },
        { status: 400 }
      );
    }
    console.log(`🏷️ TipoDeServicio raíz: "${rootTipoDeServicio}"`);

    // Aceptar body de Genexus (MovZonas)
    let rawItems = body.MovZonas || [];
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
    // Si hay rootTipoDeServicio, inyectarlo en cada item que no lo tenga
    const items = rawItems.flatMap((item: any) => {
      if (rootTipoDeServicio && !item.TipoDeServicio && !item.tipo_de_servicio) {
        return mapGxItem({ ...item, TipoDeServicio: rootTipoDeServicio });
      }
      return mapGxItem(item);
    });

    // 🔍 DEBUG: Mostrar resultado del mapeo
    if (items.length > 0) {
      console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));
      if (items.length > 1) console.log('🔄 Último item mapeado:', JSON.stringify(items[items.length - 1]));
    }

    // Determinar escenario_ids involucrados para limpiar antes de insertar
    const escenarioIds = [...new Set(items.map((i: any) => i.escenario_id))];

    console.log(`📦 Importando ${items.length} asignación(es) móvil-zona para escenarios [${escenarioIds.join(', ')}]${rootTipoDeServicio ? ` tipo_de_servicio="${rootTipoDeServicio}"` : ''}...`);

    const supabase = getServerSupabaseClient();

    // 1) Borrar asignaciones anteriores por escenario + tipo_de_servicio
    //    También limpia filas con tipo_de_servicio vacío (datos corruptos)
    for (const escId of escenarioIds) {
      // Borrar filas del tipo de servicio específico
      const { error: delError1 } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId)
        .eq('tipo_de_servicio', rootTipoDeServicio);

      if (delError1) {
        console.error(`❌ Error al limpiar escenario ${escId} tipo=${rootTipoDeServicio}:`, delError1);
      }

      // También borrar filas con tipo_de_servicio vacío (residuos de imports anteriores)
      const { error: delError2 } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId)
        .eq('tipo_de_servicio', '');

      if (delError2) {
        console.error(`❌ Error al limpiar escenario ${escId} tipo=EMPTY:`, delError2);
      }

      console.log(`🗑️ Borrando moviles_zonas escenario=${escId} tipo_de_servicio="${rootTipoDeServicio}" + vacíos`);
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

    // 3) Recomputar contadores + sincronizar zonas_cap_entrega para todos los
    //    móviles únicos del import (best-effort — no aborta el response si falla).
    //
    //    RAZÓN: un import de movZonaServicio cambia las asignaciones zona→movil,
    //    lo que puede afectar lote_disponible en zonas_cap_entrega para cada móvil
    //    involucrado. recomputeMovilAndCapEntrega garantiza coherencia:
    //    primero actualiza cant_ped/cant_serv/capacidad, luego sincroniza zonas_cap_entrega.
    await recomputeForItems(items, 'POST import/movZonaServicio');

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
 * Mismo comportamiento que POST: importar asignaciones móvil-zona desde Genexus.
 *
 * TipoDeServicio a nivel raíz es OBLIGATORIO.
 * Borra filas del escenario con ese tipo_de_servicio (+ vacíos) e inserta las nuevas.
 * Recomputa contadores + sincroniza zonas_cap_entrega para todos los móviles afectados (best-effort).
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

    // TipoDeServicio a nivel raíz es OBLIGATORIO
    const rootTipoDeServicio = (body.TipoDeServicio || '').trim().toUpperCase();
    if (!rootTipoDeServicio) {
      console.error('❌ Falta TipoDeServicio a nivel raíz');
      return NextResponse.json(
        { error: 'Se requiere TipoDeServicio a nivel raíz del body (ej: "URGENTE", "SERVICE", "NOCTURNO")' },
        { status: 400 }
      );
    }
    console.log(`🏷️ TipoDeServicio raíz: "${rootTipoDeServicio}"`);

    let rawItems = body.MovZonas || [];
    if (!Array.isArray(rawItems)) rawItems = [rawItems];

    console.log(`📋 Items crudos recibidos: ${rawItems.length}`);
    if (rawItems.length > 0) {
      console.log('📋 Primer item crudo:', JSON.stringify(rawItems[0]));
      if (rawItems.length > 1) console.log('📋 Último item crudo:', JSON.stringify(rawItems[rawItems.length - 1]));
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una asignación en MovZonas' },
        { status: 400 }
      );
    }

    // Mapear items — inyectar rootTipoDeServicio en cada item que no lo tenga
    const items = rawItems.flatMap((item: any) => {
      if (rootTipoDeServicio && !item.TipoDeServicio && !item.tipo_de_servicio) {
        return mapGxItem({ ...item, TipoDeServicio: rootTipoDeServicio });
      }
      return mapGxItem(item);
    });

    if (items.length > 0) {
      console.log('🔄 Primer item mapeado:', JSON.stringify(items[0]));
      if (items.length > 1) console.log('🔄 Último item mapeado:', JSON.stringify(items[items.length - 1]));
    }

    const escenarioIds = [...new Set(items.map((i: any) => i.escenario_id))];
    console.log(`📦 PUT importando ${items.length} asignación(es) para escenarios [${escenarioIds.join(', ')}] tipo_de_servicio="${rootTipoDeServicio}"`);

    const supabase = getServerSupabaseClient();

    // 1) Borrar asignaciones anteriores por escenario + tipo_de_servicio + vacíos
    for (const escId of escenarioIds) {
      const { error: delError1 } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId)
        .eq('tipo_de_servicio', rootTipoDeServicio);

      if (delError1) {
        console.error(`❌ Error al limpiar escenario ${escId} tipo=${rootTipoDeServicio}:`, delError1);
      }

      // También borrar filas con tipo_de_servicio vacío (residuos)
      const { error: delError2 } = await (supabase as any)
        .from('moviles_zonas')
        .delete()
        .eq('escenario_id', escId)
        .eq('tipo_de_servicio', '');

      if (delError2) {
        console.error(`❌ Error al limpiar escenario ${escId} tipo=EMPTY:`, delError2);
      }

      console.log(`🗑️ Borrando moviles_zonas escenario=${escId} tipo_de_servicio="${rootTipoDeServicio}" + vacíos`);
    }

    // 2) Insertar en lotes de 500
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

    console.log(`✅ ${totalInserted} asignaciones importadas via PUT (escenarios: ${escenarioIds.join(', ')})`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 3) Recomputar contadores + sincronizar zonas_cap_entrega (best-effort)
    await recomputeForItems(items, 'PUT import/movZonaServicio');

    return NextResponse.json({
      success: true,
      message: `${totalInserted} asignaciones importadas correctamente`,
      count: totalInserted,
      escenarios: escenarioIds,
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
 * Eliminar asignaciones por movil_id, zona_id o ambos.
 * Recomputa contadores + sincroniza zonas_cap_entrega para los móviles afectados (best-effort).
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
      // Eliminar por IDs específicos — necesitamos recuperar los movil_id para el recompute
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

    // Recomputar contadores + sincronizar zonas_cap_entrega para los móviles
    // cuyas asignaciones fueron borradas (best-effort).
    if (data && data.length > 0) {
      await recomputeForItems(data as Array<{ movil_id: string }>, 'DELETE import/movZonaServicio');
    }

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
