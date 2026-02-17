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
    const moviles = searchParams.get('moviles'); // Comma-separated list for IN clause
    const estado = searchParams.get('estado');
    const fecha = searchParams.get('fecha');
    const empresaFleteraId = searchParams.get('empresa_fletera_id');
    const conCoordenadas = searchParams.get('conCoordenadas') === 'true';

    console.log('📦 GET /api/pedidos - Parámetros:', {
      escenario,
      movil,
      moviles,
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

    if (moviles) {
      // Soporte para múltiples móviles: moviles=472,473,474
      const movilesArray = moviles.split(',').map(m => parseInt(m)).filter(m => !isNaN(m));
      if (movilesArray.length > 0) {
        query = query.in('movil', movilesArray);
      }
    } else if (movil) {
      query = query.eq('movil', parseInt(movil));
    }

    if (estado) {
      query = query.eq('estado_nro', parseInt(estado));
    }

    // ✅ Filtrar por fecha: usar OR para capturar pedidos por fch_hora_para (timestamp) O fch_para (date)
    // Los pedidos finalizados (estado_nro=2) pueden no tener fch_hora_para pero sí fch_para
    // NOTA: fch_para se almacena como YYYYMMDD (sin guiones) en la BD
    if (fecha) {
      const fechaInicio = `${fecha}T00:00:00`;
      const fechaFin = `${fecha}T23:59:59`;
      const fechaSinGuiones = fecha.replace(/-/g, ''); // '2026-02-17' → '20260217'
      query = query.or(`and(fch_hora_para.gte.${fechaInicio},fch_hora_para.lte.${fechaFin}),fch_para.eq.${fechaSinGuiones}`);
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
