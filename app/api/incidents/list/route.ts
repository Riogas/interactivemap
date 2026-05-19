/**
 * GET /api/incidents/list
 * Devuelve la lista de incidencias con signed URLs para ver el video.
 * Lee con service_role (bypass RLS). Usar desde /admin/incidencias.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';


interface IncidentRow {
  id: number;
  ts: string;
  username: string | null;
  user_id: string | null;
  description: string | null;
  video_path: string;
  duration_s: number | null;
  size_bytes: number | null;
  mime_type: string | null;
  ip: string | null;
  status: string;
  notes: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0);
  const username = searchParams.get('username');
  const status = searchParams.get('status');

  try {
    const supabase = getServerSupabaseClient();
    let query = (
      supabase.from('incidents') as unknown as {
        select: (c: string, o: { count: 'exact' }) => {
          order: (c: string, o: { ascending: boolean }) => {
            range: (f: number, t: number) => unknown;
          };
        };
      }
    )
      .select('*', { count: 'exact' })
      .order('ts', { ascending: false })
      .range(offset, offset + limit - 1) as {
        ilike: (c: string, v: string) => typeof query;
        eq: (c: string, v: string) => typeof query;
        neq: (c: string, v: string) => typeof query;
      };

    if (username) query = query.ilike('username', `%${username}%`);
    if (status === 'not_closed') {
      query = query.neq('status', 'closed');
    } else if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = (await (query as unknown as Promise<{
      data: IncidentRow[];
      error: { message: string } | null;
      count: number | null;
    }>));

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Servimos el video a través de un proxy local (/api/incidents/{id}/video)
    // en vez de exponer un signed URL directo de Supabase Storage. Razones:
    // - Algunos clientes (proxy corporativo / SSL interception) no pueden
    //   conectarse al dominio de Storage (ERR_CERT_AUTHORITY_INVALID).
    // - Mantenemos el bucket privado: el cliente nunca ve el video_path
    //   real ni el token JWT del signed URL.
    // - La autorización se controla acá (requireAuth en el endpoint /video).
    const withUrls = (data ?? []).map((r) => ({
      ...r,
      video_url: `/api/incidents/${r.id}/video`,
    }));

    return NextResponse.json({
      success: true,
      data: withUrls,
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
