import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    // Obtener parámetros de query
    const searchParams = request.nextUrl.searchParams;
    const escenarioId = searchParams.get('escenarioId') || '1';
    const fecha = searchParams.get('fecha') || new Date().toISOString().split('T')[0];

    console.log(`📦 Obteniendo TODOS los pedidos pendientes del día ${fecha}`);

    // Consultar TODOS los pedidos pendientes filtrando por fecha exacta
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        escenario,
        movil,
        estado_nro,
        latitud,
        longitud,
        zona_nro,
        tipo,
        servicio_nombre,
        producto_cod,
        producto_nom,
        producto_cant,
        precio,
        prioridad,
        pedido_obs,
        imp_flete,
        imp_bruto,
        fch_para,
        fch_hora_max_ent_comp,
        fch_hora_para,
        fch_hora_mov,
        cliente_nombre,
        cliente_direccion,
        cliente_nro,
        cliente_tel,
        cliente_obs,
        empresa_fletera_id
      `)
      .eq('escenario', escenarioId)
      .eq('fch_para', fecha) // ✅ FILTRAR POR FECHA EXACTA
      .in('estado_nro', [1, 2]) // Solo pedidos pendientes (Asignado y En camino)
      .not('latitud', 'is', null) // Solo pedidos con coordenadas
      .not('longitud', 'is', null)
      .order('prioridad', { ascending: false })
      .order('fch_hora_para', { ascending: true});

    if (error) {
      console.error('❌ Error al obtener todos los pedidos pendientes:', error);
      return NextResponse.json(
        { error: 'Error al obtener pedidos pendientes' },
        { status: 500 }
      );
    }

    console.log(`✅ Encontrados ${pedidos?.length || 0} pedidos pendientes para el día ${fecha}`);

    return NextResponse.json({
      escenarioId: parseInt(escenarioId),
      fecha,
      pedidos: pedidos || [],
      total: pedidos?.length || 0,
    });
  } catch (error) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
