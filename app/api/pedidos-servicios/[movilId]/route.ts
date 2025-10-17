import { NextRequest, NextResponse } from 'next/server';
import { getPedidosServiciosMovil } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  try {
    const resolvedParams = await params; // Next.js 15 requiere await
    const movilId = parseInt(resolvedParams.movilId);
    const searchParams = request.nextUrl.searchParams;
    const fechaDesde = searchParams.get('fechaDesde') || undefined;

    const result = await getPedidosServiciosMovil(movilId, fechaDesde);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching pedidos/servicios:', error);
    return NextResponse.json(
      { success: false, error: 'Error al obtener pedidos/servicios' },
      { status: 500 }
    );
  }
}
