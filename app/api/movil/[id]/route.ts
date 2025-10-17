import { NextResponse } from 'next/server';
import { getMovilCoordinates } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const movilId = parseInt(params.id);
    
    if (isNaN(movilId)) {
      return NextResponse.json(
        { error: 'Invalid movil ID' },
        { status: 400 }
      );
    }

    // Obtener startDate del query string si existe
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const dateToUse = startDate || new Date().toISOString().split('T')[0];

    console.log(`🚗 API /movil/${movilId} - Fetching history (date: ${dateToUse})`);
    
    // Obtener el historial del día especificado (hasta 100 registros)
    const history = await getMovilCoordinates(movilId, dateToUse, 100);
    
    console.log(`✅ API /movil/${movilId} - Returning ${history.length} coordinates`);

    return NextResponse.json({
      success: true,
      movilId,
      count: history.length,
      data: history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const params = await context.params;
    console.error(`❌ API Error for movil ${params.id}:`, error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch movil history',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
