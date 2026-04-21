import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth-middleware';

// ─── Transformar body AS400 → filas de demoras ──────────────────────
// Body AS400:
//   { EscenarioId, TipoDeZona, TipoDeServicio, CodZonas: [{ Zona, ZonaActiva, Demora }] }
// Tabla demoras:
//   demora_id (PK auto), escenario_id, zona_id, zona_tipo, descripcion, minutos, activa
// ─────────────────────────────────────────────────────────────────────
function isAS400Format(body: any): boolean {
  return body.CodZonas && Array.isArray(body.CodZonas);
}

function transformAS400(body: any) {
  const escenario_id = body.EscenarioId ?? 1000;
  const zona_tipo = body.TipoDeZona ?? null;
  const descripcion = body.TipoDeServicio ?? null;
  const codZonas = body.CodZonas || [];

  return codZonas.map((z: any) => ({
    escenario_id,
    zona_tipo,
    descripcion,
    zona_id: parseInt(z.Zona, 10),
    activa: z.ZonaActiva === 'S',
    minutos: z.Demora ?? 0,
    zona_nombre: z.ZonaNombre ?? null,
  }));
}

/**
 * Normaliza el body a un array de filas para la tabla demoras.
 * Acepta:
 *   1) Formato AS400: { EscenarioId, TipoDeZona, TipoDeServicio, CodZonas: [...] }
 *   2) Formato directo: { demoras: [...] }  ó  [ {...}, ... ]  ó  { ... }
 */
function parseDemorasBody(body: any): any[] {
  // 1) Formato AS400
  if (isAS400Format(body)) {
    return transformAS400(body);
  }

  // 2) Formato directo con key "demoras"
  if (body.demoras) {
    const d = body.demoras;
    return Array.isArray(d) ? d : [d];
  }

  // 3) Array directo o un solo objeto
  const raw = Array.isArray(body) ? body : [body];

  // Normalizar campo "activa": si viene como "S"/"N" string, convertir a boolean
  return raw.map((row: any) => {
    if (typeof row.activa === 'string') {
      row.activa = row.activa.toUpperCase() === 'S';
    }
    return row;
  });
}

// =====================================================================
// PUT /api/import/demoras — Delete-then-Insert (reemplaza toda la tabla)
// Borra todos los registros existentes y luego inserta los nuevos.
// Esto garantiza que no queden registros obsoletos de corridas anteriores.
// =====================================================================
export async function PUT(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const demorasArray = parseDemorasBody(body);

    if (demorasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una demora para actualizar' },
        { status: 400 }
      );
    }

    console.log(`🔄 Delete-then-Insert: ${demorasArray.length} demora(s)...`);

    const supabase = getServerSupabaseClient();

    // 1) Borrar todos los registros existentes de la tabla demoras
    const { error: deleteError } = await (supabase as any)
      .from('demoras')
      .delete()
      .neq('demora_id', 0); // condición que matchea todos los registros

    if (deleteError) {
      console.error('❌ Error al limpiar tabla demoras:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    console.log('🗑️ Tabla demoras limpiada');

    // 2) Insertar los nuevos registros
    const { data, error } = await (supabase as any)
      .from('demoras')
      .insert(demorasArray)
      .select();

    if (error) {
      console.error('❌ Error al insertar demoras:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ ${data?.length || 0} demora(s) insertadas (tabla renovada)`);
    return NextResponse.json({ success: true, count: data?.length || 0, data });
  } catch (error: any) {
    console.error('❌ Error en PUT /api/import/demoras:', error);
    return NextResponse.json(
      { error: error.message || 'Error al actualizar demoras' },
      { status: 500 }
    );
  }
}

// =====================================================================
// POST /api/import/demoras — Insert (sin upsert, falla si ya existe)
// =====================================================================
export async function POST(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const demorasArray = parseDemorasBody(body);

    if (demorasArray.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos una demora' },
        { status: 400 }
      );
    }

    console.log(`📦 Importando ${demorasArray.length} demora(s)...`);

    const supabase = getServerSupabaseClient();
    const { data, error } = await (supabase as any)
      .from('demoras')
      .insert(demorasArray)
      .select();

    if (error) {
      console.error('❌ Error al importar demoras:', error);
      return NextResponse.json(
        { error: 'Error al importar demoras', details: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} demoras importadas`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0} demoras importadas correctamente`,
      data,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

// =====================================================================
// DELETE /api/import/demoras
//   Body: { demora_ids: [1,2,3] }
//      ó  { escenario_id, zona_tipo, descripcion }  → borra todo el bloque
// =====================================================================
export async function DELETE(request: NextRequest) {
  const keyValidation = requireApiKey(request);
  if (keyValidation instanceof NextResponse) return keyValidation;

  try {
    const body = await request.json();
    const supabase = getServerSupabaseClient();

    // Opción 1: borrar por IDs
    if (body.demora_ids && Array.isArray(body.demora_ids)) {
      console.log(`🗑️ Eliminando ${body.demora_ids.length} demoras por ID...`);

      const { data, error } = await (supabase as any)
        .from('demoras')
        .delete()
        .in('demora_id', body.demora_ids)
        .select();

      if (error) {
        console.error('❌ Error al eliminar demoras:', error);
        return NextResponse.json(
          { error: 'Error al eliminar demoras', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `${data?.length || 0} demoras eliminadas`,
        deleted_count: data?.length || 0,
      });
    }

    // Opción 2: borrar bloque por escenario + zona_tipo + descripcion
    if (body.escenario_id || body.zona_tipo || body.descripcion) {
      let query = (supabase as any).from('demoras').delete();

      if (body.escenario_id) query = query.eq('escenario_id', body.escenario_id);
      if (body.zona_tipo) query = query.eq('zona_tipo', body.zona_tipo);
      if (body.descripcion) query = query.eq('descripcion', body.descripcion);

      console.log(`🗑️ Eliminando demoras por filtro (escenario=${body.escenario_id}, tipo=${body.zona_tipo}, desc=${body.descripcion})...`);

      const { data, error } = await query.select();

      if (error) {
        console.error('❌ Error al eliminar demoras:', error);
        return NextResponse.json(
          { error: 'Error al eliminar demoras', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `${data?.length || 0} demoras eliminadas`,
        deleted_count: data?.length || 0,
      });
    }

    return NextResponse.json(
      { error: 'Se requiere demora_ids[] o filtros (escenario_id, zona_tipo, descripcion)' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
