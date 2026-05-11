import 'server-only';
import { getServerSupabaseClient } from '@/lib/supabase';

export type EscenarioSettings = {
  escenarioId: number;
  pedidosSaMinutosAntes: number | null;
};

type EscenarioSettingsRow = {
  escenario_id: number;
  pedidos_sa_minutos_antes: number | null;
};

/**
 * Lee la configuracion de un escenario desde escenario_settings.
 * Si no existe row, retorna { pedidosSaMinutosAntes: null } (sin filtro — backwards compat).
 */
export async function getEscenarioSettings(escenarioId: number): Promise<EscenarioSettings> {
  const supabase = getServerSupabaseClient();

  const { data, error } = await (
    supabase.from('escenario_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          maybeSingle: () => Promise<{ data: EscenarioSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select('escenario_id, pedidos_sa_minutos_antes')
    .eq('escenario_id', escenarioId)
    .maybeSingle();

  if (error) {
    console.warn('[escenario-settings] read error:', error.message);
    return { escenarioId, pedidosSaMinutosAntes: null };
  }

  if (!data) {
    return { escenarioId, pedidosSaMinutosAntes: null };
  }

  return {
    escenarioId: data.escenario_id,
    pedidosSaMinutosAntes: data.pedidos_sa_minutos_antes,
  };
}
