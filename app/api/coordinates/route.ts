import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const movilId = searchParams.get('movilId');
  const escenario = searchParams.get('escenario') || '1000';
  const limit = searchParams.get('limit');

  if (!movilId) {
    return NextResponse.json(
      { error: 'movilId is required' },
      { status: 400 }
    );
  }

  try {
    const supabase = getServerSupabaseClient();
    
    // Obtener historial de coordenadas del móvil
    const { data: coordinates, error } = await supabase
      .from('gps_tracking_extended')
      .select('*')
      .eq('movil_id', parseInt(movilId))
      .eq('escenario', escenario)
      .order('fecha_hora', { ascending: false })
      .limit(limit ? parseInt(limit) : 100);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: coordinates || [],
      count: coordinates?.length || 0,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch coordinates',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
