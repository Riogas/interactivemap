import type { SupabaseClient } from '@supabase/supabase-js';
import { todayMontevideo } from '@/lib/date-utils';

/**
 * Resultado del recompute — devuelto por recomputeMovilCounters para que los
 * call-sites puedan loguear los valores resultantes sin una segunda query.
 */
export interface RecomputeResult {
  movilNro: number;
  cant_ped: number;
  cant_serv: number;
  capacidad: number;
}

/**
 * Recomputa cant_ped, cant_serv y capacidad de un móvil
 * a partir del estado actual de las tablas pedidos y services.
 *
 * CUÁNDO LLAMAR:
 *   - Después de upsert/delete en import/moviles (Trigger 1)
 *   - Después de upsert/delete en import/pedidos (Trigger 2)
 *   - Después de upsert/delete en import/services (Trigger 2)
 *   - Después de upsert/delete en moviles_zonas (Trigger 3) — recomputar para
 *     cada movilNro afectado. Los contadores no filtran por zona, pero el
 *     recompute es defensivo: garantiza coherencia ante futuros cambios de
 *     semántica y captura casos donde la reasignación zonal arrastra pedidos.
 *   - Después de upsert/delete en import/movZonaServicio (Trigger 3b) — mismo
 *     razonamiento que moviles_zonas.
 *
 * NOTA sobre zonas (Trigger 3):
 *   app/api/zonas/route.ts solo expone GET (sin mutaciones) — no requiere wiring.
 *   app/api/moviles-zonas/route.ts POST hace bulk delete+insert de asignaciones
 *   y llama a este helper para cada movilId único del body.
 *
 * CRITERIO "PENDIENTE DE HOY":
 *   - estado_nro = 1
 *   - fch_para = fecha de hoy en YYYYMMDD (zona Montevideo)
 *   (consistente con el filtro selectedDateCompact del dashboard)
 *
 * INVARIANTE MANTENIDA: capacidad = cant_ped + cant_serv
 *
 * CAMPO DE DIAGNÓSTICO: counters_updated_at
 *   Se setea a NOW() en cada llamada exitosa. Permite verificar externamente
 *   si el recompute está corriendo:
 *     SELECT nro, cant_ped, cant_serv, capacidad, counters_updated_at
 *     FROM moviles WHERE nro = 24;
 *   Si counters_updated_at no cambia tras ejecutar un endpoint → ese endpoint
 *   no está wired al helper.
 *
 * DECISIÓN DE DISEÑO: Opción A (TypeScript helper) sobre Opción B (DB triggers).
 *   Si en el futuro se agregan endpoints que olvidan llamar a esta función,
 *   migrar a DB triggers (Opción B) para enforcement automático.
 *
 * LIMITACIÓN CONOCIDA (cambio de día):
 *   El contador solo se recalcula cuando hay una mutación. Si pasa la
 *   medianoche en Montevideo sin que ningún pedido/service cambie, los
 *   contadores del día anterior siguen ahí. Aceptable mientras solo se
 *   "graba" (los campos no se consumen). Si más adelante se usan en UI,
 *   considerar un cron a las 00:01 de Montevideo que recalcule todo.
 *
 * CLIENTE SUPABASE:
 *   SIEMPRE pasar el cliente de servidor (getServerSupabaseClient()) en API routes.
 *   El cliente anon puede fallar silenciosamente si RLS bloquea UPDATE en moviles.
 *
 * USO EN CALL-SITES:
 *   try {
 *     const result = await recomputeMovilCounters(supabase, movilNro);
 *     console.log(`[recompute] trigger=... movilNro=${result.movilNro} → cant_ped=${result.cant_ped} cant_serv=${result.cant_serv} capacidad=${result.capacidad}`);
 *   } catch (err) {
 *     console.error('[movil-counters] falló:', err);
 *     // best-effort: no abortar el response principal
 *   }
 *
 * @param supabase - Cliente Supabase de SERVIDOR (getServerSupabaseClient())
 * @param movilNro - Valor del campo `nro` en tabla moviles
 *                   (mismo valor que campo `movil` en pedidos/services)
 * @param now      - Opcional. Permite inyectar la fecha actual (tests).
 *                   Default: new Date(). Se evalúa en zona Montevideo.
 * @returns RecomputeResult con los valores calculados, o void si movilNro inválido
 * @throws Error si alguna query falla — el caller decide si es crítico
 */
export async function recomputeMovilCounters(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
  now: Date = new Date(),
): Promise<RecomputeResult | void> {
  // Guard: movil inválido → early return sin queries
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    console.log(`[movil-counters] skip movilNro=${movilNro} reason=invalid`);
    return;
  }

  // Fecha de hoy en YYYYMMDD, zona Montevideo (matchea el formato de fch_para).
  const todayCompact = todayMontevideo(now).replace(/-/g, '');

  // Count pedidos pendientes de hoy
  const { count: cantPed, error: errorPed } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true })
    .eq('movil', nro)
    .eq('estado_nro', 1)
    .eq('fch_para', todayCompact);

  if (errorPed) {
    console.error(
      `[movil-counters] Error contando pedidos para movil ${nro}:`,
      errorPed,
    );
    throw errorPed;
  }

  // Count services pendientes de hoy
  const { count: cantServ, error: errorServ } = await supabase
    .from('services')
    .select('*', { count: 'exact', head: true })
    .eq('movil', nro)
    .eq('estado_nro', 1)
    .eq('fch_para', todayCompact);

  if (errorServ) {
    console.error(
      `[movil-counters] Error contando services para movil ${nro}:`,
      errorServ,
    );
    throw errorServ;
  }

  const ped = cantPed ?? 0;
  const serv = cantServ ?? 0;

  // Actualizar los 3 campos en la fila del móvil (match por `nro`),
  // incluyendo counters_updated_at para diagnóstico de stale.
  const { error: errorUpd } = await supabase
    .from('moviles')
    .update({
      cant_ped: ped,
      cant_serv: serv,
      capacidad: ped + serv,
      counters_updated_at: now.toISOString(),
    } as any)
    .eq('nro', nro);

  if (errorUpd) {
    console.error(
      `[movil-counters] Error actualizando moviles para movil ${nro}:`,
      errorUpd,
    );
    throw errorUpd;
  }

  return { movilNro: nro, cant_ped: ped, cant_serv: serv, capacidad: ped + serv };
}
