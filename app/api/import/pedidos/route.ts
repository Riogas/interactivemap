import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * POST /api/import/pedidos
 * Importar pedidos desde fuente externa
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { pedidos } = body;

    // Si no viene "pedidos", asumir que el body ES el pedido
    if (!pedidos) {
      pedidos = body;
    }

    // Normalizar a array si es un solo objeto
    const pedidosArray = Array.isArray(pedidos) ? pedidos : [pedidos];

    if (pedidosArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un pedido' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${pedidosArray.length} pedido(s)...`);

    const { data, error } = await supabase
      .from('pedidos')
      .insert(pedidosArray)
      .select();

    if (error) {
      console.error('❌ Error al importar pedidos:', error);
      return NextResponse.json(
        { error: 'Error al importar pedidos', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} pedidos importados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} pedidos importados correctamente`,
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
 * PUT /api/import/pedidos
 * Actualizar pedidos existentes (upsert)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    let { pedidos } = body;

    // Si no viene "pedidos", asumir que el body ES el pedido
    if (!pedidos) {
      pedidos = body;
    }

    // Normalizar a array si es un solo objeto
    const pedidosArray = Array.isArray(pedidos) ? pedidos : [pedidos];

    if (pedidosArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un pedido para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Actualizando ${pedidosArray.length} pedido(s)...`);

    const { data, error } = await supabase
      .from('pedidos')
      .upsert(pedidosArray, {
        onConflict: 'pedido_id',
      })
      .select();

    if (error) {
      console.error('❌ Error al actualizar pedidos:', error);
      return NextResponse.json(
        { error: 'Error al actualizar pedidos', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} pedidos actualizados`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} pedidos actualizados correctamente`,
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
 * DELETE /api/import/pedidos
 * Eliminar pedidos por IDs
 */
export async function DELETE(request: NextRequest) {
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
      .in('pedido_id', pedido_ids)
      .select();

    if (error) {
      console.error('❌ Error al eliminar pedidos:', error);
      return NextResponse.json(
        { error: 'Error al eliminar pedidos', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} pedidos eliminados`);

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
