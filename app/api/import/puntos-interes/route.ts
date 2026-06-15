import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/import/puntos-interes
 * Upsert masivo de puntos de interés desde Excel.
 *
 * Lógica de matcheo por ID (respeta el id de la planilla):
 *   - El id del Excel es la conflict key — upsert por id.
 *   - Si (usuario_email, nombre) ya existe en BD con un id DISTINTO al del Excel:
 *     DELETE el row conflictivo + INSERT el row del Excel con su id.
 *   - POIs privados se sobrescriben igual que cualquier otro (sin skip).
 *   - POIs que no vienen en el Excel quedan intocados.
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
 *
 * Response:
 * {
 *   success: true;
 *   created: number[];       // ids procesados via upsert (insert+update)
 *   replaced: Array<{ deletedId: number; newId: number; nombre: string; usuario_email: string }>;
 *   count: number;           // created.length
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
      if (!row.nombre || row.latitud == null || row.longitud == null || !row.usuario_email) {
        return NextResponse.json(
          { error: 'Fila inválida: falta nombre, latitud, longitud o usuario_email', row },
          { status: 400 }
        );
      }
    }

    console.log(`📍 Importando ${rows.length} punto(s) de interés...`);

    // Deduplicar por id — última fila gana.
    // Evita conflictos internos si el Excel trae el mismo id más de una vez.
    const deduped: any[] = Object.values(
      rows.reduce((acc: Record<string, any>, row: any) => {
        acc[String(row.id)] = row;
        return acc;
      }, {})
    );

    console.log(`📍 Después de deduplicar por id: ${deduped.length} registro(s) únicos`);

    const supabase = getServerSupabaseClient();

    // Obtener todos los emails únicos del batch para hacer un SELECT eficiente.
    const uniqueEmails: string[] = [...new Set<string>(deduped.map((r: any) => r.usuario_email))];

    // Buscar conflictos: rows en BD que tienen el mismo (usuario_email, nombre)
    // que alguno del Excel PERO con un id diferente al del Excel.
    // Estos rows hay que borrarlos antes del upsert para no violar la unique constraint.
    const { data: conflicting, error: conflictError } = await (supabase as any)
      .from('puntos_interes')
      .select('id, nombre, usuario_email')
      .in('usuario_email', uniqueEmails);

    if (conflictError) {
      console.error('❌ Error al consultar conflictos en puntos_interes:', conflictError);
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }

    // Construir set de pares (usuario_email::nombre) que vienen en el Excel, mapeado a su id del Excel
    const excelNameMap: Record<string, number> = {};
    for (const row of deduped) {
      const key = `${row.usuario_email}::${String(row.nombre).trim()}`;
      excelNameMap[key] = row.id;
    }

    // Identificar ids conflictivos: están en BD con el mismo (email, nombre) pero distinto id
    const conflictIds: number[] = [];
    const replacedPairs: Array<{ deletedId: number; newId: number; nombre: string; usuario_email: string }> = [];
    for (const poi of (conflicting ?? [])) {
      const key = `${poi.usuario_email}::${String(poi.nombre).trim()}`;
      const excelId = excelNameMap[key];
      // El poi de BD tiene el mismo nombre+email que uno del Excel pero un id diferente → conflicto
      if (excelId !== undefined && poi.id !== excelId) {
        conflictIds.push(poi.id);
        replacedPairs.push({
          deletedId: poi.id,
          newId: excelId,
          nombre: poi.nombre,
          usuario_email: poi.usuario_email,
        });
      }
    }

    console.log(`📍 Conflictos de nombre: ${conflictIds.length} row(s) a eliminar antes del upsert`);

    // DELETE de los rows conflictivos
    if (conflictIds.length > 0) {
      const { error: deleteError } = await (supabase as any)
        .from('puntos_interes')
        .delete()
        .in('id', conflictIds);

      if (deleteError) {
        console.error('❌ Error al eliminar conflictos en puntos_interes:', deleteError);
        return NextResponse.json(
          { error: `Error al eliminar POIs conflictivos: ${deleteError.message}` },
          { status: 500 }
        );
      }
    }

    // UPSERT por id: INSERT ... ON CONFLICT (id) DO UPDATE SET ...
    const { data: upserted, error: upsertError } = await (supabase as any)
      .from('puntos_interes')
      .upsert(deduped, { onConflict: 'id', ignoreDuplicates: false })
      .select('id');

    if (upsertError) {
      console.error('❌ Error al hacer upsert de puntos_interes:', upsertError);
      return NextResponse.json(
        { error: `Error al importar POIs: ${upsertError.message}` },
        { status: 500 }
      );
    }

    const createdIds: number[] = (upserted ?? []).map((r: any) => r.id);
    const count = createdIds.length;

    console.log(`✅ ${count} punto(s) procesados: ${replacedPairs.length} reemplazado(s) (mismo nombre, id distinto)`);

    return NextResponse.json({
      success: true,
      created: createdIds,
      replaced: replacedPairs,
      count,
    });
  } catch (error: any) {
    console.error('❌ Error en POST /api/import/puntos-interes:', error);
    return NextResponse.json(
      { error: error.message || 'Error inesperado' },
      { status: 500 }
    );
  }
}
