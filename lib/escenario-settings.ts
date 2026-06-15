import 'server-only';
import { getServerSupabaseClient } from '@/lib/supabase';

export type EscenarioSettings = {
  escenarioId: number;
  pedidosSaMinutosAntes: number | null;
  /** Si el escenario cubre servicio nocturno. Default true (conservativo). */
  aplicaServNocturno: boolean;
  /** Hora de inicio del periodo nocturno (HH:MM:SS). NULL = usar default (20:30). */
  horaIniNocturno: string | null;
  /** Hora de fin del periodo nocturno / inicio diurno (HH:MM:SS). NULL = usar default (06:00). */
  horaFinNocturno: string | null;
  /**
   * Peso de las zonas de transito en el prorrateo del lote del movil.
   * 1 = igual que prioridad, 0 = no aporta nada, 0.3 default = aporta ~30%.
   * Configurable solo por root.
   */
  pesoTransitoAlpha: number;
};

type EscenarioSettingsRow = {
  escenario_id: number;
  pedidos_sa_minutos_antes: number | null;
  aplica_serv_nocturno: boolean | null;
  hora_ini_nocturno: string | null;
  hora_fin_nocturno: string | null;
  peso_transito_alpha: number | null;
};

const DEFAULT_PESO_TRANSITO_ALPHA = 0.3;

/**
 * Lee la configuracion de un escenario desde escenario_settings.
 * Si no existe row, retorna defaults seguros (sin filtro temporal, nocturno habilitado, alpha=0.3).
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
    .select('escenario_id, pedidos_sa_minutos_antes, aplica_serv_nocturno, hora_ini_nocturno, hora_fin_nocturno, peso_transito_alpha')
    .eq('escenario_id', escenarioId)
    .maybeSingle();

  if (error) {
    console.warn('[escenario-settings] read error:', error.message);
    return {
      escenarioId,
      pedidosSaMinutosAntes: null,
      aplicaServNocturno: true,
      horaIniNocturno: null,
      horaFinNocturno: null,
      pesoTransitoAlpha: DEFAULT_PESO_TRANSITO_ALPHA,
    };
  }

  if (!data) {
    return {
      escenarioId,
      pedidosSaMinutosAntes: null,
      aplicaServNocturno: true,
      horaIniNocturno: null,
      horaFinNocturno: null,
      pesoTransitoAlpha: DEFAULT_PESO_TRANSITO_ALPHA,
    };
  }

  return {
    escenarioId: data.escenario_id,
    pedidosSaMinutosAntes: data.pedidos_sa_minutos_antes,
    aplicaServNocturno: data.aplica_serv_nocturno ?? true,
    horaIniNocturno: data.hora_ini_nocturno,
    horaFinNocturno: data.hora_fin_nocturno,
    pesoTransitoAlpha: data.peso_transito_alpha ?? DEFAULT_PESO_TRANSITO_ALPHA,
  };
}
