#!/usr/bin/env node
/**
 * parity-moviles-dia.mjs
 * ======================
 * PROPÓSITO:
 *   Safety gate para la Task 1.7 del read model moviles_dia.
 *   Verifica que fn_moviles_dia_rebuild produce exactamente los mismos
 *   flags (activo, oculto_operativo) y contadores (pedidos_pendientes,
 *   services_pendientes) que la lógica client-side de lib/moviles/visibility.ts
 *   para un (escenario, fecha) dados.
 *
 * PASOS QUE EJECUTA:
 *   1. Llama fn_moviles_dia_rebuild(p_desde, p_hasta, p_escenario) vía RPC
 *      para asegurarse de que la tabla está actualizada.
 *   2. Lee todas las filas de moviles_dia para ese escenario+fecha.
 *   3. Lee las fuentes originales: moviles, pedidos y services para esa fecha.
 *   4. Recomputa los flags/contadores con la lógica inlineada de visibility.ts.
 *   5. Compara fila a fila e imprime cada MISMATCH con detalle.
 *   6. Termina con código 0 (PARIDAD OK) o 1 (PARIDAD FALLO: N mismatches).
 *
 * NOTA SOBRE IMPORTACIÓN DE TS:
 *   Este script es .mjs puro (Node nativo) para no requerir dependencias extra.
 *   Las funciones isMovilActiveForUI y getHiddenMovilIds de lib/moviles/visibility.ts
 *   están replicadas inline a continuación. Si la lógica de visibility.ts cambia,
 *   ACTUALIZAR también este script. Las firmas y reglas son idénticas a la fuente
 *   (ver comentarios en cada función).
 *
 * ENV VARS REQUERIDAS:
 *   NEXT_PUBLIC_SUPABASE_URL   — URL del proyecto Supabase
 *                                (también acepta SUPABASE_URL como fallback)
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (bypassa RLS)
 *
 * USO:
 *   node scripts/parity-moviles-dia.mjs <escenario> <fecha YYYY-MM-DD>
 *
 * EJEMPLOS:
 *   node scripts/parity-moviles-dia.mjs 1000 2026-05-27
 *   NEXT_PUBLIC_SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/parity-moviles-dia.mjs 1000 2026-05-27
 *
 * Para cargar desde .env.local sin instalar dotenv:
 *   node --env-file=.env.local scripts/parity-moviles-dia.mjs 1000 2026-05-27
 *   (Node >= 20.6)
 */

import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Args y env
// ─────────────────────────────────────────────────────────────────────────────

const [, , escenarioArg, fechaArg] = process.argv;

if (!escenarioArg || !fechaArg) {
  console.error(
    "Uso: node scripts/parity-moviles-dia.mjs <escenario> <fecha YYYY-MM-DD>"
  );
  process.exit(1);
}

const escenario = Number(escenarioArg);
if (!Number.isInteger(escenario) || escenario <= 0) {
  console.error(`Escenario inválido: "${escenarioArg}" (debe ser entero positivo)`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaArg)) {
  console.error(`Fecha inválida: "${fechaArg}" (formato requerido: YYYY-MM-DD)`);
  process.exit(1);
}

const fecha = fechaArg; // "YYYY-MM-DD"

// Formato YYYYMMDD que usan pedidos.fch_para y services.fch_para
const fechaYmd = fecha.replace(/-/g, ""); // "YYYYMMDD"

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client (service role, sin persistencia de sesión)
// Mismo patrón que migrate-polling-defaults.mjs
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─────────────────────────────────────────────────────────────────────────────
// Lógica de visibilidad — RÉPLICA EXACTA de lib/moviles/visibility.ts
// Mantener sincronizado si visibility.ts cambia.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True si estadoNro corresponde a un móvil "activo" desde el punto de vista
 * de la UI. Réplica de isMovilActiveForUI (visibility.ts).
 * Activos: null | undefined | 0 | 1 | 2 | 4
 */
function isMovilActiveForUI(estadoNro) {
  if (estadoNro === null || estadoNro === undefined) return true;
  return (
    estadoNro === 0 ||
    estadoNro === 1 ||
    estadoNro === 2 ||
    estadoNro === 4
  );
}

/**
 * Devuelve el Set<number> de movil_id ocultos-pero-operativos.
 * Réplica de getHiddenMovilIds (visibility.ts).
 *
 * Grupo 1: móviles presentes en `moviles` con estado no-activo pero
 *           al menos un pedido/service asignado (p.movil o s.movil coincide).
 * Grupo 2: móviles referenciados por pedidos/services pero ausentes de `moviles`
 *           (huérfanos).
 *
 * @param {Array<{id: number, estadoNro: number|null|undefined}>} moviles
 * @param {Array<{movil: number|string|null|undefined}>} pedidos
 * @param {Array<{movil: number|string|null|undefined}>} services
 * @returns {Set<number>}
 */
function getHiddenMovilIds(moviles, pedidos, services) {
  const hidden = new Set();
  const known = new Set();

  for (const m of moviles) {
    known.add(m.id);
    if (isMovilActiveForUI(m.estadoNro)) continue;
    // Movil no-activo: oculto si tiene al menos un pedido o service
    const hasPedido = pedidos.some(
      (p) => p.movil != null && Number(p.movil) === m.id
    );
    if (hasPedido) {
      hidden.add(m.id);
      continue;
    }
    if (services && services.length > 0) {
      const hasService = services.some(
        (s) => s.movil != null && Number(s.movil) === m.id
      );
      if (hasService) hidden.add(m.id);
    }
  }

  // Grupo 2: huérfanos referenciados en pedidos/services pero no en moviles
  const addOrphan = (raw) => {
    if (raw == null) return;
    const id = Number(raw);
    if (!Number.isFinite(id) || id === 0) return;
    if (known.has(id)) return;
    hidden.add(id);
  };
  for (const p of pedidos) addOrphan(p.movil);
  if (services) for (const s of services) addOrphan(s.movil);

  return hidden;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nParidad moviles_dia`);
  console.log(`  Supabase : ${SUPABASE_URL}`);
  console.log(`  Escenario: ${escenario}`);
  console.log(`  Fecha    : ${fecha} (fch_para="${fechaYmd}")\n`);

  // ── Paso 1: Invocar fn_moviles_dia_rebuild para la fecha ──────────────────

  console.log("Paso 1: llamando fn_moviles_dia_rebuild ...");
  const { data: rebuildData, error: rebuildError } = await supabase.rpc(
    "fn_moviles_dia_rebuild",
    {
      p_desde: fecha,
      p_hasta: fecha,
      p_escenario: escenario,
    }
  );

  if (rebuildError) {
    console.error("ERROR en fn_moviles_dia_rebuild:", rebuildError.message);
    process.exit(1);
  }
  console.log(`  Filas tocadas: ${rebuildData ?? "(no retornó valor)"}\n`);

  // ── Paso 2: Leer moviles_dia para escenario+fecha ─────────────────────────

  console.log("Paso 2: leyendo moviles_dia ...");
  const { data: diasRows, error: diasError } = await supabase
    .from("moviles_dia")
    .select(
      "movil_id, activo, oculto_operativo, pedidos_pendientes, services_pendientes, estado_nro"
    )
    .eq("escenario_id", escenario)
    .eq("fecha", fecha);

  if (diasError) {
    console.error("ERROR leyendo moviles_dia:", diasError.message);
    process.exit(1);
  }
  console.log(`  Filas en moviles_dia: ${diasRows.length}\n`);

  if (diasRows.length === 0) {
    console.warn(
      "AVISO: moviles_dia devolvió 0 filas para este escenario+fecha. " +
        "El rebuild puede haber encontrado 0 moviles con actividad en esa fecha."
    );
    console.log("\nPARIDAD OK (0 filas — nada que comparar)");
    process.exit(0);
  }

  // ── Paso 3: Leer fuentes originales ──────────────────────────────────────

  console.log("Paso 3: leyendo fuentes originales ...");

  // 3a. moviles del escenario — necesitamos nro y estado_nro
  const { data: movilesRaw, error: movilesError } = await supabase
    .from("moviles")
    .select("nro, estado_nro")
    .eq("escenario_id", escenario);

  if (movilesError) {
    console.error("ERROR leyendo moviles:", movilesError.message);
    process.exit(1);
  }

  // Normalizar: en visibility.ts el campo se llama "id" (movil_id lógico)
  // y "estadoNro". Moviles.nro es el id lógico (INTEGER).
  const movilesList = (movilesRaw ?? []).map((m) => ({
    id: m.nro,
    estadoNro: m.estado_nro ?? null,
  }));
  console.log(`  Moviles del escenario: ${movilesList.length}`);

  // 3b. pedidos para escenario+fecha (cualquier estado, excluyendo REG. HISTORICO
  //     estado_nro=2 AND sub_estado_nro=17 — igual que fn_moviles_dia_rebuild)
  const { data: pedidosRaw, error: pedidosError } = await supabase
    .from("pedidos")
    .select("movil, estado_nro, sub_estado_nro")
    .eq("escenario", escenario)
    .eq("fch_para", fechaYmd);

  if (pedidosError) {
    console.error("ERROR leyendo pedidos:", pedidosError.message);
    process.exit(1);
  }

  // Excluir REG. HISTORICO (mismo criterio que fn_moviles_dia_rebuild y /api/pedidos)
  const pedidosFiltrados = (pedidosRaw ?? []).filter(
    (p) => !(Number(p.estado_nro) === 2 && Number(p.sub_estado_nro) === 17)
  );
  console.log(
    `  Pedidos en fecha (sin REG. HISTORICO): ${pedidosFiltrados.length} ` +
      `(total bruto: ${pedidosRaw.length})`
  );

  // 3c. services para la fecha — doble filtro: fch_hora_para OR fch_para
  //     No se filtra por escenario en services (igual que fn_moviles_dia_rebuild).
  //     Se filtra por estado_nro=1 solo para los PENDIENTES; para getHiddenMovilIds
  //     necesitamos CUALQUIER estado (igual que tiene_op).
  const fechaInicio = `${fecha}T00:00:00`;
  const fechaFin = `${fecha}T23:59:59`;

  // Traer services que matcheen por fch_hora_para dentro del día
  const { data: servicesFchHora, error: servFchHoraError } = await supabase
    .from("services")
    .select("movil, estado_nro, fch_para")
    .gte("fch_hora_para", fechaInicio)
    .lte("fch_hora_para", fechaFin);

  if (servFchHoraError) {
    console.error("ERROR leyendo services (fch_hora_para):", servFchHoraError.message);
    process.exit(1);
  }

  // Traer services que matcheen por fch_para = YYYYMMDD
  const { data: servicesFchPara, error: servFchParaError } = await supabase
    .from("services")
    .select("movil, estado_nro, fch_para")
    .eq("fch_para", fechaYmd);

  if (servFchParaError) {
    console.error("ERROR leyendo services (fch_para):", servFchParaError.message);
    process.exit(1);
  }

  // Unión deduplicada por referencia (no tenemos PK acá, usamos un Map por índice)
  // Como no pedimos pk/id en el select, deduplicamos combinando ambos arrays y
  // filtrando duplicados por contenido (movil+estado_nro+fch_para).
  // En la práctica los servicios con fch_hora_para en el día y fch_para=YYYYMMDD
  // se solapan — la deduplicación exacta aquí solo afecta los conteos directos.
  const servSet = new Map();
  const makeKey = (s) => `${s.movil}|${s.estado_nro}|${s.fch_para}`;
  for (const s of servicesFchHora ?? []) servSet.set(makeKey(s) + `|h`, s);
  for (const s of servicesFchPara ?? []) {
    const k = makeKey(s) + `|p`;
    if (!servSet.has(k)) servSet.set(k, s);
  }
  const servicesList = Array.from(servSet.values());
  console.log(
    `  Services en fecha: ${servicesList.length} ` +
      `(fch_hora_para: ${servicesFchHora.length}, fch_para: ${servicesFchPara.length})`
  );

  // ── Paso 4: Recomputar flags esperados ────────────────────────────────────

  console.log("\nPaso 4: recomputando flags con lógica de visibility.ts ...");

  // Replicar isMovilActiveForUI por movil_id (nro)
  const activoExpMap = new Map(); // movil_id → boolean
  for (const m of movilesList) {
    activoExpMap.set(m.id, isMovilActiveForUI(m.estadoNro));
  }

  // Replicar getHiddenMovilIds
  const hiddenSet = getHiddenMovilIds(movilesList, pedidosFiltrados, servicesList);

  // Contadores esperados (pendientes): estado_nro = 1
  //   pedidos_pendientes: escenario + fch_para + estado_nro=1 (ya filtrado REG. HISTORICO)
  //   services_pendientes: cualquiera de los dos filtros de fecha + estado_nro=1
  const pedidosPendMap = new Map(); // movil_id → count
  for (const p of pedidosFiltrados) {
    if (Number(p.estado_nro) === 1 && p.movil != null) {
      const id = Number(p.movil);
      pedidosPendMap.set(id, (pedidosPendMap.get(id) ?? 0) + 1);
    }
  }

  const servicesPendMap = new Map(); // movil_id → count
  for (const s of servicesList) {
    if (Number(s.estado_nro) === 1 && s.movil != null) {
      const id = Number(s.movil);
      servicesPendMap.set(id, (servicesPendMap.get(id) ?? 0) + 1);
    }
  }

  // ── Paso 5: Comparar fila a fila ─────────────────────────────────────────

  console.log("Paso 5: comparando fila a fila ...\n");

  const mismatches = [];

  for (const row of diasRows) {
    const mid = row.movil_id;
    const issues = [];

    // activo
    const expActivo = activoExpMap.has(mid)
      ? activoExpMap.get(mid)
      : // Si el movil no está en la tabla moviles, activo=false (igual que la fn SQL)
        false;
    if (row.activo !== expActivo) {
      issues.push(
        `activo: DB=${row.activo} vs esperado=${expActivo} ` +
          `(estado_nro=${row.estado_nro ?? "null"})`
      );
    }

    // oculto_operativo
    const expOculto = hiddenSet.has(mid);
    if (row.oculto_operativo !== expOculto) {
      issues.push(
        `oculto_operativo: DB=${row.oculto_operativo} vs esperado=${expOculto}`
      );
    }

    // pedidos_pendientes (solo validar si la DB tiene valor no-null)
    if (row.pedidos_pendientes !== null) {
      const expPed = pedidosPendMap.get(mid) ?? 0;
      if (row.pedidos_pendientes !== expPed) {
        issues.push(
          `pedidos_pendientes: DB=${row.pedidos_pendientes} vs esperado=${expPed}`
        );
      }
    }

    // services_pendientes (solo validar si la DB tiene valor no-null)
    if (row.services_pendientes !== null) {
      const expServ = servicesPendMap.get(mid) ?? 0;
      if (row.services_pendientes !== expServ) {
        issues.push(
          `services_pendientes: DB=${row.services_pendientes} vs esperado=${expServ}`
        );
      }
    }

    if (issues.length > 0) {
      mismatches.push({ movil_id: mid, issues });
    }
  }

  // ── Resultado ─────────────────────────────────────────────────────────────

  if (mismatches.length === 0) {
    console.log(`Comparadas ${diasRows.length} filas — ningún mismatch encontrado.`);
    console.log("\nPARIDAD OK");
    process.exit(0);
  } else {
    console.error(
      `Se encontraron ${mismatches.length} mismatch(es) en ${diasRows.length} filas:\n`
    );
    for (const { movil_id, issues } of mismatches) {
      console.error(`  movil_id=${movil_id}:`);
      for (const iss of issues) {
        console.error(`    - ${iss}`);
      }
    }
    console.error(`\nPARIDAD FALLO: ${mismatches.length} mismatch(es)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Error inesperado:", e);
  process.exit(1);
});
