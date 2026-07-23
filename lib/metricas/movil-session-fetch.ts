/**
 * Fetch directo al endpoint externo /tracking/getSessionData para el run de
 * métricas (OQ3): el run se autentica con METRICAS_CRON_TOKEN (server-to-server),
 * no con sesión de usuario Supabase, por lo que no puede pasar por
 * app/api/movil-session/[id]/route.ts (exige requireAuth). Replica el mismo
 * payload/agent SSL que ese endpoint interno, pero standalone y mockeable.
 *
 * Tolerante a fallos: cualquier !response.ok / excepción / timeout devuelve
 * null (NO fatal) — el caller atribuye chofer=NULL y sigue procesando.
 */

import https from 'https';
import { API_BASE_URL } from '@/lib/api/config';
import { ensureUtcIso } from '@/lib/date-utils';

// Agente HTTPS que ignora errores de certificado SSL (certificados internos).
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export interface HistorialEntry {
  chofer: string;
  inicio: string | null;
}

export async function fetchSessionHistorial(
  movil: number,
  fecha: string,
): Promise<HistorialEntry[] | null> {
  const externalUrl = `${API_BASE_URL}/tracking/getSessionData`;

  try {
    const response = await fetch(externalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        EscenarioId: 1000,
        Movil: movil,
        Fecha: fecha,
      }),
      // @ts-expect-error - Node.js fetch acepta la opción agent
      agent: externalUrl.startsWith('https') ? httpsAgent : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[movil-session-fetch] movil=${movil} fecha=${fecha} status=${response.status}`);
      return null;
    }

    const data = await response.json();
    const historial: Array<{ ChoferHistorico: string; InicioHistorico: string }> = data.Historial || [];

    return historial.map((h) => ({
      chofer: h.ChoferHistorico,
      inicio: ensureUtcIso(h.InicioHistorico),
    }));
  } catch (err) {
    console.warn(`[movil-session-fetch] movil=${movil} fecha=${fecha} excepción:`, (err as Error)?.message);
    return null;
  }
}
