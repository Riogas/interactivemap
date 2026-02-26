import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

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
    
    // Obtener la posición más reciente del móvil desde gps_latest_positions (1 fila por móvil)
    const { data: position, error } = await supabase
      .from('gps_latest_positions')
      .select('*')
      .eq('movil_id', movilId)
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
