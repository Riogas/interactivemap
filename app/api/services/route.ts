import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * GET /api/services
 * Obtener services con filtros opcionales
 * Query params:
 * - escenario: número de escenario
 * - movil: ID del móvil
 * - moviles: IDs de móviles (comma-separated)
 * - estado: estado del service
 * - fecha: fecha del service (formato YYYY-MM-DD)
 * - empresa_fletera_id: ID de empresa fletera (single, legacy)
 * - empresas_fleteras: IDs de empresas fleteras separados por coma (multi, preferido)
 * - conCoordenadas: 'true' para obtener solo services con lat/lng
 *
 * Scoping server-side por empresa:
 * - Si x-track-isroot === 'S': sin filtro de empresa (root ve todo).
 * - Si NO es root y empresas_fleteras llega con IDs: filtrar por esos IDs.
 * - Si NO es root y empresas_fleteras está vacío/ausente: fail-closed → devuelve lista vacía.
 */
export async function GET(request: NextRequest) {
  // 🔒 AUTENTICACIÓN REQUERIDA
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);

    const escenario = searchParams.get('escenario');
    const movil = searchParams.get('movil');
    const moviles = searchParams.get('moviles');
    const estado = searchParams.get('estado');
    const fecha = searchParams.get('fecha');
    const empresaFleteraId = searchParams.get('empresa_fletera_id'); // legacy single
    const empresasFleteras = searchParams.get('empresas_fleteras');   // multi (preferido)
    const conCoordenadas = searchParams.get('conCoordenadas') === 'true';

    // ── Scope server-side por empresa ──────────────────────────────────────────
    // El header x-track-isroot viene del cliente (page.tsx) cuando el usuario
    // tiene acceso total. Si es 'S' → sin restricción. Si no → aplicar empresas.
    const callerIsRoot = request.headers.get('x-track-isroot') === 'S';

    // Parsear empresas_fleteras (multi) primero; si no, usar empresa_fletera_id (single legacy)
    let scopeEmpresaIds: number[] | null = null; // null = sin restricción (root)
    if (!callerIsRoot) {
      if (empresasFleteras !== null) {
        const parsed = empresasFleteras
          .split(',')
          .map((v) => parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n));
        scopeEmpresaIds = parsed;
      } else if (empresaFleteraId !== null) {
        // Compat legacy: single empresa_fletera_id
        const n = parseInt(empresaFleteraId, 10);
        scopeEmpresaIds = Number.isFinite(n) ? [n] : [];
      } else {
        // No root, sin param → fail-closed
        scopeEmpresaIds = [];
      }
    }

    // Fail-closed: no-root sin empresas válidas → devolver vacío
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length === 0) {
      console.log('🔧 GET /api/services - fail-closed: no-root sin empresas_fleteras → []');
      return NextResponse.json({ success: true, count: 0, data: [] });
    }

    console.log('🔧 GET /api/services - Parámetros:', {
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
      .from('services')
      .select('*');

    // ── Filtro de empresa (scope server-side) ──────────────────────────────────
    if (scopeEmpresaIds !== null && scopeEmpresaIds.length > 0) {
      if (scopeEmpresaIds.length === 1) {
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

    // Filtrar por fecha: OR para capturar services por fch_hora_para (timestamp) O fch_para (date)
    // NOTA: fch_para se almacena como YYYYMMDD (sin guiones) en la BD
    if (fecha) {
      const fechaInicio = `${fecha}T00:00:00`;
      const fechaFin = `${fecha}T23:59:59`;
      const fechaSinGuiones = fecha.replace(/-/g, ''); // '2026-02-17' → '20260217'
      query = query.or(`and(fch_hora_para.gte.${fechaInicio},fch_hora_para.lte.${fechaFin}),fch_para.eq.${fechaSinGuiones}`);
    }

    if (conCoordenadas) {
      query = query.not('latitud', 'is', null).not('longitud', 'is', null);
    }

    // Ordenar por prioridad y fecha
    query = query.order('prioridad', { ascending: false }).order('fch_hora_para', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error al obtener services:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Error al obtener services',
          details: error.message
        },
        { status: 500 }
      );
    }

    console.log(`✅ ${data?.length || 0} services obtenidos`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data || [],
    });
  } catch (error: any) {
    console.error('❌ Error inesperado:', error);
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
