import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movilId: string }> }
) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { movilId } = await params;

    // Obtener parámetros de query
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId') || '1';

    // Consultar pedidos pendientes del móvil
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        escenario,
        movil,
        estado_nro,
        cliente_ciudad,
        cliente_direccion,
        cliente_nombre,
        cliente_nro,
        cliente_tel,
        cliente_obs,
        detalle_html,
        empresa_fletera_id,
        fch_hora_max_ent_comp,
        fch_para,
        google_maps_url,
        imp_bruto,
        imp_flete,
        pedido_obs,
        precio,
        prioridad,
        producto_cant,
        producto_cod,
        producto_nom,
        servicio_nombre,
        tipo,
        ubicacion,
        zona_nro
      `)
      .eq('movil', movilId)
      .eq('escenario', escenarioId)
      .in('estado_nro', [1, 2, 3, 4, 5, 6, 7]) // Estados que representan pendientes
      .not('latitud', 'is', null) // Solo pedidos con coordenadas
      .not('longitud', 'is', null)
      .order('prioridad', { ascending: false })
      .order('fch_hora_para', { ascending: true});

    if (error) {
      console.error('Error al obtener pedidos pendientes:', error);
      return NextResponse.json(
        { error: 'Error al obtener pedidos pendientes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      movilId: parseInt(movilId),
      escenarioId: parseInt(escenarioId),
      pedidos: pedidos || [],
      total: pedidos?.length || 0,
    });
  } catch (error) {
    console.error('Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
