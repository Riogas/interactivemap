import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/import/puntos-interes
 * Upsert masivo de puntos de interés desde Excel.
 * Matchea por `id` (clave primaria). Inserta si no existe, actualiza si existe.
 *
 * Body esperado:
 * {
 *   rows: Array<{
 *     id: number;
 *     nombre: string;
 *     categoria?: string;
 *     latitud: number;
 *     longitud: number;
 *     visible?: boolean;
 *     tipo?: string;
 *     telefono?: number | null;
 *     descripcion?: string | null;
 *     usuario_email: string;
 *     icono?: string;
 *     escenario_id?: number | null;
 *     empresa_fletera_id?: number | null;
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere un array "rows" con al menos una fila' },
        { status: 400 }
      );
    }

    // Validar campos requeridos
    for (const row of rows) {
      if (!row.id || !row.nombre || row.latitud == null || row.longitud == null || !row.usuario_email) {
        return NextResponse.json(
          { error: `Fila inválida: falta id, nombre, latitud, longitud o usuario_email`, row },
          { status: 400 }
        );
      }
    }

    console.log(`📍 Importando ${rows.length} punto(s) de interés...`);

    // Deduplicar por id (queda la última aparición) — evita "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const deduped = Object.values(
      rows.reduce((acc: Record<number, any>, row: any) => {
        acc[row.id] = row;
        return acc;
      }, {})
    );

    console.log(`📍 Después de deduplicar: ${deduped.length} registro(s) únicos`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('puntos_interes')
      .upsert(deduped, {
        onConflict: 'id',
        ignoreDuplicates: false,
      })
      .select('id, nombre');

    if (error) {
      console.error('❌ Error al upsert puntos_interes:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ ${data?.length || 0} punto(s) de interés actualizados`);
    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      updated: data?.map((r: any) => r.id) || [],
    });
  } catch (error: any) {
    console.error('❌ Error en POST /api/import/puntos-interes:', error);
    return NextResponse.json(
      { error: error.message || 'Error inesperado' },
      { status: 500 }
    );
  }
}
