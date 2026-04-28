import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { parseZonasJsonb } from '@/lib/auth-scope';

/**
 * GET /api/zonas
 * Obtener todas las zonas disponibles
 *
 * Query params opcionales:
 *   - empresaIds: CSV de empresa_fletera_id (filtra zonas vía fleteras_zonas)
 *   - escenarioId: filtra fleteras_zonas por escenario al resolver el set permitido
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getServerSupabaseClient();
    const sp = request.nextUrl.searchParams;

    // Resolver set de zonas permitidas a partir de empresaIds (si se piden)
    const empresaIdsCsv = sp.get('empresaIds');
    const empresaIds = empresaIdsCsv
      ? empresaIdsCsv.split(',').map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n))
      : null;
    const escenarioIdRaw = sp.get('escenarioId');
    const escenarioId = escenarioIdRaw ? parseInt(escenarioIdRaw, 10) : null;

    let allowedZonaIds: Set<number> | null = null;
    if (empresaIds && empresaIds.length === 0) {
      // empresaIds= (vacío) → fail-closed
      return NextResponse.json({ success: true, count: 0, data: [] });
    }
    if (empresaIds && empresaIds.length > 0) {
      let fzQuery = (supabase as any)
        .from('fleteras_zonas')
        .select('zonas')
        .in('empresa_fletera_id', empresaIds);
      if (escenarioId !== null && Number.isFinite(escenarioId)) {
        fzQuery = fzQuery.eq('escenario_id', escenarioId);
      }
      const { data: fzData, error: fzError } = await fzQuery;
      if (fzError) {
        console.error('❌ Error al resolver scope de zonas:', fzError);
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
      .from('zonas')
      .select('*')
      .order('zona_id', { ascending: true });

    if (allowedZonaIds && allowedZonaIds.size > 0) {
      query = query.in('zona_id', Array.from(allowedZonaIds));
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener zonas:', error);
      return NextResponse.json(
        { error: 'Error al obtener zonas', details: error.message },
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
