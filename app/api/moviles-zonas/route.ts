import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/moviles-zonas
 * Obtener asignaciones móvil-zona
 * 
 * Query params:
 *   - movilId: filtrar por móvil específico
 *   - zonaId: filtrar por zona específica
 *   - escenarioId: filtrar por escenario (default: todos)
 *   - activa: filtrar por estado (default: true)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const movilId = searchParams.get('movilId');
    const zonaId = searchParams.get('zonaId');
    const escenarioId = searchParams.get('escenarioId');
    const activa = searchParams.get('activa');

    const supabase = getServerSupabaseClient();
    let query = (supabase as any)
      .from('moviles_zonas')
      .select('*')
      .order('zona_id', { ascending: true });

    if (movilId) {
      query = query.eq('movil_id', movilId);
    }

    if (zonaId) {
      query = query.eq('zona_id', parseInt(zonaId));
    }

    if (escenarioId) {
      query = query.eq('escenario_id', parseInt(escenarioId));
    }

    // Por defecto solo activas, salvo que se pida explícitamente todas
    if (activa !== 'all') {
      query = query.eq('activa', activa !== 'false');
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener moviles_zonas:', error);
      return NextResponse.json(
        { error: 'Error al obtener asignaciones', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
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
 * POST /api/moviles-zonas
 * Guardar asignaciones desde el modal de Zonas.
 *
 * Body esperado:
 * {
 *   "escenario_id": 1000,           // opcional, default 1000
 *   "asignaciones": {
 *     "<zona_id>": [
 *       { "movilId": 304, "tipo": "prioridad" },
 *       { "movilId": 305, "tipo": "transito" }
 *     ],
 *     ...
 *   }
 * }
 *
 * Comportamiento: REEMPLAZA todas las asignaciones del escenario indicado
 * con las nuevas. Esto mantiene consistencia con el import de Genexus.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { escenario_id = 1000, asignaciones } = body;

    if (!asignaciones || typeof asignaciones !== 'object') {
      return NextResponse.json(
        { error: 'Se requiere el campo "asignaciones"' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    // 1) Borrar todas las asignaciones del escenario
    const { error: delError } = await (supabase as any)
      .from('moviles_zonas')
      .delete()
      .eq('escenario_id', escenario_id);

    if (delError) {
      console.error('❌ Error al limpiar asignaciones:', delError);
      return NextResponse.json(
        { error: 'Error al limpiar asignaciones previas', details: delError.message },
        { status: 500 }
      );
    }

    // 2) Construir filas desde el mapa de asignaciones
    const rows: Record<string, any>[] = [];
    for (const [zonaIdStr, items] of Object.entries(asignaciones)) {
      const zona_id = parseInt(zonaIdStr, 10);
      if (isNaN(zona_id) || !Array.isArray(items)) continue;
      for (const item of items) {
        rows.push({
          movil_id: String(item.movilId),
          zona_id,
          escenario_id,
          prioridad_o_transito: item.tipo === 'prioridad' ? 1 : 2,
          activa: true,
          tipo_de_zona: '',
          tipo_de_servicio: '',
        });
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Todas las asignaciones eliminadas',
        count: 0,
      });
    }

    // 3) Insertar por lotes
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { data, error } = await (supabase as any)
        .from('moviles_zonas')
        .insert(batch)
        .select();

      if (error) {
        console.error('❌ Error al insertar asignaciones:', error);
        return NextResponse.json(
          { error: 'Error al guardar asignaciones', details: error.message, inserted_so_far: totalInserted },
          { status: 500 }
        );
      }
      totalInserted += data?.length || 0;
    }

    console.log(`✅ ${totalInserted} asignaciones guardadas (escenario: ${escenario_id})`);

    return NextResponse.json({
      success: true,
      message: `${totalInserted} asignaciones guardadas correctamente`,
      count: totalInserted,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en POST /api/moviles-zonas:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
