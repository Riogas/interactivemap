import { NextRequest, NextResponse } from 'next/server';
impoexport async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    let { puntoventa } = body;

    // Si no viene "puntoventa", asumir que el body ES el punto de venta
    if (!puntoventa) {
      puntoventa = body;
    }

    // Normalizar a array si es un solo objeto
    const puntoventaArray = Array.isArray(puntoventa) ? puntoventa : [puntoventa];

    if (puntoventaArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un punto de venta para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${puntoventaArray.length} punto(s) de venta...`);

    const { data, error } = await supabase
      .from('puntoventa')
      .upsert(puntoventaArray, {
        onConflict: 'puntoventa_id',
      })
      .select(); '@/lib/supabase';

/**
 * POST /api/import/puntoventa
 * Importar puntos de venta desde fuente externa
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { puntoventa } = body;

    // Si no viene "puntoventa", asumir que el body ES el punto de venta
    if (!puntoventa) {
      puntoventa = body;
    }

    // Normalizar a array si es un solo objeto
    const puntoventaArray = Array.isArray(puntoventa) ? puntoventa : [puntoventa];

    if (puntoventaArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un punto de venta' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${puntoventaArray.length} punto(s) de venta...`);

    const { data, error } = await supabase
      .from('puntoventa')
      .insert(puntoventaArray)
      .select();

    if (error) {
      console.error('❌ Error al importar puntos de venta:', error);
      return NextResponse.json(
        { error: 'Error al importar puntos de venta', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} puntos de venta importados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} puntos de venta importados correctamente`,
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
 * PUT /api/import/puntoventa
 * Actualizar puntos de venta existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { puntoventa } = body;

    if (!puntoventa || !Array.isArray(puntoventa)) {
      return NextResponse.json(
        { error: 'Se requiere un array de puntoventa' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${puntoventa.length} puntos de venta...`);

    const { data, error } = await supabase
      .from('puntoventa')
      .upsert(puntoventa, {
        onConflict: 'puntoventa_id', // Ajusta según tu columna única
      })
      .select();

    if (error) {
      console.error('❌ Error al actualizar puntos de venta:', error);
      return NextResponse.json(
        { error: 'Error al actualizar puntos de venta', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} puntos de venta actualizados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} puntos de venta actualizados correctamente`,
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
 * DELETE /api/import/puntoventa
 * Eliminar puntos de venta por IDs
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { puntoventa_ids } = body;

    if (!puntoventa_ids || !Array.isArray(puntoventa_ids)) {
      return NextResponse.json(
        { error: 'Se requiere un array de puntoventa_ids' },
        { status: 400 }
      );
    }

    console.log(`🗑️ Eliminando ${puntoventa_ids.length} puntos de venta...`);

    const { data, error } = await supabase
      .from('puntoventa')
      .delete()
      .in('puntoventa_id', puntoventa_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar puntos de venta:', error);
      return NextResponse.json(
        { error: 'Error al eliminar puntos de venta', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} puntos de venta eliminados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} puntos de venta eliminados correctamente`,
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
