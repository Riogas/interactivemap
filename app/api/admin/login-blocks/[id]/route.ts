import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireFuncionalidad(request, 'Query Inicios de sesion');
  if (gate !== true) return gate;

  try {
    const { id } = await params;
    const blockId = parseInt(id, 10);

    if (!blockId || isNaN(blockId)) {
      return NextResponse.json(
        { success: false, error: 'ID inválido' },
        { status: 400 }
      );
    }

    const client = getServerSupabaseClient();

    const { error } = await client
      .from('login_blocks')
      .delete()
      .eq('id', blockId);

    if (error) {
      console.error('Error deleting login_block:', error);
      return NextResponse.json(
        { success: false, error: 'Error al desbloquear' },
        { status: 500 }
      );
    }

    console.log(`✅ Bloqueo ${blockId} eliminado manualmente`);

    return NextResponse.json({
      success: true,
      message: 'Bloqueo eliminado',
    });
  } catch (error) {
    console.error('Error en DELETE /api/admin/login-blocks/[id]:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
