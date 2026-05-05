/**
 * GET /api/audit/list
 *
 * Endpoint para la UI de /admin/auditoria. Devuelve eventos con paginación
 * y filtros opcionales (user, event_type, endpoint, rango de fechas).
 * Lee con service_role para ver todo (bypass RLS).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0);
  const username = searchParams.get('username');
  const eventType = searchParams.get('event_type');
  const endpoint = searchParams.get('endpoint');
  const since = searchParams.get('since'); // ISO date
  const until = searchParams.get('until');

  try {
    const supabase = getServerSupabaseClient();
    // audit_log no está en types/supabase.ts; cast a any para evitar el generic check.
    let query = (supabase.from('audit_log') as unknown as {
      select: (c: string, o: { count: 'exact' }) => {
        order: (c: string, o: { ascending: boolean }) => {
          range: (f: number, t: number) => {
            ilike: (c: string, v: string) => unknown;
            eq: (c: string, v: string) => unknown;
            gte: (c: string, v: string) => unknown;
            lte: (c: string, v: string) => unknown;
          };
        };
      };
    })
      .select('*', { count: 'exact' })
      .order('ts', { ascending: false })
      .range(offset, offset + limit - 1) as {
        ilike: (c: string, v: string) => typeof query;
        eq: (c: string, v: string) => typeof query;
        gte: (c: string, v: string) => typeof query;
        lte: (c: string, v: string) => typeof query;
        then: Promise<{ data: unknown[]; error: { message: string } | null; count: number | null }>['then'];
      };

    if (username) query = query.ilike('username', `%${username}%`);
    if (eventType) query = query.eq('event_type', eventType);
    if (endpoint) query = query.ilike('endpoint', `%${endpoint}%`);
    if (since) query = query.gte('ts', since);
    if (until) query = query.lte('ts', until);

    const { data, error, count } = (await (query as unknown as Promise<{
      data: unknown[];
      error: { message: string } | null;
      count: number | null;
    }>));

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data,
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
