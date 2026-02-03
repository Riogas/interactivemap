import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/pedidos
 * Obtener pedidos con filtros opcionales
 * Query params:
 * - escenario: número de escenario
 * - movil: ID del móvil
 * - estado: estado del pedido
 * - fecha: fecha del pedido (formato YYYY-MM-DD)
 * - empresa_fletera_id: ID de la empresa fletera
 * - conCoordenadas: 'true' para obtener solo pedidos con lat/lng
 */
export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    
    const escenario = searchParams.get('escenario');
    const movil = searchParams.get('movil');
    const estado = searchParams.get('estado');
    const fecha = searchParams.get('fecha');
    const empresaFleteraId = searchParams.get('empresa_fletera_id');
    const conCoordenadas = searchParams.get('conCoordenadas') === 'true';

    console.log('📦 GET /api/pedidos - Parámetros:', {
      escenario,
      movil,
      estado,
      fecha,
      empresaFleteraId,
      conCoordenadas,
    });

    let query = supabase
      .from('pedidos')
      .select('*');

    // Aplicar filtros
    if (escenario) {
      query = query.eq('escenario', parseInt(escenario));
    }

    if (movil) {
      query = query.eq('movil', parseInt(movil));
    }

    if (estado) {
      query = query.eq('estado_nro', parseInt(estado));
    }

    // Si se especifica fecha, mostrar pedidos de esa fecha O sin fecha O con fecha anterior (atrasados)
    // Esto permite ver pedidos pendientes que deberían haberse entregado antes
    if (fecha) {
      query = query.or(`fch_para.eq.${fecha},fch_para.is.null,fch_para.lte.${fecha}`);
    }

    if (empresaFleteraId) {
      query = query.eq('empresa_fletera_id', parseInt(empresaFleteraId));
    }

    // Filtrar solo pedidos con coordenadas
    if (conCoordenadas) {
      query = query.not('latitud', 'is', null).not('longitud', 'is', null);
    }

    // Ordenar por prioridad y fecha
    query = query.order('prioridad', { ascending: false }).order('fch_hora_para', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener pedidos:', error);
      return NextResponse.json(
        { 
          success: false,
          error: 'Error al obtener pedidos', 
          details: error.message 
        },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} pedidos obtenidos`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Error interno del servidor', 
        details: error.message 
      },
      { status: 500 }
    );
  }
}
