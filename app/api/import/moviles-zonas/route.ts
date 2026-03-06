import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * POST /api/import/moviles-zonas
 * Importar asignaciones móvil-zona (insert)
 */
export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { asignaciones } = body;

    if (!asignaciones) {
      asignaciones = body;
    }

    const items = Array.isArray(asignaciones) ? asignaciones : [asignaciones];

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una asignación móvil-zona' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${items.length} asignación(es) móvil-zona...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('moviles_zonas')
      .insert(items)
      .select();

    if (error) {
      console.error('❌ Error al importar moviles_zonas:', error);
      return NextResponse.json(
        { error: 'Error al importar asignaciones', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} asignaciones importadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} asignaciones importadas correctamente`,
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
 * PUT /api/import/moviles-zonas
 * Upsert asignaciones móvil-zona (insertar o actualizar por movil_id + zona_id)
 */
export async function PUT(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { asignaciones } = body;

    if (!asignaciones) {
      asignaciones = body;
    }

    const items = Array.isArray(asignaciones) ? asignaciones : [asignaciones];

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una asignación para actualizar' },
        { status: 400 }
      );
    }

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

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} asignaciones actualizadas correctamente`,
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
 * DELETE /api/import/moviles-zonas
 * Eliminar asignaciones por movil_id, zona_id o ambos
 */
export async function DELETE(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { movil_id, zona_id, ids } = body;

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
