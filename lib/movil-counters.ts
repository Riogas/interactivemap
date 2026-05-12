import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Recomputa cant_ped, cant_serv y capacidad de un móvil
 * a partir del estado actual de las tablas pedidos y services.
 *
 * CUÁNDO LLAMAR:
 *   - Después de upsert/delete en import/moviles (Trigger 1)
 *   - Después de upsert/delete en import/pedidos (Trigger 2)
 *   - Después de upsert/delete en import/services (Trigger 2)
 *
 * CRITERIO "PENDIENTE": estado_nro = 1
 *   (confirmado en app/dashboard/page.tsx líneas 1624-1627)
 *
 * INVARIANTE MANTENIDA: capacidad = cant_ped + cant_serv
 *
 * DECISIÓN DE DISEÑO: Opción A (TypeScript helper) sobre Opción B (DB triggers).
 *   Si en el futuro se agregan endpoints que olvidan llamar a esta función,
 *   migrar a DB triggers (Opción B) para enforcement automático.
 *
 * USO EN CALL-SITES:
 *   try {
 *     await recomputeMovilCounters(supabase, movilNro);
 *   } catch (err) {
 *     console.error('[movil-counters] falló:', err);
 *     // best-effort: no abortar el response principal
 *   }
 *
 * @param supabase - Cliente Supabase (servidor)
 * @param movilNro - Valor del campo `nro` en tabla moviles
 *                   (mismo valor que campo `movil` en pedidos/services)
 * @throws Error si alguna query falla — el caller decide si es crítico
 */
export async function recomputeMovilCounters(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
): Promise<void> {
  // Guard: movil inválido → early return sin queries
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    return;
  }

  // Count pedidos pendientes (estado_nro = 1)
  const { count: cantPed, error: errorPed } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .eq('movil', nro)
    .eq('estado_nro', 1);

  if (errorPed) {
    console.error(
      `[movil-counters] Error contando pedidos para movil ${nro}:`,
      errorPed,
    );
    throw errorPed;
  }

  // Count services pendientes (estado_nro = 1)
  const { count: cantServ, error: errorServ } = await supabase
    .from('services')
    .select('*', { count: 'exact', head: true })
    .eq('movil', nro)
    .eq('estado_nro', 1);

  if (errorServ) {
    console.error(
      `[movil-counters] Error contando services para movil ${nro}:`,
      errorServ,
    );
    throw errorServ;
  }

  const ped = cantPed ?? 0;
  const serv = cantServ ?? 0;

  // Actualizar los 3 campos en la fila del móvil (match por `nro`)
  const { error: errorUpd } = await supabase
    .from('moviles')
    .update({
      cant_ped: ped,
      cant_serv: serv,
      capacidad: ped + serv,
    } as any)
    .eq('nro', nro);

  if (errorUpd) {
    console.error(
      `[movil-counters] Error actualizando moviles para movil ${nro}:`,
      errorUpd,
    );
    throw errorUpd;
  }
}
