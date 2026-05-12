import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { parseZonasJsonb } from '@/lib/auth-scope';
import { recomputeMovilAndCapEntrega } from '@/lib/zonas-cap-entrega';

/**
 * GET /api/moviles-zonas
 * Obtener asignaciones móvil-zona
 *
 * Query params:
 *   - movilId: filtrar por móvil específico
 *   - zonaId: filtrar por zona específica
 *   - escenarioId: filtrar por escenario (default: todos)
 *   - activa: filtrar por estado (default: true)
 *   - empresaIds: CSV de empresa_fletera_id (scoping zona + movil)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const movilId = searchParams.get('movilId');
    const zonaId = searchParams.get('zonaId');
    const escenarioId = searchParams.get('escenarioId');
    const activa = searchParams.get('activa');
    const empresaIdsCsv = searchParams.get('empresaIds');

    const supabase = getServerSupabaseClient();

    // Si se piden empresaIds, resolver scope de zonas permitidas + móviles permitidos.
    let allowedZonaIds: Set<number> | null = null;
    let allowedMovilIds: Set<string> | null = null;
    if (empresaIdsCsv !== null) {
      const empresaIds = empresaIdsCsv
        .split(',')
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n));
      if (empresaIds.length === 0) {
        return NextResponse.json({ success: true, count: 0, data: [] });
      }

      // 1) zonas permitidas vía fleteras_zonas
      let fzQuery = (supabase as any)
        .from('fleteras_zonas')
        .select('zonas')
        .in('empresa_fletera_id', empresaIds);
      if (escenarioId) {
        fzQuery = fzQuery.eq('escenario_id', parseInt(escenarioId));
      }
      const { data: fzData, error: fzError } = await fzQuery;
      if (fzError) {
        console.error('❌ Error al resolver scope de zonas (moviles-zonas):', fzError);
        return NextResponse.json(
          { error: 'Error al resolver scope de zonas', details: fzError.message },
          { status: 500 },
        );
      }
      allowedZonaIds = new Set<number>();
      for (const row of fzData ?? []) {
        for (const z of parseZonasJsonb(row?.zonas)) allowedZonaIds.add(z);
      }

      // 2) móviles permitidos: pertenecen a alguna de esas empresas.
      // moviles_zonas.movil_id (TEXT) referencia moviles.id::text.
      const { data: movData, error: movError } = await (supabase as any)
        .from('moviles')
        .select('id')
        .in('empresa_fletera_id', empresaIds);
      if (movError) {
        console.error('❌ Error al resolver móviles permitidos:', movError);
        return NextResponse.json(
          { error: 'Error al resolver móviles permitidos', details: movError.message },
          { status: 500 },
        );
      }
      allowedMovilIds = new Set<string>();
      for (const row of movData ?? []) {
        if (row?.id != null) allowedMovilIds.add(String(row.id));
      }

      // Si zonas o móviles permitidos están vacíos → fail-closed
      // (sin móviles propios o sin zonas asignadas, no hay nada que mostrar).
      // OR (no AND): un distribuidor con zonas asignadas pero sin móviles propios
      // no debe ver móviles ajenos en esas zonas, y viceversa.
      if (allowedZonaIds.size === 0 || allowedMovilIds.size === 0) {
        return NextResponse.json({ success: true, count: 0, data: [] });
      }
    }

    let query = (supabase as any)
      .from('moviles_zonas')
      .select('*')
      .order('zona_id', { ascending: true });

    if (movilId) {
      query = query.eq('movil_id', movilId);
    }

    if (zonaId) {
      query = query.eq('zona_id', parseInt(zonaId));
    }

    if (escenarioId) {
      query = query.eq('escenario_id', parseInt(escenarioId));
    }

    // Por defecto solo activas, salvo que se pida explícitamente todas
    if (activa !== 'all') {
      query = query.eq('activa', activa !== 'false');
    }

    // AND intencional: solo móviles propios EN zonas propias.
    // Un móvil propio asignado a una zona ajena queda fuera (correcto por spec).
    if (allowedZonaIds && allowedZonaIds.size > 0) {
      query = query.in('zona_id', Array.from(allowedZonaIds));
    }
    if (allowedMovilIds && allowedMovilIds.size > 0) {
      query = query.in('movil_id', Array.from(allowedMovilIds));
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener moviles_zonas:', error);
      return NextResponse.json(
        { error: 'Error al obtener asignaciones', details: error.message },
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

/**
 * POST /api/moviles-zonas
 * Guardar asignaciones desde el modal de Zonas.
 *
 * Body esperado:
 * {
 *   "escenario_id": 1000,           // opcional, default 1000
 *   "asignaciones": {
 *     "<zona_id>": [
 *       { "movilId": 304, "tipo": "prioridad" },
 *       { "movilId": 305, "tipo": "transito" }
 *     ],
 *     ...
 *   }
 * }
 *
 * Comportamiento: REEMPLAZA todas las asignaciones del escenario indicado
 * con las nuevas. Esto mantiene consistencia con el import de Genexus.
 *
 * Recompute: después del upsert, recomputa contadores cant_ped/cant_serv/capacidad
 * y sincroniza zonas_cap_entrega para cada movilNro afectado (todos los movilId
 * únicos del body) — best-effort, no aborta el response si falla.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { escenario_id = 1000, asignaciones } = body;

    if (!asignaciones || typeof asignaciones !== 'object') {
      return NextResponse.json(
        { error: 'Se requiere el campo "asignaciones"' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    // 1) Borrar todas las asignaciones del escenario
    const { error: delError } = await (supabase as any)
      .from('moviles_zonas')
      .delete()
      .eq('escenario_id', escenario_id);

    if (delError) {
      console.error('❌ Error al limpiar asignaciones:', delError);
      return NextResponse.json(
        { error: 'Error al limpiar asignaciones previas', details: delError.message },
        { status: 500 }
      );
    }

    // 2) Construir filas desde el mapa de asignaciones
    const rows: Record<string, any>[] = [];
    for (const [zonaIdStr, items] of Object.entries(asignaciones)) {
      const zona_id = parseInt(zonaIdStr, 10);
      if (isNaN(zona_id) || !Array.isArray(items)) continue;
      for (const item of items) {
        rows.push({
          movil_id: String(item.movilId),
          zona_id,
          escenario_id,
          prioridad_o_transito: item.tipo === 'prioridad' ? 1 : 2,
          activa: true,
          tipo_de_zona: '',
          tipo_de_servicio: '',
        });
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Todas las asignaciones eliminadas',
        count: 0,
      });
    }

    // 3) Insertar por lotes
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { data, error } = await (supabase as any)
        .from('moviles_zonas')
        .insert(batch)
        .select();

      if (error) {
        console.error('❌ Error al insertar asignaciones:', error);
        return NextResponse.json(
          { error: 'Error al guardar asignaciones', details: error.message, inserted_so_far: totalInserted },
          { status: 500 }
        );
      }
      totalInserted += data?.length || 0;
    }

    console.log(`✅ ${totalInserted} asignaciones guardadas (escenario: ${escenario_id})`);

    // 4) Recomputar contadores + sincronizar zonas_cap_entrega para todos los
    //    movilId únicos del body (best-effort — no aborta el response si falla).
    //
    //    RAZÓN: un cambio en asignaciones cambia el shape de zonas_cap_entrega
    //    para cada móvil afectado — filas nuevas deben aparecer, stale deben
    //    desaparecer. recomputeMovilAndCapEntrega garantiza este orden:
    //    primero actualiza `capacidad`, luego sincroniza zonas_cap_entrega.
    //    Usa getServerSupabaseClient() para bypassear RLS en UPDATE moviles.
    const uniqueMovilNros = [...new Set(
      rows
        .map((r) => parseInt(r.movil_id, 10))
        .filter((n) => Number.isFinite(n) && n !== 0),
    )];

    if (uniqueMovilNros.length > 0) {
      console.log(`[zonas-cap-entrega] trigger=POST moviles-zonas — moviles a recomputar: ${uniqueMovilNros.join(', ')}`);
      for (const nro of uniqueMovilNros) {
        try {
          await recomputeMovilAndCapEntrega(supabase as any, nro);
          console.log(
            `[zonas-cap-entrega] trigger=POST moviles-zonas movilNro=${nro} → recompute+sync OK`,
          );
        } catch (err) {
          console.error(`⚠️ [zonas-cap-entrega] trigger=POST moviles-zonas falló recompute para movil ${nro}:`, err);
          // best-effort: no aborta el response principal
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `${totalInserted} asignaciones guardadas correctamente`,
      count: totalInserted,
    });
  } catch (error: any) {
    console.error('❌ Error inesperado en POST /api/moviles-zonas:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
