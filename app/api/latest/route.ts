import { NextRequest, NextResponse } from 'next/server';
import { getLatestPosition } from '@/lib/db'; // Conexión real DB2
// import { getLatestPosition } from '@/lib/db-mock'; // Datos mock para desarrollo

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const movilId = searchParams.get('movilId');

  if (!movilId) {
    return NextResponse.json(
      { error: 'movilId is required' },
      { status: 400 }
    );
  }

  try {
    const position = await getLatestPosition(parseInt(movilId));

    if (!position) {
      return NextResponse.json(
        { error: 'No position found for this movil' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: position,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch latest position',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
