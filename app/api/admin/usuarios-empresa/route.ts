import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * API proxy: GET /api/admin/usuarios-empresa
 *
 * Gate: usuario con rol "Distribuidor" (x-track-roles incluye 'Distribuidor') O isRoot (x-track-isroot === 'S').
 *
 * Proxía al endpoint upstream del SecuritySuite:
 *   GET ${SECURITY_SUITE_URL}/api/db/usuarios/por-empresa-fletera?empresas=<lista>
 *
 * El cliente pasa el parámetro ?empresas=NOMBRE_1,NOMBRE_2 o ?empresas=ID_1,ID_2
 * (los nombres vienen de la preferencia EmpFletera; los IDs son el fallback).
 * El token del usuario se forwarda en el header Authorization.
 *
 * Decisión de formato: primer intento = nombres (strings), fallback = IDs numéricos.
 * Documentado en lib/empresas-del-usuario.ts.
 */

const SECURITY_SUITE_URL = process.env.SECURITY_SUITE_URL || 'http://localhost:3001';

function requireDistribuidorOrRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot === 'S') return true;

  // El cliente serializa los roles en x-track-roles como JSON array de RolNombre
  const rolesHeader = request.headers.get('x-track-roles');
  if (rolesHeader) {
    try {
      const roles: string[] = JSON.parse(rolesHeader);
      const isDistribuidor = roles.some(
        (r) => String(r).trim() === 'Distribuidor',
      );
      if (isDistribuidor) return true;
    } catch {
      // header malformado — denegamos acceso
    }
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Acceso denegado',
      code: 'REQUIRES_DISTRIBUIDOR_OR_ROOT',
    },
    { status: 403 },
  );
}

export async function GET(request: NextRequest) {
  const gate = requireDistribuidorOrRoot(request);
  if (gate !== true) return gate;

  const url = new URL(request.url);
  let empresasParam = url.searchParams.get('empresas') ?? '';
  const isRootCaller = request.headers.get('x-track-isroot') === 'S';

  // Caso root sin parámetro: auto-resolver a TODAS las empresas fleteras activas.
  // Root no tiene allowedEmpresas ni preferencias EmpFletera (acceso total),
  // así que el cliente manda `empresas=` vacío y acá completamos.
  if (!empresasParam && isRootCaller) {
    try {
      const supabase = getServerSupabaseClient();
      const { data: empresas, error } = await supabase
        .from('empresas_fleteras')
        .select('nombre, empresa_fletera_id')
        .eq('estado', 1)
        .order('nombre');

      if (error) {
        console.error('[usuarios-empresa] error cargando empresas activas para root:', error);
        return NextResponse.json(
          { success: false, error: 'Error cargando empresas activas para root' },
          { status: 500 },
        );
      }

      // Primer intento: nombres (consistente con el helper del cliente).
      // Fallback: IDs si los nombres están vacíos.
      type EmpresaRow = { nombre: string | null; empresa_fletera_id: number | null };
      const rows: EmpresaRow[] = (empresas as EmpresaRow[]) ?? [];
      const nombres = rows
        .map((e) => String(e?.nombre ?? '').trim())
        .filter(Boolean);
      if (nombres.length > 0) {
        empresasParam = nombres.join(',');
      } else {
        const ids = rows
          .map((e) => e?.empresa_fletera_id)
          .filter((n): n is number => typeof n === 'number');
        empresasParam = ids.map(String).join(',');
      }

      if (!empresasParam) {
        return NextResponse.json(
          { success: true, data: [] }, // No hay empresas activas — lista vacía es válida
          { status: 200 },
        );
      }

      console.log(
        `[usuarios-empresa] root sin param → auto-resolvió a ${rows.length} empresas activas: ${empresasParam}`,
      );
    } catch (err) {
      console.error('[usuarios-empresa] excepción al auto-resolver empresas para root:', err);
      return NextResponse.json(
        { success: false, error: 'Excepción auto-resolviendo empresas para root' },
        { status: 500 },
      );
    }
  }

  if (!empresasParam) {
    return NextResponse.json(
      {
        success: false,
        error: 'Parámetro empresas requerido',
        code: 'EMPRESAS_REQUIRED',
      },
      { status: 400 },
    );
  }

  // Forward del token del usuario al upstream (proxy con auth del usuario)
  const authHeader = request.headers.get('Authorization') ?? '';

  // Helper interno para llamar al upstream con un param ya construido.
  async function callUpstream(param: string): Promise<{ ok: boolean; status: number; body: unknown; url: string }> {
    const upstreamUrl = `${SECURITY_SUITE_URL}/api/db/usuarios/por-empresa-fletera?empresas=${encodeURIComponent(param)}`;
    console.log(
      `[usuarios-empresa] GET upstream → ${upstreamUrl} (caller: ${request.headers.get('x-track-user') ?? 'unknown'})`,
    );
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      const body = await upstreamRes.json().catch(() => null);
      return { ok: upstreamRes.ok, status: upstreamRes.status, body, url: upstreamUrl };
    } catch (err) {
      console.error('[usuarios-empresa] Excepción al llamar upstream:', err);
      throw err;
    }
  }

  try {
    // Primer intento con el param tal como vino (típicamente nombres).
    let attempt = await callUpstream(empresasParam);

    // Fallback: si el upstream rechaza con 400 y el caller es root (que ya
    // tiene auto-resolución), o el param parece contener nombres (no-numérico),
    // probamos con los IDs equivalentes desde Supabase.
    const paramLooksNonNumeric = !/^[\d,\s]+$/.test(empresasParam);
    if (!attempt.ok && attempt.status === 400 && paramLooksNonNumeric) {
      try {
        const supabase = getServerSupabaseClient();
        const nombres = empresasParam.split(',').map((s) => s.trim()).filter(Boolean);
        const { data: rows } = await supabase
          .from('empresas_fleteras')
          .select('empresa_fletera_id, nombre')
          .in('nombre', nombres);
        type EmpresaRow = { empresa_fletera_id: number | null };
        const ids = ((rows ?? []) as EmpresaRow[])
          .map((e) => e?.empresa_fletera_id)
          .filter((n): n is number => typeof n === 'number');
        if (ids.length > 0) {
          console.log(
            `[usuarios-empresa] upstream 400 con nombres "${empresasParam}", reintentando con IDs: ${ids.join(',')}`,
          );
          attempt = await callUpstream(ids.map(String).join(','));
        }
      } catch (e) {
        console.warn('[usuarios-empresa] no se pudo armar el fallback de IDs:', e);
      }
    }

    if (!attempt.ok) {
      console.error(
        `[usuarios-empresa] Upstream error final ${attempt.status}:`,
        JSON.stringify(attempt.body),
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Error del servicio upstream',
          upstream_status: attempt.status,
          upstream_url: attempt.url,
          detail: attempt.body,
        },
        { status: attempt.status },
      );
    }

    return NextResponse.json(attempt.body, { status: 200 });
  } catch (err) {
    console.error('[usuarios-empresa] Error de red al llamar upstream:', err);
    return NextResponse.json(
      { success: false, error: 'Error de red al contactar el servicio de usuarios' },
      { status: 502 },
    );
  }
}
