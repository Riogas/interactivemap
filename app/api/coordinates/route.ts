import { NextRequest, NextResponse } from 'next/server';
import { getMovilCoordinates } from '@/lib/db'; // Conexión real DB2
// import { getMovilCoordinates } from '@/lib/db-mock'; // Datos mock para desarrollo

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const movilId = searchParams.get('movilId');
  const startDate = searchParams.get('startDate');
  const limit = searchParams.get('limit');

  if (!movilId) {
    return NextResponse.json(
      { error: 'movilId is required' },
      { status: 400 }
    );
  }

  try {
    const coordinates = await getMovilCoordinates(
      parseInt(movilId),
      startDate || undefined,
      limit ? parseInt(limit) : 100
    );

    return NextResponse.json({
      success: true,
      data: coordinates,
      count: coordinates.length,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch coordinates',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
