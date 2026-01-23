import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const movilId = searchParams.get('movilId');

  if (!movilId) {
    return NextResponse.json(
      { error: 'movilId is required' },
      { status: 400 }
    );
  }

  try {
    const supabase = getServerSupabaseClient();
    
    // Obtener la posición más reciente del móvil desde gps_tracking_extended
    const { data: position, error } = await supabase
      .from('gps_tracking_extended')
      .select('*')
      .eq('movil_id', parseInt(movilId))
      .order('fecha_hora', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    if (!position) {
      return NextResponse.json(
        { error: 'No position found for this movil' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: position,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch latest position',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
