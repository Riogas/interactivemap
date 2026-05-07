#!/usr/bin/env node
/**
 * One-shot migration: forzar demorasPollingSeconds=120 y movilesZonasPollingSeconds=90
 * en TODOS los user_preferences existentes (override de prefs guardadas).
 *
 * Uso:
 *   node scripts/migrate-polling-defaults.mjs
 *
 * Requiere: SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL en env (o hardcoded abajo
 * para corrida puntual desde la maquina del dev). NO comitear con keys hardcoded.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en env.');
  process.exit(1);
}

const NEW_DEMORAS = 120;
const NEW_MOVILES_ZONAS = 90;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`\n📡 Conectando a ${SUPABASE_URL} ...`);

  const { data: rows, error } = await supabase
    .from('user_preferences')
    .select('user_id, preferences_extra');

  if (error) {
    console.error('❌ Error al leer user_preferences:', error.message);
    process.exit(1);
  }

  console.log(`✅ Leidos ${rows.length} registros de user_preferences.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const current = row.preferences_extra ?? {};
    const newExtra = {
      ...current,
      demorasPollingSeconds: NEW_DEMORAS,
      movilesZonasPollingSeconds: NEW_MOVILES_ZONAS,
    };

    if (
      current.demorasPollingSeconds === NEW_DEMORAS &&
      current.movilesZonasPollingSeconds === NEW_MOVILES_ZONAS
    ) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from('user_preferences')
      .update({ preferences_extra: newExtra })
      .eq('user_id', row.user_id);

    if (updErr) {
      console.error(`   ⚠ user_id=${row.user_id} → error: ${updErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  console.log('\n📊 Resumen:');
  console.log(`   ✅ Actualizados: ${updated}`);
  console.log(`   ⏭  Sin cambios:  ${skipped}`);
  console.log(`   ❌ Fallidos:     ${failed}`);
  console.log(`   📦 Total:        ${rows.length}\n`);
}

main().catch((e) => {
  console.error('❌ Error inesperado:', e);
  process.exit(1);
});
