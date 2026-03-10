import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/demoras
 * Obtener todas las demoras (para vista de datos en el mapa)
 * 
 * Query params:
 *   - escenarioId: filtrar por escenario
 *   - zonaId: filtrar por zona
 *   - activa: filtrar por estado (default: todas)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId');
    const zonaId = searchParams.get('zonaId');
    const activa = searchParams.get('activa');

    const supabase = getServerSupabaseClient();
    let query = (supabase as any)
      .from('demoras')
      .select('*')
      .order('zona_id', { ascending: true });

    if (escenarioId) {
      query = query.eq('escenario_id', parseInt(escenarioId));
    }

    if (zonaId) {
      query = query.eq('zona_id', parseInt(zonaId));
    }

    if (activa === 'true') {
      query = query.eq('activa', true);
    } else if (activa === 'false') {
      query = query.eq('activa', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener demoras:', error);
      return NextResponse.json(
        { error: 'Error al obtener demoras', details: error.message },
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
