#!/usr/bin/env node
/**
 * 🚀 Script de migración — Supabase Self-Hosted
 * 
 * Ejecuta el SQL completo de migración contra la base de datos PostgreSQL.
 * Crea todas las tablas, índices, triggers, RLS, Realtime, etc.
 * 
 * USO:
 *   node scripts/migrate-supabase.js
 * 
 * Variables de entorno (o editar abajo):
 *   DATABASE_URL=postgresql://supabase:PASSWORD@HOST:5432/postgres
 * 
 * Requisitos:
 *   pnpm add -D pg  (ya instalado)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURACIÓN — Editar si es necesario
// ============================================================
const DATABASE_URL = process.env.DATABASE_URL 
  || 'postgresql://supabase:7085a1e06cd3dd95b45ad0bc6c1bb2c1@192.168.2.26:5432/postgres';

const SQL_FILE = path.join(__dirname, '..', 'docs', 'sqls', 'supabase-full-migration.sql');

// ============================================================

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  🚀 TRACKMOVIL — Migración Supabase Self-Hosted');
  console.log('═'.repeat(60));
  console.log('');

  // 1. Leer SQL
  console.log('📄 Leyendo archivo SQL...');
  if (!fs.existsSync(SQL_FILE)) {
    console.error(`❌ No se encontró: ${SQL_FILE}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(SQL_FILE, 'utf-8');
  console.log(`   ✅ ${sql.length} caracteres leídos`);
  console.log(`   📁 ${SQL_FILE}`);
  console.log('');

  // 2. Conectar a PostgreSQL
  console.log('🔌 Conectando a PostgreSQL...');
  console.log(`   URL: ${DATABASE_URL.replace(/:[^@]+@/, ':***@')}`);
  
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000, // 60s por statement
  });

  try {
    await client.connect();
    console.log('   ✅ Conectado');
    
    // Verificar versión
    const versionResult = await client.query('SELECT version()');
    console.log(`   📊 ${versionResult.rows[0].version.split(',')[0]}`);
    console.log('');

    // 3. Ejecutar SQL de migración
    console.log('⚡ Ejecutando migración SQL...');
    console.log('   (esto puede tardar unos segundos)');
    console.log('');

    const startTime = Date.now();
    
    // Ejecutar todo el SQL como un solo bloque transaccional
    // Algunos comandos (ALTER PUBLICATION, CREATE EXTENSION) no pueden ir en transacción,
    // así que ejecutamos todo directamente
    await client.query(sql);
    
    const duration = Date.now() - startTime;
    console.log(`   ✅ SQL ejecutado en ${duration}ms`);
    console.log('');

    // 4. Verificar tablas creadas
    console.log('🔍 Verificando tablas creadas...');
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    const expectedTables = [
      'empresas_fleteras', 'moviles', 'pedidos', 'services',
      'gps_tracking_history', 'gps_latest_positions',
      'puntos_interes', 'zonas', 'demoras', 'puntoventa'
    ];
    
    const existingTables = tablesResult.rows.map(r => r.tablename);
    let allOk = true;
    
    for (const table of expectedTables) {
      const exists = existingTables.includes(table);
      console.log(`   ${exists ? '✅' : '❌'} ${table}`);
      if (!exists) allOk = false;
    }
    console.log('');

    // 5. Verificar extensiones
    console.log('🔍 Verificando extensiones...');
    const extResult = await client.query(`
      SELECT extname FROM pg_extension WHERE extname = 'postgis'
    `);
    console.log(`   ${extResult.rows.length > 0 ? '✅' : '⚠️ '} PostGIS: ${extResult.rows.length > 0 ? 'instalado' : 'NO instalado (algunas funciones geoespaciales no estarán disponibles)'}`);
    console.log('');

    // 6. Verificar RLS
    console.log('🔍 Verificando Row Level Security...');
    const rlsResult = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN (${expectedTables.map(t => `'${t}'`).join(',')})
      ORDER BY tablename
    `);
    const rlsEnabled = rlsResult.rows.filter(r => r.rowsecurity).length;
    console.log(`   🔒 ${rlsEnabled}/${expectedTables.length} tablas con RLS habilitado`);
    console.log('');

    // 7. Verificar Realtime
    console.log('🔍 Verificando Realtime...');
    try {
      const rtResult = await client.query(`
        SELECT tablename 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime'
        ORDER BY tablename
      `);
      console.log(`   📡 ${rtResult.rows.length} tablas en Realtime:`);
      rtResult.rows.forEach(r => console.log(`      - ${r.tablename}`));
    } catch (e) {
      console.log(`   ⚠️  No se pudo verificar Realtime: ${e.message}`);
    }
    console.log('');

    // 8. Verificar triggers
    console.log('🔍 Verificando triggers clave...');
    const triggerResult = await client.query(`
      SELECT trigger_name, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_schema = 'public'
        AND trigger_name IN ('trigger_sync_latest_position', 'trigger_update_gps_geom', 'trigger_update_latest_geom')
      ORDER BY trigger_name
    `);
    const keyTriggers = [
      { name: 'trigger_sync_latest_position', table: 'gps_tracking_history', desc: 'Auto-UPSERT latest positions' },
      { name: 'trigger_update_gps_geom', table: 'gps_tracking_history', desc: 'PostGIS geom (history)' },
      { name: 'trigger_update_latest_geom', table: 'gps_latest_positions', desc: 'PostGIS geom (latest)' },
    ];
    for (const t of keyTriggers) {
      const found = triggerResult.rows.find(r => r.trigger_name === t.name);
      console.log(`   ${found ? '✅' : '❌'} ${t.name} → ${t.desc}`);
    }
    console.log('');

    // Resumen
    console.log('═'.repeat(60));
    if (allOk) {
      console.log('  ✅ MIGRACIÓN COMPLETADA EXITOSAMENTE');
    } else {
      console.log('  ⚠️  MIGRACIÓN COMPLETADA CON ADVERTENCIAS');
      console.log('  Algunas tablas o extensiones pueden faltar.');
    }
    console.log('═'.repeat(60));
    console.log('');
    console.log('📋 Próximos pasos:');
    console.log('   1. Actualizar SUPABASE_SERVICE_ROLE_KEY en .env.local');
    console.log('   2. Reiniciar la app: pnpm dev');
    console.log('   3. Los datos se importarán automáticamente desde la API AS400');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ ERROR DE MIGRACIÓN:');
    console.error(`   ${error.message}`);
    
    if (error.position) {
      // Mostrar contexto del error en el SQL
      const pos = parseInt(error.position);
      const context = sql.substring(Math.max(0, pos - 100), pos + 100);
      console.error('');
      console.error('   📍 Contexto del error en SQL:');
      console.error('   ' + '-'.repeat(50));
      console.error('   ' + context.split('\n').join('\n   '));
      console.error('   ' + '-'.repeat(50));
    }
    
    console.error('');
    console.error('💡 Posibles soluciones:');
    console.error('   - Si es un error de PostGIS: instalar extensión en el servidor');
    console.error('   - Si es un error de permisos: verificar rol del usuario');
    console.error('   - Si es un error de tabla existente: la migración es idempotente, es seguro re-ejecutar');
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
