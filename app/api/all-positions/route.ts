import { NextResponse } from 'next/server';
import { getAllMovilesLatestPositionsByEmpresas } from '@/lib/db';
import { getMovilColor } from '@/types';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Obtener parámetros de query string
    const searchParams = request.nextUrl.searchParams;
    const empresaIdsParam = searchParams.get('empresaIds');
    const startDate = searchParams.get('startDate');
    
    // Parsear empresaIds si existe
    const empresaIds = empresaIdsParam 
      ? empresaIdsParam.split(',').map(id => parseInt(id.trim()))
      : undefined;
    
    if (empresaIds && empresaIds.length > 0) {
      console.log(`🚀 API /all-positions - Fetching móviles for empresas: ${empresaIds.join(', ')} (date: ${startDate || 'today'})`);
    } else {
      console.log(`🚀 API /all-positions - Fetching ALL móviles from AS400 (date: ${startDate || 'today'})`);
    }
    
    // Obtener posiciones filtradas por empresa (o todas si no hay filtro)
    const positions = await getAllMovilesLatestPositionsByEmpresas(startDate || undefined, empresaIds);

    const data = Array.from(positions.entries()).map(([id, position], index) => ({
      movilId: id,
      movilName: `Móvil ${id}`,
      color: getMovilColor(index),
      position,
    }));

    console.log(`✅ API /all-positions - Returning ${data.length} móviles`);

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
      empresaIds: empresaIds || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch all positions',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
