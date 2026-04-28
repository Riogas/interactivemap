import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { parseZonasJsonb } from '@/lib/auth-scope';

/**
 * GET /api/demoras
 * Obtener todas las demoras (para Capas de Información en el mapa)
 *
 * Query params:
 *   - escenarioId: filtrar por escenario
 *   - zonaId: filtrar por zona
 *   - activa: filtrar por estado (default: todas)
 *   - empresaIds: CSV de empresa_fletera_id (scoping vía fleteras_zonas)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId');
    const zonaId = searchParams.get('zonaId');
    const activa = searchParams.get('activa');
    const empresaIdsCsv = searchParams.get('empresaIds');

    const supabase = getServerSupabaseClient();

    // Si se piden empresaIds, resolver el set de zonas permitidas y filtrar por él.
    let allowedZonaIds: Set<number> | null = null;
    if (empresaIdsCsv !== null) {
      const empresaIds = empresaIdsCsv
        .split(',')
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n));
      if (empresaIds.length === 0) {
        return NextResponse.json({ success: true, count: 0, data: [] });
      }
      let fzQuery = (supabase as any)
        .from('fleteras_zonas')
        .select('zonas')
        .in('empresa_fletera_id', empresaIds);
      if (escenarioId) {
        fzQuery = fzQuery.eq('escenario_id', parseInt(escenarioId));
      }
      const { data: fzData, error: fzError } = await fzQuery;
      if (fzError) {
        console.error('❌ Error al resolver scope de zonas (demoras):', fzError);
        return NextResponse.json(
          { error: 'Error al resolver scope de zonas', details: fzError.message },
          { status: 500 },
        );
      }
      allowedZonaIds = new Set<number>();
      for (const row of fzData ?? []) {
        for (const z of parseZonasJsonb(row?.zonas)) allowedZonaIds.add(z);
      }
      if (allowedZonaIds.size === 0) {
        return NextResponse.json({ success: true, count: 0, data: [] });
      }
    }

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

    if (allowedZonaIds && allowedZonaIds.size > 0) {
      query = query.in('zona_id', Array.from(allowedZonaIds));
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
