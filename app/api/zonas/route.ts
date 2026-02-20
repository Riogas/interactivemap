import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/zonas
 * Obtener todas las zonas disponibles
 */
export async function GET() {
  try {
    const { data, error } = await (supabase as any)
      .from('zonas')
      .select('*')
      .order('zona_id', { ascending: true });

    if (error) {
      console.error('❌ Error al obtener zonas:', error);
      return NextResponse.json(
        { error: 'Error al obtener zonas', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
