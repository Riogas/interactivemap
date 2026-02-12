import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/services
 * Obtener services con filtros opcionales
 * Query params:
 * - escenario: número de escenario
 * - movil: ID del móvil
 * - moviles: IDs de móviles (comma-separated)
 * - estado: estado del service
 * - fecha: fecha del service (formato YYYY-MM-DD)
 * - empresa_fletera_id: ID de la empresa fletera
 * - conCoordenadas: 'true' para obtener solo services con lat/lng
 */
export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    
    const escenario = searchParams.get('escenario');
    const movil = searchParams.get('movil');
    const moviles = searchParams.get('moviles');
    const estado = searchParams.get('estado');
    const fecha = searchParams.get('fecha');
    const empresaFleteraId = searchParams.get('empresa_fletera_id');
    const conCoordenadas = searchParams.get('conCoordenadas') === 'true';

    console.log('🔧 GET /api/services - Parámetros:', {
      escenario,
      movil,
      moviles,
      estado,
      fecha,
      empresaFleteraId,
      conCoordenadas,
    });

    let query = supabase
      .from('services')
      .select('*');

    // Aplicar filtros
    if (escenario) {
      query = query.eq('escenario', parseInt(escenario));
    }

    if (moviles) {
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

    // Filtrar por fecha: OR para capturar services por fch_hora_para (timestamp) O fch_para (date)
    if (fecha) {
      const fechaInicio = `${fecha}T00:00:00`;
      const fechaFin = `${fecha}T23:59:59`;
      query = query.or(`and(fch_hora_para.gte.${fechaInicio},fch_hora_para.lte.${fechaFin}),fch_para.eq.${fecha}`);
    }

    if (empresaFleteraId) {
      query = query.eq('empresa_fletera_id', parseInt(empresaFleteraId));
    }

    if (conCoordenadas) {
      query = query.not('latitud', 'is', null).not('longitud', 'is', null);
    }

    // Ordenar por prioridad y fecha
    query = query.order('prioridad', { ascending: false }).order('fch_hora_para', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener services:', error);
      return NextResponse.json(
        { 
          success: false,
          error: 'Error al obtener services', 
          details: error.message 
        },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} services obtenidos`);

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
