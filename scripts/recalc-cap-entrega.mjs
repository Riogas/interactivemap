#!/usr/bin/env node
/**
 * One-shot: recalcular zonas_cap_entrega para TODOS los móviles (o de un escenario)
 * con la fórmula de prorrateo PONDERADO (CapEntrega.docx 2026-06-11):
 *
 *   aporte(zona) = (lote_libre / Σpesos) * peso_zona
 *   peso prioridad = 1 ; peso transito = peso_transito_alpha (por escenario)
 *   Σpesos = Σ pesos de todas las zonas activas del móvil
 *
 * Replica la lógica de lib/zonas-cap-entrega.ts (calcularPorciones + sync),
 * porque este script .mjs no puede importar el TS con alias '@/'.
 *
 * Necesario tras migrar a la fórmula nueva: las filas existentes quedaron con
 * valores viejos (la migración SQL solo cambió el TIPO de la columna, no recalculó).
 *
 * Uso:
 *   node scripts/recalc-cap-entrega.mjs                 # todos los escenarios
 *   node scripts/recalc-cap-entrega.mjs --escenario=1000
 *   node scripts/recalc-cap-entrega.mjs --movil=492     # un solo móvil
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en env.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en env.');
  process.exit(1);
}

const DEFAULT_ALPHA = 0.3;

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const filtroEscenario = getArg('escenario') ? Number(getArg('escenario')) : null;
const filtroMovil = getArg('movil') ? Number(getArg('movil')) : null;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── fórmula de prorrateo ponderado, SEPARADO POR TIPO DE SERVICIO ───────────
// (espejo de lib/zonas-cap-entrega.ts)
function calcularPorciones(zonas, loteLibre, alpha) {
  if (zonas.length === 0) return [];
  const loteEfectivo = Math.max(0, loteLibre);
  const pesoDeZona = (z) => (z.prioridad_o_transito === 1 ? 1 : alpha);
  // W por tipo de servicio: el lote se prorratea independiente por cada tipo.
  const W_porTipo = new Map();
  for (const z of zonas) {
    W_porTipo.set(z.tipo_de_servicio, (W_porTipo.get(z.tipo_de_servicio) ?? 0) + pesoDeZona(z));
  }
  return zonas.map((z) => {
    const W = W_porTipo.get(z.tipo_de_servicio) ?? 0;
    let porcion;
    if (loteEfectivo === 0 || W <= 0) {
      porcion = 0;
    } else {
      porcion = Math.round(((loteEfectivo / W) * pesoDeZona(z)) * 10000) / 10000;
    }
    return {
      zona_id: z.zona_id,
      escenario_id: z.escenario_id,
      tipo_de_servicio: z.tipo_de_servicio,
      porcion,
    };
  });
}

// Cache de alpha por escenario.
const alphaCache = new Map();
async function getAlpha(escenarioId) {
  if (escenarioId == null) return DEFAULT_ALPHA;
  if (alphaCache.has(escenarioId)) return alphaCache.get(escenarioId);
  const { data } = await supabase
    .from('escenario_settings')
    .select('peso_transito_alpha')
    .eq('escenario_id', escenarioId)
    .maybeSingle();
  const alpha = data?.peso_transito_alpha != null ? Number(data.peso_transito_alpha) : DEFAULT_ALPHA;
  alphaCache.set(escenarioId, alpha);
  return alpha;
}

async function recalcMovil(nro) {
  const { data: movil, error: movilErr } = await supabase
    .from('moviles')
    .select('escenario_id, empresa_fletera_id, tamano_lote, capacidad')
    .eq('nro', nro)
    .maybeSingle();
  if (movilErr) throw movilErr;
  if (!movil || movil.tamano_lote == null) {
    // Sin lote: borrar filas previas.
    await supabase.from('zonas_cap_entrega').delete().eq('movil', nro);
    return { nro, rows: 0, skipped: true };
  }

  const alpha = await getAlpha(movil.escenario_id);
  const loteLibre = movil.tamano_lote - (movil.capacidad ?? 0);

  const { data: zonaRows, error: zonaErr } = await supabase
    .from('moviles_zonas')
    .select('zona_id, escenario_id, tipo_de_servicio, prioridad_o_transito')
    .eq('movil_id', String(nro))
    .eq('activa', true);
  if (zonaErr) throw zonaErr;

  const zonas = (zonaRows ?? []).filter((z) => z.tipo_de_servicio != null && z.tipo_de_servicio !== '');
  const porciones = calcularPorciones(zonas, loteLibre, alpha);

  if (porciones.length > 0) {
    const rows = porciones.map((p) => ({
      escenario: p.escenario_id ?? movil.escenario_id,
      zona: p.zona_id,
      tipo_servicio: p.tipo_de_servicio,
      movil: nro,
      emp_fletera_id: movil.empresa_fletera_id,
      lote_disponible: p.porcion,
      updated_at: new Date().toISOString(),
    }));
    const { error: upErr } = await supabase
      .from('zonas_cap_entrega')
      .upsert(rows, { onConflict: 'escenario,zona,tipo_servicio,movil,emp_fletera_id', ignoreDuplicates: false });
    if (upErr) throw upErr;
  }

  // Borrar filas stale (zona+tipo que ya no corresponde a una zona activa).
  const activeKeys = new Set(
    porciones.map((p) => `${p.escenario_id ?? movil.escenario_id}:${p.zona_id}:${p.tipo_de_servicio}`),
  );
  const { data: existing } = await supabase
    .from('zonas_cap_entrega')
    .select('escenario, zona, tipo_servicio')
    .eq('movil', nro);
  for (const r of existing ?? []) {
    if (!activeKeys.has(`${r.escenario}:${r.zona}:${r.tipo_servicio}`)) {
      await supabase
        .from('zonas_cap_entrega')
        .delete()
        .eq('escenario', r.escenario)
        .eq('zona', r.zona)
        .eq('tipo_servicio', r.tipo_servicio)
        .eq('movil', nro)
        .eq('emp_fletera_id', movil.empresa_fletera_id);
    }
  }

  return { nro, rows: porciones.length, skipped: false };
}

async function main() {
  console.log(`\n📡 Conectando a ${SUPABASE_URL} ...`);

  let movilNros = [];
  if (filtroMovil != null) {
    movilNros = [filtroMovil];
  } else {
    let q = supabase.from('moviles').select('nro');
    if (filtroEscenario != null) q = q.eq('escenario_id', filtroEscenario);
    const { data, error } = await q;
    if (error) {
      console.error('❌ Error listando móviles:', error.message);
      process.exit(1);
    }
    movilNros = (data ?? []).map((m) => m.nro).filter((n) => Number.isFinite(Number(n)));
  }

  const scope = filtroMovil != null
    ? `móvil ${filtroMovil}`
    : filtroEscenario != null
      ? `escenario ${filtroEscenario}`
      : 'TODOS los escenarios';
  console.log(`🔄 Recalculando cap-entrega para ${scope} — ${movilNros.length} móviles...\n`);

  let ok = 0;
  let skipped = 0;
  const errors = [];

  for (const nro of movilNros) {
    try {
      const res = await recalcMovil(nro);
      if (res.skipped) skipped++;
      else ok++;
      if ((ok + skipped) % 50 === 0) {
        console.log(`  ... ${ok + skipped}/${movilNros.length} procesados`);
      }
    } catch (e) {
      console.error(`  ⚠️ Error en móvil ${nro}:`, e.message ?? e);
      errors.push(nro);
    }
  }

  console.log(`\n✅ Listo. ${ok} recalculados, ${skipped} sin lote (omitidos), ${errors.length} con error.`);
  if (errors.length > 0) console.log(`   Móviles con error: ${errors.join(', ')}`);
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Error fatal:', e);
  process.exit(1);
});
