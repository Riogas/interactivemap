#!/usr/bin/env node
/**
 * Verifica que los archivos source del repo sean UTF-8 válido.
 * Falla con exit 1 si encuentra un archivo con secuencia UTF-8 inválida
 * (típicamente Latin-1 que algún editor metió por accidente).
 *
 * Uso: node scripts/check-utf8.js
 * Si se pasa una lista de archivos como args, valida solo esos.
 * Sino, escanea todo el repo (excluyendo node_modules, .next, etc).
 *
 * Recomendado correrlo en un git pre-commit hook (ver scripts/pre-commit).
 */
const fs = require('fs');
const path = require('path');

function isUtf8Valid(buf) {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    let len = 0;
    if ((b & 0xE0) === 0xC0) len = 2;
    else if ((b & 0xF0) === 0xE0) len = 3;
    else if ((b & 0xF8) === 0xF0) len = 4;
    else return { ok: false, pos: i };
    for (let j = 1; j < len; j++) {
      if (i + j >= buf.length || (buf[i + j] & 0xC0) !== 0x80) {
        return { ok: false, pos: i };
      }
    }
    i += len - 1;
  }
  return { ok: true };
}

function walk(dir, results = []) {
  const skip = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'as400-api', '.claude']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss)$/.test(entry.name)) results.push(full);
  }
  return results;
}

const argFiles = process.argv.slice(2);
const files = argFiles.length > 0 ? argFiles : walk('.');

const broken = [];
for (const f of files) {
  try {
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    const buf = fs.readFileSync(f);
    const r = isUtf8Valid(buf);
    if (!r.ok) broken.push({ file: f, pos: r.pos });
  } catch {
    // ignore unreadable files
  }
}

if (broken.length > 0) {
  console.error('❌ Archivos con UTF-8 inválido detectados:');
  broken.forEach((b) => console.error(`   ${b.file} (byte ${b.pos})`));
  console.error('\nFix sugerido:');
  console.error("   node -e \"const fs=require('fs');const p='<archivo>';fs.writeFileSync(p,fs.readFileSync(p,'latin1'),'utf8')\"");
  process.exit(1);
}

if (argFiles.length > 0) {
  console.log(`✓ ${files.length} archivo(s) validados como UTF-8`);
}
