import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/escenario-settings?escenarioId=<n>
 *
 * Lectura publica de los settings de un escenario.
 * No requiere autenticacion (los settings son datos operacionales, no sensibles).
 * Usado por el hook useEscenarioSettings en el cliente.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const escenarioIdStr = searchParams.get('escenarioId');

  if (!escenarioIdStr) {
    return NextResponse.json({ success: false, error: 'escenarioId requerido' }, { status: 400 });
  }

  const escenarioId = parseInt(escenarioIdStr, 10);
  if (isNaN(escenarioId)) {
    return NextResponse.json({ success: false, error: 'escenarioId debe ser un entero' }, { status: 400 });
  }

  const supabase = getServerSupabaseClient();

  type Row = {
    escenario_id: number;
    pedidos_sa_minutos_antes: number | null;
    aplica_serv_nocturno: boolean | null;
    hora_ini_nocturno: string | null;
    hora_fin_nocturno: string | null;
  };
  const { data, error } = await (
    supabase.from('escenario_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          maybeSingle: () => Promise<{ data: Row | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select('escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno')
    .eq('escenario_id', escenarioId)
    .maybeSingle();

  if (error) {
    console.error('[escenario-settings] GET error:', error.message);
    return NextResponse.json({ success: false, error: 'Error al leer settings' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: data
      ? {
          escenarioId: data.escenario_id,
          pedidosSaMinutosAntes: data.pedidos_sa_minutos_antes,
          aplicaServNocturno: data.aplica_serv_nocturno ?? true,
          horaIniNocturno: data.hora_ini_nocturno,
          horaFinNocturno: data.hora_fin_nocturno,
        }
      : {
          escenarioId,
          pedidosSaMinutosAntes: null,
          aplicaServNocturno: true,
          horaIniNocturno: null,
          horaFinNocturno: null,
        },
  });
}
