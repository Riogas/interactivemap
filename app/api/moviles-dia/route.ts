import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { mapMovilDiaRowToMovilData } from '@/lib/moviles/moviles-dia-mapper';
import type { MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';

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

    console.log('GET /api/moviles-dia - Parametros:', {
      escenario,
      fecha,
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

    console.log(`GET /api/moviles-dia - ${mapped.length} moviles obtenidos`);

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
