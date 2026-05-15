import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeMovilCounters } from '@/lib/movil-counters';

const DEFAULT_PESO_TRANSITO_ALPHA = 0.3;

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
 * Calcula la porcion del lote libre para cada zona usando prorrateo con peso.
 *
 * Pesos: prioridad_o_transito === 1 => peso 1 (prioridad), otro => peso alpha (transito).
 *
 * W = sum(peso_zona para todas las zonas)
 * porcion_zona = ceil(lote_libre * peso_zona / W)
 *
 * Edge cases:
 *  - lote_libre <= 0 => todas las porciones son 0
 *  - W === 0 (sin zonas) => array vacio
 *  - alpha = 0 y solo zonas de transito => W = 0, array vacio (no upsertamos nada)
 */
function calcularPorciones(
  zonas: Array<{ zona_id: number; escenario_id: number; tipo_de_servicio: string; prioridad_o_transito: number }>,
  loteLibre: number,
  alpha: number,
): Array<{ zona_id: number; escenario_id: number; tipo_de_servicio: string; porcion: number }> {
  if (zonas.length === 0) return [];

  // lote_libre negativo o cero => todas las porciones son 0
  const loteEfectivo = Math.max(0, loteLibre);

  // Calcular W = suma de pesos
  const W = zonas.reduce((acc, z) => {
    const peso = z.prioridad_o_transito === 1 ? 1 : alpha;
    return acc + peso;
  }, 0);

  // Si W === 0 (por ej: alpha=0 y solo zonas de transito) => no generar filas
  if (W === 0) return [];

  return zonas.map(z => {
    const peso = z.prioridad_o_transito === 1 ? 1 : alpha;
    const porcion = loteEfectivo === 0 ? 0 : Math.ceil(loteEfectivo * peso / W);
    return {
      zona_id: z.zona_id,
      escenario_id: z.escenario_id,
      tipo_de_servicio: z.tipo_de_servicio,
      porcion,
    };
  });
}

/**
 * Sincroniza zonas_cap_entrega para el movil dado, usando prorrateo con peso alpha.
 *
 * ESTRATEGIA (idempotente):
 *   1. Lee el estado actual del movil desde `moviles` (escenario_id, empresa_fletera_id,
 *      tamano_lote, capacidad). Si tamano_lote es null, no genera filas y borra las previas.
 *   2. Lee pesoTransitoAlpha del escenario_settings del escenario del movil (default 0.3).
 *   3. Lee la lista de zonas activas del movil desde `moviles_zonas` incluyendo
 *      tipo_de_servicio y prioridad_o_transito por fila.
 *   4. Calcula lote_libre = max(0, tamano_lote - capacidad).
 *   5. Calcula W = sum(peso_zona) donde peso = 1 si prioridad, alpha si transito.
 *   6. Por cada zona: porcion = ceil(lote_libre * peso_zona / W).
 *   7. UPSERT en zonas_cap_entrega con lote_disponible = porcion.
 *   8. DELETE filas stale.
 *
 * PRECONDICION:
 *   Llamar DESPUES de recomputeMovilCounters para que `capacidad` este actualizado.
 *   Usar recomputeMovilAndCapEntrega() que garantiza este orden.
 *
 * CLIENTE:
 *   SIEMPRE pasar getServerSupabaseClient() — service role para bypass RLS.
 *
 * @param supabase  - Cliente Supabase de SERVIDOR (getServerSupabaseClient())
 * @param movilNro  - Valor del campo `nro` en tabla moviles
 * @returns Array de filas upserted, o void si movilNro invalido
 */
export async function syncMovilZonasCapEntrega(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
): Promise<ZonasCapEntregaRow[] | void> {
  // Guard: movil invalido => early return sin queries
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    return;
  }

  // ── 1. Leer estado actual del movil ──────────────────────────────────────
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
    // Movil no existe en la tabla => borrar filas stale si las hubiera
    console.warn(`[zonas-cap-entrega] movilNro=${nro} no encontrado en moviles — borrando filas stale`);
    await _deleteAllRowsForMovil(supabase, nro);
    return [];
  }

  const { escenario_id, empresa_fletera_id, tamano_lote, capacidad } = movilData;

  // Guard: tamano_lote null => no generar filas
  if (tamano_lote == null) {
    console.warn(
      `[zonas-cap-entrega] movilNro=${nro} tamano_lote=null => no genera filas en zonas_cap_entrega`,
    );
    await _deleteAllRowsForMovil(supabase, nro);
    return [];
  }

  // ── 2. Leer pesoTransitoAlpha del escenario ──────────────────────────────
  let alpha = DEFAULT_PESO_TRANSITO_ALPHA;
  if (escenario_id != null) {
    const { data: settingsRow } = await (supabase as any)
      .from('escenario_settings')
      .select('peso_transito_alpha')
      .eq('escenario_id', escenario_id)
      .maybeSingle();

    if (settingsRow?.peso_transito_alpha != null) {
      alpha = Number(settingsRow.peso_transito_alpha);
    }
  }

  const loteLibre = tamano_lote - (capacidad ?? 0);

  // ── 3. Leer zonas activas del movil ──────────────────────────────────────
  const { data: zonaRows, error: zonaError } = await (supabase as any)
    .from('moviles_zonas')
    .select('zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito')
    .eq('movil_id', String(nro))
    .eq('activa', true);

  if (zonaError) {
    console.error(`[zonas-cap-entrega] Error leyendo moviles_zonas para movil ${nro}:`, zonaError);
    throw zonaError;
  }

  const zonas: Array<{ zona_id: number; escenario_id: number; tipo_de_servicio: string; prioridad_o_transito: number }> =
    (zonaRows ?? []).filter(
      (z: any) => z.tipo_de_servicio != null && z.tipo_de_servicio !== '',
    );

  // ── 4. Calcular porciones con prorrateo ───────────────────────────────────
  const porciones = calcularPorciones(zonas, loteLibre, alpha);

  // ── 5. UPSERT de filas activas ────────────────────────────────────────────
  const upsertedRows: ZonasCapEntregaRow[] = [];

  if (porciones.length > 0) {
    const rows: ZonasCapEntregaRow[] = porciones.map((p) => ({
      escenario: p.escenario_id ?? escenario_id,
      zona: p.zona_id,
      tipo_servicio: p.tipo_de_servicio,
      movil: nro,
      emp_fletera_id: empresa_fletera_id,
      lote_disponible: p.porcion,
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
      `[zonas-cap-entrega] movilNro=${nro} => upserted ${upsertedRows.length} filas` +
        ` (lote_libre=${loteLibre}, alpha=${alpha})`,
    );
  } else {
    console.log(
      `[zonas-cap-entrega] movilNro=${nro} => 0 zonas activas con tipo_servicio valido o W=0`,
    );
  }

  // ── 6. DELETE de filas stale ──────────────────────────────────────────────
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
    // No abortar — el upsert ya esta hecho; el stale cleanup es best-effort
    return upsertedRows;
  }

  // Conjunto de claves activas (zona+tipo_servicio es suficiente para identificar stale,
  // dado que escenario y emp_fletera_id son fijos para el movil)
  const activeKeys = new Set(
    porciones.map((p) => `${p.escenario_id ?? escenario_id}:${p.zona_id}:${p.tipo_de_servicio}`),
  );

  const staleRows = (existingRows ?? []).filter(
    (r: any) => !activeKeys.has(`${r.escenario}:${r.zona}:${r.tipo_servicio}`),
  );

  if (staleRows.length > 0) {
    // DELETE one by one to match composite PK cleanly
    // (Supabase JS no soporta DELETE con multiples condiciones compuestas en un solo call)
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
      `[zonas-cap-entrega] movilNro=${nro} => deleted ${staleRows.length} filas stale`,
    );
  }

  return upsertedRows;
}

/**
 * Borra TODAS las filas de zonas_cap_entrega para el movil dado.
 * Usado cuando el movil no existe o tamano_lote es null.
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
 * Funcion compuesta: recomputa cant_ped/cant_serv/capacidad del movil
 * y luego sincroniza zonas_cap_entrega para ese mismo movil.
 *
 * ORDEN GARANTIZADO:
 *   1. recomputeMovilCounters => actualiza `capacidad` en moviles
 *   2. syncMovilZonasCapEntrega => lee `capacidad` ya actualizado
 *
 * USAR en todos los call-sites de mutacion que hoy llaman recomputeMovilCounters.
 *
 * @param supabase  - Cliente Supabase de SERVIDOR (getServerSupabaseClient())
 * @param movilNro  - Valor del campo `nro` en tabla moviles
 */
export async function recomputeMovilAndCapEntrega(
  supabase: SupabaseClient,
  movilNro: number | string | null | undefined,
): Promise<void> {
  // Guard: movil invalido => early return
  const nro = Number(movilNro);
  if (movilNro == null || !Number.isFinite(nro) || nro === 0) {
    return;
  }

  // Paso 1: recomputar contadores (cant_ped, cant_serv, capacidad)
  const result = await recomputeMovilCounters(supabase, movilNro);
  if (result) {
    console.log(
      `[zonas-cap-entrega] trigger=recompute movilNro=${result.movilNro} => ` +
        `cant_ped=${result.cant_ped} cant_serv=${result.cant_serv} capacidad=${result.capacidad}`,
    );
  }

  // Paso 2: sincronizar zonas_cap_entrega con la capacidad recien actualizada
  const syncedRows = await syncMovilZonasCapEntrega(supabase, movilNro);
  const rowCount = Array.isArray(syncedRows) ? syncedRows.length : 0;
  console.log(
    `[zonas-cap-entrega] trigger=sync movilNro=${nro} => rows=${rowCount}`,
  );
}
