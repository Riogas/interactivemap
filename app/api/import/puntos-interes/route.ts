import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/import/puntos-interes
 * Upsert masivo de puntos de interés desde Excel.
 *
 * Lógica de matcheo por identidad de negocio (usuario_email, nombre):
 *   - Par NO existe en BD → INSERT (usa el id del Excel si no choca, sino BD asigna uno).
 *   - Par existe y tipo existente != 'privado' → UPDATE usando el id de BD (no el del Excel).
 *   - Par existe y tipo existente == 'privado' → SKIP, reportar al usuario.
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
 *   created: number[];        // ids de BD creados
 *   updated: number[];        // ids de BD actualizados (id de BD, no del Excel)
 *   skipped: Array<{ nombre: string; usuario_email: string; motivo: 'privado' }>;
 *   count: number;            // created.length + updated.length
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

    // Deduplicar por (usuario_email, nombre) — última fila gana.
    // Evita conflictos internos si el Excel trae duplicados del mismo par.
    const deduped: any[] = Object.values(
      rows.reduce((acc: Record<string, any>, row: any) => {
        const key = `${row.usuario_email}::${String(row.nombre).trim()}`;
        acc[key] = row;
        return acc;
      }, {})
    );

    console.log(`📍 Después de deduplicar por (usuario_email, nombre): ${deduped.length} registro(s) únicos`);

    const supabase = getServerSupabaseClient();

    // Obtener todos los emails únicos del batch para hacer un SELECT eficiente.
    // En la práctica, un usuario sube su propio archivo (1 email), pero soportamos múltiples.
    const uniqueEmails: string[] = [...new Set<string>(deduped.map((r: any) => r.usuario_email))];

    // SELECT de todos los POIs existentes para los emails del batch.
    // Filtramos en memoria para matchear por nombre exacto.
    const { data: existing, error: selectError } = await (supabase as any)
      .from('puntos_interes')
      .select('id, nombre, tipo, usuario_email')
      .in('usuario_email', uniqueEmails);

    if (selectError) {
      console.error('❌ Error al consultar puntos_interes existentes:', selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    // Construir mapa de existentes: `${email}::${nombre}` → { id, tipo }
    const existingMap: Record<string, { id: number; tipo: string }> = {};
    for (const poi of (existing ?? [])) {
      const key = `${poi.usuario_email}::${String(poi.nombre).trim()}`;
      existingMap[key] = { id: poi.id, tipo: poi.tipo };
    }

    // Particionar las filas del Excel en 3 grupos
    const toInsert: any[] = [];
    const toUpdate: any[] = []; // { existingId, data }
    const toSkip: Array<{ nombre: string; usuario_email: string; motivo: 'privado' }> = [];

    for (const row of deduped) {
      const key = `${row.usuario_email}::${String(row.nombre).trim()}`;
      const match = existingMap[key];

      if (!match) {
        // Par nuevo → INSERT
        toInsert.push(row);
      } else if (match.tipo === 'privado') {
        // Existente privado → SKIP (proteger el POI privado)
        toSkip.push({
          nombre: row.nombre,
          usuario_email: row.usuario_email,
          motivo: 'privado',
        });
      } else {
        // Existente no-privado (publico / osm) → UPDATE usando id de BD
        toUpdate.push({ existingId: match.id, data: row });
      }
    }

    console.log(`📍 Partición: ${toInsert.length} insert, ${toUpdate.length} update, ${toSkip.length} skip`);

    const createdIds: number[] = [];
    const updatedIds: number[] = [];

    // INSERT batch
    if (toInsert.length > 0) {
      // Remover el id del Excel para dejar que BD asigne (evita choques con ids existentes
      // que tengan distinto (usuario_email, nombre)).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const insertRows = toInsert.map(({ id: _excelId, ...rest }: any) => rest);

      const { data: inserted, error: insertError } = await (supabase as any)
        .from('puntos_interes')
        .insert(insertRows)
        .select('id');

      if (insertError) {
        console.error('❌ Error al insertar puntos_interes:', insertError);
        return NextResponse.json(
          { error: `Error al crear POIs: ${insertError.message}` },
          { status: 500 }
        );
      }
      for (const r of (inserted ?? [])) {
        createdIds.push(r.id);
      }
    }

    // UPDATE batch — un upsert por id de BD (garantiza que usamos el id correcto de BD)
    if (toUpdate.length > 0) {
      // Preparar rows para upsert por id (id de BD, no del Excel)
      const updateRows = toUpdate.map(({ existingId, data }: { existingId: number; data: any }) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _excelId, ...rest } = data;
        return { id: existingId, ...rest };
      });

      const { data: updated, error: updateError } = await (supabase as any)
        .from('puntos_interes')
        .upsert(updateRows, { onConflict: 'id', ignoreDuplicates: false })
        .select('id');

      if (updateError) {
        console.error('❌ Error al actualizar puntos_interes:', updateError);
        return NextResponse.json(
          { error: `Error al actualizar POIs: ${updateError.message}` },
          { status: 500 }
        );
      }
      for (const r of (updated ?? [])) {
        updatedIds.push(r.id);
      }
    }

    const count = createdIds.length + updatedIds.length;
    console.log(`✅ ${count} punto(s) procesados: ${createdIds.length} creados, ${updatedIds.length} actualizados, ${toSkip.length} omitidos`);

    return NextResponse.json({
      success: true,
      created: createdIds,
      updated: updatedIds,
      skipped: toSkip,
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
