import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { fetchExternalAPI } from '@/lib/fetch-with-timeout';

const AS400_API_URL = process.env.AS400_API_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ pedidoId: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const params = await context.params;
    const pedidoId = params.pedidoId;

    // 🔧 TIMEOUT + REINTENTOS: fetchExternalAPI usa 30s timeout y 2 reintentos
    const response = await fetchExternalAPI(`${AS400_API_URL}/pedido-detalle/${pedidoId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Error from AS400 API: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Error fetching pedido details: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ Error in pedido-detalle API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pedido details' },
      { status: 500 }
    );
  }
}
