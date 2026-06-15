import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

const DEFAULT_PESO_TRANSITO_ALPHA = 0.3;

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
    peso_transito_alpha?: number | null;
  };
  type QueryBuilder = {
    select: (cols: string) => {
      eq: (col: string, val: number) => {
        maybeSingle: () => Promise<{ data: Row | null; error: { message: string; code?: string } | null }>;
      };
    };
  };

  // Intentar con peso_transito_alpha (columna agregada por la migration del round de
  // prorrateo, 2026-05-15-peso-transito-alpha.sql). Si la migration NO se aplicó en
  // este server (síntoma: error 42703 column does not exist), reintentamos sin esa
  // columna y devolvemos el default. Evita romper el polling de useEscenarioSettings.
  const buildBase = (cols: string) =>
    (supabase.from('escenario_settings') as unknown as QueryBuilder)
      .select(cols)
      .eq('escenario_id', escenarioId)
      .maybeSingle();

  let { data, error } = await buildBase(
    'escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno, peso_transito_alpha',
  );

  if (error && (error.code === '42703' || /column .* does not exist|peso_transito_alpha/i.test(error.message))) {
    console.warn('[escenario-settings] columna peso_transito_alpha ausente, fallback sin ella. Aplicar migration 2026-05-15-peso-transito-alpha.sql.');
    const retry = await buildBase(
      'escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno',
    );
    data = retry.data;
    error = retry.error;
  }

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
          pesoTransitoAlpha: data.peso_transito_alpha ?? DEFAULT_PESO_TRANSITO_ALPHA,
        }
      : {
          escenarioId,
          pedidosSaMinutosAntes: null,
          aplicaServNocturno: true,
          horaIniNocturno: null,
          horaFinNocturno: null,
          pesoTransitoAlpha: DEFAULT_PESO_TRANSITO_ALPHA,
        },
  });
}
