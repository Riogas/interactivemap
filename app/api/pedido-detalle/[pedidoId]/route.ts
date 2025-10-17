import { NextResponse } from 'next/server';

const AS400_API_URL = process.env.AS400_API_URL || 'http://localhost:8000';

export async function GET(
  request: Request,
  context: { params: Promise<{ pedidoId: string }> }
) {
  try {
    const params = await context.params;
    const pedidoId = params.pedidoId;

    const response = await fetch(`${AS400_API_URL}/pedido-detalle/${pedidoId}`, {
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
