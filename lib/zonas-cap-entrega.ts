import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeMovilCounters } from '@/lib/movil-counters';

/**
 * Shape de una fila en la tabla zonas_cap_entrega.
 * Refleja la PK compuesta: (escenario, zona, tipo_servicio, movil, emp_fletera_id).
 */
export interface ZonasCapEntregaRow {
  escenario: number;
  zona: number;
  tipo_servicio: string;
  movil: number;
  emp_fletera_id: number;
  lote_disponible: number;
}

/**
 * Sincroniza zonas_cap_entrega para el movil dado.
 *
 * ESTRATEGIA (idempotente):
 *   1. Lee el estado actual del móvil desde `moviles` (escenario_id, empresa_fletera_id,
 *      tamano_lote, capacidad). Si tamano_lote es null, no genera filas y borra las previas.
 *   2. Lee la lista de zonas activas asignadas al móvil desde `moviles_zonas`,
 *      incluyendo tipo_de_servicio por fila (puede variar por zona).
 *   3. Para cada asignación con tipo_de_servicio no vacío:
 *      UPSERT en zonas_cap_entrega con lote_disponible = tamano_lote - capacidad.
 *   4. DELETE de filas stale: cualquier fila en zonas_cap_entrega para este movil
 *      que ya no esté en la lista activa (por zona+tipo_servicio).
 *
 * PRECONDICIÓN:
 *   Llamar DESPUÉS de recomputeMovilCounters para que `capacidad` esté actualizada.
 *   Usar recomputeMovilAndCapEntrega() que garantiza este orden.
 *
 * CLIENTE:
 *   SIEMPRE pasar getServerSupabaseClient() — service role para bypass RLS.
 *
 * @param supabase  - Cliente Supabase de SERVIDOR (getServerSupabaseClient())
 * @param movilNro  - Valor del campo `nro` en tabla moviles
 * @returns Array de filas upserted, o void si movilNro inválido
 */
export async function syncMovilZonasCapEntrega(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
): Promise<ZonasCapEntregaRow[] | void> {
  // Guard: movil inválido → early return sin queries
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    return;
  }

  // ── 1. Leer estado actual del móvil ──────────────────────────────────────
  const { data: movilData, error: movilError } = await (supabase as any)
    .from('moviles')
    .select('escenario_id, empresa_fletera_id, tamano_lote, capacidad')
    .eq('nro', nro)
    .maybeSingle();

  if (movilError) {
    console.error(`[zonas-cap-entrega] Error leyendo movil ${nro}:`, movilError);
    throw movilError;
  }

  if (!movilData) {
    // Móvil no existe en la tabla → borrar filas stale si las hubiera
    console.warn(`[zonas-cap-entrega] movilNro=${nro} no encontrado en moviles — borrando filas stale`);
    await _deleteAllRowsForMovil(supabase, nro);
    return [];
  }

  const { escenario_id, empresa_fletera_id, tamano_lote, capacidad } = movilData;

  // Guard: tamano_lote null → no generar filas
  if (tamano_lote == null) {
    console.warn(
      `[zonas-cap-entrega] movilNro=${nro} tamano_lote=null → no genera filas en zonas_cap_entrega`,
    );
    await _deleteAllRowsForMovil(supabase, nro);
    return [];
  }

  const loteDisponible = tamano_lote - (capacidad ?? 0);

  // ── 2. Leer zonas activas del móvil ──────────────────────────────────────
  const { data: zonaRows, error: zonaError } = await (supabase as any)
    .from('moviles_zonas')
    .select('zona_id, escenario_id, tipo_de_servicio')
    .eq('movil_id', String(nro))
    .eq('activa', true);

  if (zonaError) {
    console.error(`[zonas-cap-entrega] Error leyendo moviles_zonas para movil ${nro}:`, zonaError);
    throw zonaError;
  }

  const zonas: Array<{ zona_id: number; escenario_id: number; tipo_de_servicio: string }> =
    (zonaRows ?? []).filter(
      (z: any) => z.tipo_de_servicio != null && z.tipo_de_servicio !== '',
    );

  // ── 3. UPSERT de filas activas ────────────────────────────────────────────
  const upsertedRows: ZonasCapEntregaRow[] = [];

  if (zonas.length > 0) {
    const rows: ZonasCapEntregaRow[] = zonas.map((z) => ({
      escenario: z.escenario_id ?? escenario_id,
      zona: z.zona_id,
      tipo_servicio: z.tipo_de_servicio,
      movil: nro,
      emp_fletera_id: empresa_fletera_id,
      lote_disponible: loteDisponible,
    }));

    const { data: upsertData, error: upsertError } = await (supabase as any)
      .from('zonas_cap_entrega')
      .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), {
        onConflict: 'escenario,zona,tipo_servicio,movil,emp_fletera_id',
        ignoreDuplicates: false,
      })
      .select();

    if (upsertError) {
      console.error(
        `[zonas-cap-entrega] Error en UPSERT para movil ${nro}:`,
        upsertError,
      );
      throw upsertError;
    }

    upsertedRows.push(...(upsertData ?? []));
    console.log(
      `[zonas-cap-entrega] movilNro=${nro} → upserted ${upsertedRows.length} filas` +
        ` (lote_disponible=${loteDisponible})`,
    );
  } else {
    console.log(
      `[zonas-cap-entrega] movilNro=${nro} → 0 zonas activas con tipo_servicio válido`,
    );
  }

  // ── 4. DELETE de filas stale ──────────────────────────────────────────────
  // Filas que existen en zonas_cap_entrega para este movil
  // pero ya no corresponden a ninguna zona activa.
  const { data: existingRows, error: existingError } = await (supabase as any)
    .from('zonas_cap_entrega')
    .select('escenario, zona, tipo_servicio')
    .eq('movil', nro);

  if (existingError) {
    console.error(
      `[zonas-cap-entrega] Error leyendo filas existentes para movil ${nro}:`,
      existingError,
    );
    // No abortar — el upsert ya está hecho; el stale cleanup es best-effort
    return upsertedRows;
  }

  // Conjunto de claves activas (zona+tipo_servicio es suficiente para identificar stale,
  // dado que escenario y emp_fletera_id son fijos para el móvil)
  const activeKeys = new Set(
    zonas.map((z) => `${z.escenario_id ?? escenario_id}:${z.zona_id}:${z.tipo_de_servicio}`),
  );

  const staleRows = (existingRows ?? []).filter(
    (r: any) => !activeKeys.has(`${r.escenario}:${r.zona}:${r.tipo_servicio}`),
  );

  if (staleRows.length > 0) {
    // DELETE one by one to match composite PK cleanly
    // (Supabase JS no soporta DELETE con múltiples condiciones compuestas en un solo call)
    for (const stale of staleRows) {
      const { error: delError } = await (supabase as any)
        .from('zonas_cap_entrega')
        .delete()
        .eq('escenario', stale.escenario)
        .eq('zona', stale.zona)
        .eq('tipo_servicio', stale.tipo_servicio)
        .eq('movil', nro)
        .eq('emp_fletera_id', empresa_fletera_id);

      if (delError) {
        console.error(
          `[zonas-cap-entrega] Error borrando fila stale (movil=${nro} zona=${stale.zona} tipo=${stale.tipo_servicio}):`,
          delError,
        );
        // best-effort: continuar con el resto
      }
    }
    console.log(
      `[zonas-cap-entrega] movilNro=${nro} → deleted ${staleRows.length} filas stale`,
    );
  }

  return upsertedRows;
}

/**
 * Borra TODAS las filas de zonas_cap_entrega para el movil dado.
 * Usado cuando el móvil no existe o tamano_lote es null.
 */
async function _deleteAllRowsForMovil(
  supabase: SupabaseClient,
  nro: number,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('zonas_cap_entrega')
    .delete()
    .eq('movil', nro);

  if (error) {
    console.error(
      `[zonas-cap-entrega] Error borrando todas las filas para movil ${nro}:`,
      error,
    );
    // best-effort
  }
}

/**
 * Función compuesta: recomputa cant_ped/cant_serv/capacidad del móvil
 * y luego sincroniza zonas_cap_entrega para ese mismo móvil.
 *
 * ORDEN GARANTIZADO:
 *   1. recomputeMovilCounters → actualiza `capacidad` en moviles
 *   2. syncMovilZonasCapEntrega → lee `capacidad` ya actualizado
 *
 * USAR en todos los call-sites de mutación que hoy llaman recomputeMovilCounters.
 *
 * @param supabase  - Cliente Supabase de SERVIDOR (getServerSupabaseClient())
 * @param movilNro  - Valor del campo `nro` en tabla moviles
 */
export async function recomputeMovilAndCapEntrega(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
): Promise<void> {
  // Guard: movil inválido → early return
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    return;
  }

  // Paso 1: recomputar contadores (cant_ped, cant_serv, capacidad)
  const result = await recomputeMovilCounters(supabase, movilNro);
  if (result) {
    console.log(
      `[zonas-cap-entrega] trigger=recompute movilNro=${result.movilNro} → ` +
        `cant_ped=${result.cant_ped} cant_serv=${result.cant_serv} capacidad=${result.capacidad}`,
    );
  }

  // Paso 2: sincronizar zonas_cap_entrega con la capacidad recién actualizada
  const syncedRows = await syncMovilZonasCapEntrega(supabase, movilNro);
  const rowCount = Array.isArray(syncedRows) ? syncedRows.length : 0;
  console.log(
    `[zonas-cap-entrega] trigger=sync movilNro=${nro} → rows=${rowCount}`,
  );
}
