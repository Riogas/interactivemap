import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { buildFchParaWindowOr } from '@/lib/date-utils';
import { getScopedZonasForEmpresas } from '@/lib/scoped-zonas-server';

/**
 * GET /api/pedidos
 * Obtener pedidos con filtros opcionales
 * Query params:
 * - escenario: numero de escenario
 * - movil: ID del movil
 * - estado: estado del pedido
 * - fecha: fecha del pedido (formato YYYY-MM-DD)
 * - empresa_fletera_id: ID de empresa fletera (single, legacy)
 * - empresas_fleteras: IDs de empresas fleteras separados por coma (multi, preferido)
 * - conCoordenadas: 'true' para obtener solo pedidos con lat/lng
 *
 * Scoping server-side por empresa:
 * - Si x-track-isroot === 'S': sin filtro de empresa (root ve todo).
 * - Si NO es root y empresas_fleteras llega con IDs: filtrar por esos IDs.
 * - Si NO es root y empresas_fleteras esta vacio/ausente: fail-closed -> devuelve lista vacia.
 *
 * Exclusion global:
 * - estado_nro=2 && sub_estado_nro=17 (REG. HISTORICO) se excluye siempre.
 *   Estos registros no deben aparecer en ningun conteo, mapa ni lista.
 *
 * Arrastre de pendientes del dia anterior (feature 2026-05-29):
 * - Cuando fecha === hoy (America/Montevideo), el filtro de fch_para incluye
 *   tambien ayer (D-1). Esto amplia el dataset para la vista de hoy.
 * - El cliente (pedidosCompletos/servicesCompletos) se encarga de separar la vista
 *   pendientes/finalizados: solo deja pasar el arrastre cuando estado_nro === 1.
 *   Los finalizados de ayer nunca se muestran en la vista de hoy (asimetria intencional).
 */
export async function GET(request: NextRequest) {
  // AUTENTICACION REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);

    const escenario = searchParams.get('escenario');
    const movil = searchParams.get('movil');
    const moviles = searchParams.get('moviles'); // Comma-separated list for IN clause
    const estado = searchParams.get('estado');
    const fecha = searchParams.get('fecha');
    const empresaFleteraId = searchParams.get('empresa_fletera_id'); // legacy single
    const empresasFleteras = searchParams.get('empresas_fleteras');   // multi (preferido)
    const conCoordenadas = searchParams.get('conCoordenadas') === 'true';

    // Scope server-side por empresa
    // El header x-track-isroot viene del cliente (page.tsx) cuando el usuario
    // tiene acceso total. Si es 'S' -> sin restriccion. Si no -> aplicar empresas.
    const callerIsRoot = request.headers.get('x-track-isroot') === 'S';

    // Parsear empresas_fleteras (multi) primero; si no, usar empresa_fletera_id (single legacy)
    let scopeEmpresaIds: number[] | null = null; // null = sin restriccion (root)
    if (!callerIsRoot) {
      if (empresasFleteras !== null) {
        // Param presente (aunque sea vacio string)
        const parsed = empresasFleteras
          .split(',')
          .map((v) => parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n));
        scopeEmpresaIds = parsed; // puede ser [] -> fail-closed
      } else if (empresaFleteraId !== null) {
        // Compat legacy: single empresa_fletera_id
        const n = parseInt(empresaFleteraId, 10);
        scopeEmpresaIds = Number.isFinite(n) ? [n] : [];
      } else {
        // No root, sin param -> fail-closed
        scopeEmpresaIds = [];
      }
    }

    // Fail-closed: no-root sin empresas validas -> devolver vacio
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
      console.log('GET /api/pedidos - fail-closed: no-root sin empresas_fleteras -> []');
      return NextResponse.json({ success: true, count: 0, data: [] });
    }

    console.log('GET /api/pedidos - Parametros:', {
      escenario,
      movil,
      moviles,
      estado,
      fecha,
      empresasFleteras,
      empresaFleteraId,
      conCoordenadas,
      callerIsRoot,
      scopeEmpresaIds,
    });

    let query = supabase
      .from('pedidos')
      .select('*');

    // Exclusion global: REG. HISTORICO (estado_nro=2 && sub_estado_nro=17).
    // Se aplica antes que cualquier otro filtro para garantizar consistencia.
    // Logica: NOT (estado_nro=2 AND sub_estado_nro=17)
    //         = estado_nro != 2 OR sub_estado_nro != 17
    query = query.or('estado_nro.neq.2,sub_estado_nro.neq.17');

    // Filtro de empresa (scope server-side)
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length > 0) {
      // Los pedidos SIN ASIGNAR tienen empresa_fletera_id=0 → NO matchean el filtro
      // de empresa. Para que el usuario no-root los cuente (chip navbar, /stats, capa
      // por zona), se incluyen los SA (movil null/0) que caen en las ZONAS que
      // trabajan sus empresas (fleteras_zonas). Mismo criterio que el snapshot de
      // capacidad. Si no hay zonas en scope, se mantiene el filtro de empresa puro.
      const escNum = escenario ? parseInt(escenario) : NaN;
      const scopedZonas = await getScopedZonasForEmpresas(escNum, scopeEmpresaIds);
      if (scopedZonas.length > 0) {
        const empList = scopeEmpresaIds.join(',');
        query = query.or(
          `empresa_fletera_id.in.(${empList}),` +
          `and(or(movil.is.null,movil.eq.0),zona_nro.in.(${scopedZonas.join(',')}))`
        );
      } else if (scopeEmpresaIds.length === 1) {
        query = query.eq('empresa_fletera_id', scopeEmpresaIds[0]);
      } else {
        query = query.in('empresa_fletera_id', scopeEmpresaIds);
      }
    }

    // Aplicar resto de filtros
    if (escenario) {
      query = query.eq('escenario', parseInt(escenario));
    }

    if (moviles) {
      // Soporte para multiples moviles: moviles=472,473,474
      const movilesArray = moviles.split(',').map(m => parseInt(m)).filter(m => !isNaN(m));
      if (movilesArray.length > 0) {
        query = query.in('movil', movilesArray);
      }
    } else if (movil) {
      query = query.eq('movil', parseInt(movil));
    }

    if (estado) {
      query = query.eq('estado_nro', parseInt(estado));
    }

    // Filtrar por VENTANA DE FECHA canónica (lib/date-utils.buildFchParaWindowOr).
    // fch_para se almacena como YYYY-MM-DD (con guiones) en la BD.
    //   - fecha === hoy: (fch_para entre ayer y hoy ∧ estado=1) ∨ (fch_para=hoy ∧ estado=2)
    //   - fecha pasada:  fch_para = fecha (cualquier estado)
    // Esto ARREGLA el arrastre de pendientes de ayer, que antes quedaba inactivo
    // por comparar contra el formato compacto YYYYMMDD (que nunca matcheaba).
    if (fecha) {
      query = query.or(buildFchParaWindowOr(fecha));
    }

    // Filtrar solo pedidos con coordenadas
    if (conCoordenadas) {
      query = query.not('latitud', 'is', null).not('longitud', 'is', null);
    }

    // Ordenar por prioridad y fecha
    query = query.order('prioridad', { ascending: false }).order('fch_hora_para', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('Error al obtener pedidos:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Error al obtener pedidos',
          details: error.message
        },
        { status: 500 }
      );
    }

    console.log(`${data?.length || 0} pedidos obtenidos`);

    // Recompute moviles_dia (fire-and-forget, gateado por feature flag)
    if (process.env.NEXT_PUBLIC_USE_MOVILES_DIA === 'true' && escenario && fecha && data && data.length > 0) {
      const movilesRef = [...new Set(data.map((p: any) => Number(p.movil)).filter((n: number) => n > 0))];
      if (movilesRef.length > 0) {
        (supabase as any).rpc('fn_moviles_dia_recompute_counts_bulk', {
          p_escenario: Number(escenario),
          p_fecha: fecha,
          p_moviles: movilesRef,
        }).then(({ error: rpcError }: { error: any }) => {
          if (rpcError) console.error('recompute moviles_dia (pedidos):', rpcError.message);
        });
      }
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (error: any) {
    console.error('Error inesperado:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        details: error.message
      },
      { status: 500 }
    );
  }
}
