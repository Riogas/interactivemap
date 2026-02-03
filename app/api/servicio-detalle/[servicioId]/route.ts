import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';

const AS400_API_URL = process.env.AS400_API_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ servicioId: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const params = await context.params;
    const servicioId = params.servicioId;

    const response = await fetch(`${AS400_API_URL}/servicio-detalle/${servicioId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Error from AS400 API: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Error fetching servicio details: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ Error in servicio-detalle API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch servicio details' },
      { status: 500 }
    );
  }
}
