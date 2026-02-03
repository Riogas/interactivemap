import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

export async function PUT(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { demoras } = body;

    // Si no viene "demoras", asumir que el body ES la demora
    if (!demoras) {
      demoras = body;
    }

    // Normalizar a array si es un solo objeto
    const demorasArray = Array.isArray(demoras) ? demoras : [demoras];

    if (demorasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una demora para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${demorasArray.length} demora(s)...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase
      .from('demoras')
      .upsert(demorasArray, {
        onConflict: 'demora_id',
      })
      .select();

    if (error) {
      console.error('❌ Error al actualizar demoras:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ ${data?.length || 0} demora(s) actualizada(s)`);
    return NextResponse.json({ success: true, count: data?.length || 0, data });
  } catch (error: any) {
    console.error('❌ Error en PUT /api/import/demoras:', error);
    return NextResponse.json(
      { error: error.message || 'Error al actualizar demoras' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/import/demoras
 * Importar demoras desde fuente externa
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { demoras } = body;

    // Si no viene "demoras", asumir que el body ES la demora
    if (!demoras) {
      demoras = body;
    }

    // Normalizar a array si es un solo objeto
    const demorasArray = Array.isArray(demoras) ? demoras : [demoras];

    if (demorasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una demora' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${demorasArray.length} demora(s)...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase
      .from('demoras')
      .insert(demorasArray)
      .select();

    if (error) {
      console.error('❌ Error al importar demoras:', error);
      return NextResponse.json(
        { error: 'Error al importar demoras', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} demoras importadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} demoras importadas correctamente`,
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
 * DELETE /api/import/demoras
 * Eliminar demoras por IDs
 */
export async function DELETE(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { demora_ids } = body;

    if (!demora_ids || !Array.isArray(demora_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de demora_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${demora_ids.length} demoras...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase
      .from('demoras')
      .delete()
      .in('demora_id', demora_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar demoras:', error);
      return NextResponse.json(
        { error: 'Error al eliminar demoras', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} demoras eliminadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} demoras eliminadas correctamente`,
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
