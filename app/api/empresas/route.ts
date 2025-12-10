import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const escenarioId = searchParams.get('escenario_id') || '1000'; // Cambiado a 1000
    
    console.log('🏢 API /empresas - Fetching empresas fleteras from Supabase');
    
    const supabase = getServerSupabaseClient();
    
    const { data: empresas, error } = await supabase
      .from('empresas_fleteras')
      .select('*')
      .eq('escenario_id', escenarioId)
      .eq('estado', 1) // Solo empresas activas
      .order('nombre');

    if (error) {
      throw error;
    }

    console.log(`✅ API /empresas - Returning ${empresas?.length || 0} empresas`);

    return NextResponse.json({
      success: true,
      count: empresas?.length || 0,
      data: empresas || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch empresas fleteras',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
