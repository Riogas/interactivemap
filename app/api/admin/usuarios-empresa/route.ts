import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import {
  describirErrorUpstream,
  requireAuthorizationHeader,
  requireFuncionalidad,
} from '@/lib/api-auth-gates';

/**
 * API proxy: GET /api/admin/usuarios-empresa
 *
 * Gate: funcionalidad 'Gestion de Usuarios' (via x-track-funcs).
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

export async function GET(request: NextRequest) {
  // Sesión primero. Sin token, esta pantalla (/admin/usuarios-empresa) quedaba
  // vacía sin explicación: el header vacío se forwardeaba al SecuritySuite y su
  // 401 opaco llegaba como "Error del servicio upstream". Cortamos acá con un
  // mensaje que dice que fue por sesión.
  const auth = requireAuthorizationHeader(request);
  if (typeof auth !== 'string') return auth;

  const gate = requireFuncionalidad(request, 'Gestion de Usuarios');
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

  // El upstream del SecuritySuite SOLO acepta nombres (strings) como
  // `?empresas=FLETERA_1,FLETERA_2`. Si el cliente nos mandó IDs numéricos
  // (caso típico: root con allowedEmpresas pobladas en localStorage),
  // traducimos IDs → nombres en Supabase antes de llamar al upstream.
  const paramLooksNumeric = /^[\d,\s]+$/.test(empresasParam);
  if (paramLooksNumeric) {
    try {
      const supabase = getServerSupabaseClient();
      const ids = empresasParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      const { data: rows, error } = await supabase
        .from('empresas_fleteras')
        .select('empresa_fletera_id, nombre')
        .in('empresa_fletera_id', ids);
      if (error) {
        console.error('[usuarios-empresa] error traduciendo IDs a nombres:', error);
      } else {
        type EmpresaRow = { nombre: string | null };
        const nombres = ((rows ?? []) as EmpresaRow[])
          .map((e) => String(e?.nombre ?? '').trim())
          .filter(Boolean);
        if (nombres.length > 0) {
          console.log(
            `[usuarios-empresa] traduciendo ${ids.length} ID(s) → ${nombres.length} nombre(s): ${nombres.join(',')}`,
          );
          empresasParam = nombres.join(',');
        } else {
          console.warn(
            `[usuarios-empresa] IDs ${ids.join(',')} no produjeron ningún nombre en Supabase — el upstream va a rechazar`,
          );
        }
      }
    } catch (e) {
      console.warn('[usuarios-empresa] excepción al traducir IDs a nombres:', e);
    }
  }

  // Forward del token del usuario al upstream (proxy con auth del usuario).
  // Ya validado arriba por requireAuthorizationHeader: acá nunca es vacío.
  const authHeader = auth;

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
    const attempt = await callUpstream(empresasParam);

    if (!attempt.ok) {
      console.error(
        `[usuarios-empresa] Upstream error final ${attempt.status}:`,
        JSON.stringify(attempt.body),
      );
      // Traducir 401/403/503 del SecuritySuite a algo accionable — ver
      // describirErrorUpstream. La pantalla muestra `json.error` tal cual.
      const desc = describirErrorUpstream(attempt.status);
      return NextResponse.json(
        {
          success: false,
          error: desc.error,
          code: desc.code,
          upstream_status: attempt.status,
          upstream_url: attempt.url,
          ...(desc.ocultarDetalle ? {} : { detail: attempt.body }),
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
