import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

/**
 * POST /api/import/zonas
 * Importar zonas desde fuente externa
 */
export async function POST(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { zonas } = body;

    // Si no viene "zonas", asumir que el body ES la zona
    if (!zonas) {
      zonas = body;
    }

    // Normalizar a array si es un solo objeto
    const zonasArray = Array.isArray(zonas) ? zonas : [zonas];

    if (zonasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una zona' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${zonasArray.length} zona(s)...`);

    const { data, error } = await supabase
      .from('zonas')
      .insert(zonasArray)
      .select();

    if (error) {
      console.error('❌ Error al importar zonas:', error);
      return NextResponse.json(
        { error: 'Error al importar zonas', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} zonas importadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} zonas importadas correctamente`,
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
 * PUT /api/import/zonas
 * Actualizar zonas existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    let { zonas } = body;

    // Si no viene "zonas", asumir que el body ES la zona
    if (!zonas) {
      zonas = body;
    }

    // Normalizar a array si es un solo objeto
    const zonasArray = Array.isArray(zonas) ? zonas : [zonas];

    if (zonasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una zona para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${zonasArray.length} zona(s)...`);

    const { data, error } = await supabase
      .from('zonas')
      .upsert(zonasArray, {
        onConflict: 'zona_id', // Ajusta según tu columna única
      })
      .select();

    if (error) {
      console.error('❌ Error al actualizar zonas:', error);
      return NextResponse.json(
        { error: 'Error al actualizar zonas', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} zonas actualizadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} zonas actualizadas correctamente`,
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
 * DELETE /api/import/zonas
 * Eliminar zonas por IDs
 */
export async function DELETE(request: NextRequest) {
  // 🔒 VALIDAR API KEY
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const { zona_ids } = body;

    if (!zona_ids || !Array.isArray(zona_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de zona_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${zona_ids.length} zonas...`);

    const { data, error } = await supabase
      .from('zonas')
      .delete()
      .in('zona_id', zona_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar zonas:', error);
      return NextResponse.json(
        { error: 'Error al eliminar zonas', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} zonas eliminadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} zonas eliminadas correctamente`,
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
