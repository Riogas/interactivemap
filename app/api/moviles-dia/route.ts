import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { mapMovilDiaRowToMovilData } from '@/lib/moviles/moviles-dia-mapper';
import type { MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';
import { todayMontevideo } from '@/lib/date-utils';

/**
 * GET /api/moviles-dia
 * Devuelve la lista de móviles del read model moviles_dia para un (escenario, fecha).
 *
 * Query params:
 * - escenario: integer (requerido)
 * - fecha: YYYY-MM-DD (requerido)
 * - empresas: CSV de empresa_fletera_id (opcional, requerido para no-root)
 *
 * Scoping server-side por empresa (mismo modelo que /api/pedidos):
 * - Si x-track-isroot === 'S': sin filtro de empresa (root ve todo).
 * - Si NO es root y empresas llega con IDs: filtrar por esos IDs.
 * - Si NO es root y empresas está vacío/ausente: fail-closed -> devuelve { data: [] }.
 *
 * Filtro de ruido para fechas históricas (fecha < hoy):
 * - En fechas pasadas, solo devuelve filas donde activo=true OR inactivo_del_dia=true.
 *   Esto excluye filas "zombie" donde ambos son false — móviles que llegaron a
 *   moviles_dia por un UPDATE del sync AS400 o un GPS sin operativa, pero que
 *   no tuvieron pedidos ni services ese día.
 * - En HOY, devuelve todas las filas sin filtro adicional (la UI maneja activo/inactivoDelDia).
 * - Este filtro es la capa defensiva. El fix real es la migration SQL
 *   2026-06-09-fix-moviles-dia-ruido.sql que restringe los triggers y elimina el ruido
 *   retroactivamente. Una vez aplicada, este filtro pasa a ser un no-op.
 */
export async function GET(request: NextRequest) {
  // AUTENTICACION REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);

    const escenarioParam = searchParams.get('escenario');
    const fecha = searchParams.get('fecha');
    const empresasParam = searchParams.get('empresas');

    // 400 si faltan parámetros requeridos
    if (!escenarioParam || !fecha) {
      return NextResponse.json(
        { success: false, error: 'escenario y fecha son requeridos' },
        { status: 400 }
      );
    }

    const escenario = parseInt(escenarioParam, 10);
    if (!Number.isFinite(escenario)) {
      return NextResponse.json(
        { success: false, error: 'escenario debe ser un entero válido' },
        { status: 400 }
      );
    }

    // Scope server-side por empresa (copiado de /api/pedidos líneas 46-66)
    const callerIsRoot = request.headers.get('x-track-isroot') === 'S';

    let scopeEmpresaIds: number[] | null = null; // null = sin restriccion (root)
    if (!callerIsRoot) {
      if (empresasParam !== null) {
        // Param presente (aunque sea vacio string)
        const parsed = empresasParam
          .split(',')
          .map((v) => parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n));
        scopeEmpresaIds = parsed; // puede ser [] -> fail-closed
      } else {
        // No root, sin param -> fail-closed
        scopeEmpresaIds = [];
      }
    }

    // Fail-closed: no-root sin empresas validas -> devolver vacio (copiado de /api/pedidos líneas 69-72)
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
      console.log('GET /api/moviles-dia - fail-closed: no-root sin empresas -> []');
      return NextResponse.json({ data: [] });
    }

    // Determinar si la fecha pedida es histórica (< hoy Montevideo).
    // HOY: sin filtro extra (activo/inactivoDelDia se maneja client-side como siempre).
    // HISTÓRICO: filtro defensivo de ruido — excluir filas zombie (activo=false Y inactivo_del_dia=false).
    const hoy = todayMontevideo();
    const isHistorical = fecha < hoy;

    console.log('GET /api/moviles-dia - Parametros:', {
      escenario,
      fecha,
      isHistorical,
      empresasParam,
      callerIsRoot,
      scopeEmpresaIds,
    });

    let query = supabase
      .from('moviles_dia')
      .select('*')
      .eq('escenario_id', escenario)
      .eq('fecha', fecha);

    // Filtro de empresa (scope server-side, copiado de /api/pedidos líneas 98-104)
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length > 0) {
      if (scopeEmpresaIds.length === 1) {
        query = query.eq('empresa_fletera_id', scopeEmpresaIds[0]);
      } else {
        query = query.in('empresa_fletera_id', scopeEmpresaIds);
      }
    }

    // Filtro de ruido para fechas históricas:
    // Excluir filas "zombie" donde activo=false Y inactivo_del_dia=false.
    // Estas filas son ruido del trigger trg_moviles_to_dia (sync AS400 masivo)
    // o del trigger trg_gps_to_dia (GPS sin operativa).
    //
    // Filas legítimas en histórico tienen:
    //   - activo=true: el móvil estaba operativo ese día y recompute_counts no lo marcó inactivo
    //   - inactivo_del_dia=true: el móvil trabajó y se marcó inactivo al finalizar
    //
    // La condición OR(activo=true, inactivo_del_dia=true) equivale a excluir solo
    // los zombies (ambos false), que es el criterio correcto.
    if (isHistorical) {
      query = query.or('inactivo_del_dia.eq.true,activo.eq.true');
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error al obtener moviles_dia:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Error al obtener moviles_dia',
          details: error.message,
        },
        { status: 500 }
      );
    }

    const mapped = (data ?? []).map((row) => mapMovilDiaRowToMovilData(row as MovilDiaRow));

    console.log(`GET /api/moviles-dia - ${mapped.length} moviles obtenidos (isHistorical=${isHistorical})`);

    return NextResponse.json({ data: mapped });
  } catch (error: any) {
    console.error('Error inesperado en /api/moviles-dia:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
