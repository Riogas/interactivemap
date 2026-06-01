import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

export async function GET(request: NextRequest) {
  const gate = requireFuncionalidad(request, 'Query Inicios de sesion');
  if (gate !== true) return gate;
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const ip = searchParams.get('ip');
    const estado = searchParams.get('estado');
    const dateFrom = searchParams.get('date_from'); // YYYY-MM-DD (local Montevideo)
    const dateTo = searchParams.get('date_to');     // YYYY-MM-DD (local Montevideo)
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const client = getServerSupabaseClient();

    // Query base
    let query = client
      .from('login_attempts')
      .select('*', { count: 'exact' })
      .order('ts', { ascending: false })
      .range(offset, offset + limit - 1);

    // Aplicar filtros
    if (username) {
      query = query.ilike('username', `%${username}%`);
    }
    if (ip) {
      query = query.ilike('ip', `%${ip}%`);
    }
    if (estado) {
      query = query.eq('estado', estado);
    }
    // Filtros de fecha. La columna `ts` es timestamptz. Las fechas vienen del
    // cliente como YYYY-MM-DD (timezone Montevideo). Convertimos a rango UTC
    // restando 3hs al inicio (00:00 UYT = 03:00 UTC) y al fin (23:59:59 UYT =
    // 02:59:59 UTC del dia siguiente). Si solo viene una de las dos, se aplica
    // half-open.
    if (dateFrom) {
      // 00:00 hora Montevideo → 03:00 UTC del mismo dia
      query = query.gte('ts', `${dateFrom}T03:00:00Z`);
    }
    if (dateTo) {
      // 23:59:59.999 hora Montevideo del dia X → 02:59:59.999 UTC del dia X+1
      const [y, m, d] = dateTo.split('-').map(Number);
      const dayPlus1 = new Date(Date.UTC(y, m - 1, d + 1));
      const yy = dayPlus1.getUTCFullYear();
      const mm = String(dayPlus1.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dayPlus1.getUTCDate()).padStart(2, '0');
      query = query.lt('ts', `${yy}-${mm}-${dd}T03:00:00Z`);
    }

    const { data: attempts, count, error } = await query;

    if (error) {
      console.error('Error fetching login_attempts:', error);
      return NextResponse.json(
        { success: false, error: 'Error al obtener los intentos' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      attempts: attempts || [],
      total: count || 0,
    });
  } catch (error) {
    console.error('Error en GET /api/admin/login-logs:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
