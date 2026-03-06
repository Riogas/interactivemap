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
 *   - activa: filtrar por estado (default: true)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const movilId = searchParams.get('movilId');
    const zonaId = searchParams.get('zonaId');
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
