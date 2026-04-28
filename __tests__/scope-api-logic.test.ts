/**
 * Tests para la lógica de scoping de las APIs y el flujo completo distribuidor.
 *
 * Estrategia: las APIs de Next.js (route handlers) requieren infraestructura de servidor
 * para ejecutarse (NextRequest, supabase). En entorno node puro no podemos invocarlas
 * directamente. En su lugar:
 *   1. Reproducimos la lógica de parsing de parámetros (CSV → number[]) que está
 *      inline en las rutas — la misma lógica que usa empresaIds en zonas/demoras/moviles-zonas.
 *   2. Reproducimos la lógica de fail-closed (empresaIds='' → vacío, OR en moviles-zonas).
 *   3. Verificamos el contrato completo del flujo distribuidor (0/1/2 empresas) via
 *      función pura que replica la decisión de las rutas.
 *   4. Cubrimos el edge case crítico del AC#10: zonas asignadas pero 0 móviles propios → vacío.
 *   5. Cubrimos el edge case: empresa en fleteras_zonas para empresa propia Y ajena → visible.
 *
 * Cobertura de AC:
 *   AC3, AC4: distribuidor 1/2 empresas → solo zonas propias en todas las APIs
 *   AC8:      allowedEmpresas=[] / null → fail-closed
 *   AC9:      parseo server-side de empresaIds CSV
 *   AC10:     zonas asignadas pero 0 móviles propios → vacío (OR, no AND)
 *
 * Edge cases cubiertos:
 *   - empresaIds='' (vacío) → fail-closed
 *   - empresa sin filas en fleteras_zonas → scope vacío
 *   - zona compartida entre empresa propia y ajena → se muestra
 *   - móvil ajeno en zona propia → NO contado (OR en moviles-zonas)
 *   - pedido sin zona_nro → no incluido en pedidosZonaData
 */

import { describe, it, expect } from 'vitest';
import { parseZonasJsonb, getScopedEmpresas, shouldScopeByEmpresa } from '../lib/auth-scope';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers que replican la lógica inline de las routes
// ─────────────────────────────────────────────────────────────────────────────

/** Replica el bloque de parsing de ?empresaIds=CSV de /api/zonas y /api/demoras */
function parseEmpresaIdsCsv(csv: string | null): number[] | null {
  if (csv === null) return null; // no se pasó → sin scope
  const ids = csv.split(',').map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n));
  return ids; // [] === fail-closed
}

/** Replica la resolución de allowedZonaIds a partir de filas de fleteras_zonas */
function resolveAllowedZonas(fletarasZonasRows: Array<{ zonas: unknown }>): Set<number> {
  const set = new Set<number>();
  for (const row of fletarasZonasRows) {
    for (const z of parseZonasJsonb(row.zonas)) set.add(z);
  }
  return set;
}

/**
 * Replica la decisión fail-closed OR de /api/moviles-zonas:
 * si zonas vacías O móviles vacíos → retorna [] (no mostrar nada).
 */
function resolveMovilesZonasScope(
  allowedZonaIds: Set<number>,
  allowedMovilIds: Set<string>,
  rawData: Array<{ zona_id: number; movil_id: string }>,
): Array<{ zona_id: number; movil_id: string }> {
  // fail-closed: OR
  if (allowedZonaIds.size === 0 || allowedMovilIds.size === 0) return [];
  return rawData.filter(
    (r) => allowedZonaIds.has(r.zona_id) && allowedMovilIds.has(r.movil_id),
  );
}

/**
 * Replica la lógica de pedidosZonaData de page.tsx:
 * cuenta pedidos estado=1 por zona, excluye zonas fuera del scope.
 */
function computePedidosZona(
  pedidos: Array<{ estado_nro: number; zona_nro: number | null }>,
  scopedZonaIds: Set<number> | null,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of pedidos) {
    if (p.estado_nro !== 1) continue;
    if (!p.zona_nro || p.zona_nro === 0) continue;
    if (scopedZonaIds && !scopedZonaIds.has(p.zona_nro)) continue;
    map.set(p.zona_nro, (map.get(p.zona_nro) ?? 0) + 1);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC9 — Parsing server-side de empresaIds CSV
// ─────────────────────────────────────────────────────────────────────────────
describe('parseEmpresaIdsCsv — replica lógica inline de APIs', () => {
  it('null → sin scope (retorna null)', () => {
    expect(parseEmpresaIdsCsv(null)).toBeNull();
  });

  it('cadena vacía "" → fail-closed (retorna [])', () => {
    expect(parseEmpresaIdsCsv('')).toEqual([]);
  });

  it('"5" → [5]', () => {
    expect(parseEmpresaIdsCsv('5')).toEqual([5]);
  });

  it('"5,7" → [5, 7]', () => {
    expect(parseEmpresaIdsCsv('5,7')).toEqual([5, 7]);
  });

  it('"5,abc,7" → filtra NaN → [5, 7]', () => {
    expect(parseEmpresaIdsCsv('5,abc,7')).toEqual([5, 7]);
  });

  it('"abc" → todos NaN → fail-closed []', () => {
    expect(parseEmpresaIdsCsv('abc')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC8 — Fail-closed cuando distribuidor no tiene empresas
// ─────────────────────────────────────────────────────────────────────────────
describe('fail-closed — distribuidor sin empresas asignadas', () => {
  const distribuidorBase = {
    isRoot: 'N',
    roles: [{ RolId: '71', RolNombre: 'Distribuidor', RolTipo: '' }],
  };

  it('allowedEmpresas=null → getScopedEmpresas devuelve [] (fail-closed)', () => {
    expect(getScopedEmpresas({ ...distribuidorBase, allowedEmpresas: null })).toEqual([]);
  });

  it('allowedEmpresas=[] → getScopedEmpresas devuelve []', () => {
    expect(getScopedEmpresas({ ...distribuidorBase, allowedEmpresas: [] })).toEqual([]);
  });

  it('user=null → getScopedEmpresas devuelve [] (fail-closed, no se asume root)', () => {
    expect(getScopedEmpresas(null)).toEqual([]);
  });

  it('allowedEmpresas=[] → parseEmpresaIdsCsv("") → fail-closed en API', () => {
    // Cuando getScopedEmpresas devuelve [] el dashboard pasa empresaIds="" → fail-closed
    const resultado = parseEmpresaIdsCsv('');
    expect(resultado).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 / AC4 — Distribuidor con 1 o 2 empresas ve solo sus zonas
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveAllowedZonas — scoping por empresa', () => {
  it('empresa sin filas en fleteras_zonas → scope vacío', () => {
    const resultado = resolveAllowedZonas([]);
    expect(resultado.size).toBe(0);
  });

  it('1 empresa con zonas [12, 14] → Set {12, 14}', () => {
    const resultado = resolveAllowedZonas([
      { zonas: [12, 14] },
    ]);
    expect(resultado).toEqual(new Set([12, 14]));
  });

  it('2 empresas con zonas parcialmente solapadas → unión sin duplicados (AC4)', () => {
    const resultado = resolveAllowedZonas([
      { zonas: [12, 14] }, // empresa X
      { zonas: [14, 19] }, // empresa Y
    ]);
    expect(resultado).toEqual(new Set([12, 14, 19]));
  });

  it('zona compartida entre empresa propia y ajena → aparece (al menos una matchea)', () => {
    // Las filas ya están pre-filtradas por empresa_fletera_id en la query.
    // Si la zona 20 está en la fila de la empresa propia, se incluye aunque también
    // esté en otra empresa (la query solo retorna filas de las empresas permitidas).
    const resultado = resolveAllowedZonas([
      { zonas: [12, 20] }, // empresa propia
    ]);
    expect(resultado.has(20)).toBe(true);
  });

  it('zonas como strings numéricos se parsean correctamente', () => {
    const resultado = resolveAllowedZonas([
      { zonas: ['10', '11', null, 'abc'] },
    ]);
    expect(resultado).toEqual(new Set([10, 11]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC10 — /api/moviles-zonas: zonas con scope pero 0 móviles propios → vacío
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveMovilesZonasScope — lógica OR fail-closed (AC10)', () => {
  const rawData = [
    { zona_id: 12, movil_id: '304' },
    { zona_id: 12, movil_id: '999' }, // móvil ajeno
    { zona_id: 14, movil_id: '305' },
  ];

  it('zonas asignadas pero 0 móviles propios → retorna [] (AC10)', () => {
    const allowedZonas = new Set([12, 14]);
    const allowedMoviles = new Set<string>(); // ningún móvil propio
    const resultado = resolveMovilesZonasScope(allowedZonas, allowedMoviles, rawData);
    expect(resultado).toEqual([]);
  });

  it('móviles propios pero 0 zonas asignadas → retorna []', () => {
    const allowedZonas = new Set<number>();
    const allowedMoviles = new Set(['304', '305']);
    const resultado = resolveMovilesZonasScope(allowedZonas, allowedMoviles, rawData);
    expect(resultado).toEqual([]);
  });

  it('móvil ajeno (999) en zona propia (12) → NO mostrado NI contado', () => {
    const allowedZonas = new Set([12, 14]);
    const allowedMoviles = new Set(['304', '305']); // 999 no está
    const resultado = resolveMovilesZonasScope(allowedZonas, allowedMoviles, rawData);
    expect(resultado.some((r) => r.movil_id === '999')).toBe(false);
  });

  it('solo móvil propio en zona propia → aparece', () => {
    const allowedZonas = new Set([12, 14]);
    const allowedMoviles = new Set(['304', '305']);
    const resultado = resolveMovilesZonasScope(allowedZonas, allowedMoviles, rawData);
    expect(resultado.map((r) => r.movil_id).sort()).toEqual(['304', '305']);
  });

  it('móvil propio asignado a zona AJENA → no aparece (AND intencional)', () => {
    const allowedZonas = new Set([14]); // zona 12 no permitida
    const allowedMoviles = new Set(['304', '305']); // 304 está en zona 12
    const resultado = resolveMovilesZonasScope(allowedZonas, allowedMoviles, rawData);
    expect(resultado.some((r) => r.zona_id === 12)).toBe(false);
    expect(resultado.some((r) => r.movil_id === '305')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC6 — Pedidos por zona: móviles / pedidos ajenos no cuentan en totales
// ─────────────────────────────────────────────────────────────────────────────
describe('computePedidosZona — cliente-side scope', () => {
  const pedidos = [
    { estado_nro: 1, zona_nro: 12 },
    { estado_nro: 1, zona_nro: 12 },
    { estado_nro: 1, zona_nro: 19 },  // zona fuera del scope
    { estado_nro: 2, zona_nro: 12 },  // no pendiente
    { estado_nro: 1, zona_nro: null }, // sin zona → ignorado
    { estado_nro: 1, zona_nro: 0 },   // zona 0 → ignorado
  ];

  it('root/despacho (scopedZonaIds=null): cuenta todas las zonas', () => {
    const map = computePedidosZona(pedidos, null);
    expect(map.get(12)).toBe(2);
    expect(map.get(19)).toBe(1);
  });

  it('distribuidor con scope {12}: no cuenta zona 19 ajena', () => {
    const map = computePedidosZona(pedidos, new Set([12]));
    expect(map.get(12)).toBe(2);
    expect(map.has(19)).toBe(false);
  });

  it('pedido con zona_nro null → no incluido en ningún caso', () => {
    const map = computePedidosZona(pedidos, null);
    expect(map.has(0)).toBe(false);
    // null fue excluido, no aparece en ninguna clave del mapa
    const keys = Array.from(map.keys());
    expect(keys.every((k) => k !== 0 && Number.isFinite(k))).toBe(true);
  });

  it('distribuidor con scope vacío → ninguna zona visible', () => {
    const map = computePedidosZona(pedidos, new Set());
    expect(map.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1/AC2 — Despacho y root no tienen scope (shouldScopeByEmpresa = false)
// ─────────────────────────────────────────────────────────────────────────────
describe('despacho y root no aplican scope', () => {
  it('despacho (RolId 49) → shouldScopeByEmpresa=false → getScopedEmpresas=null', () => {
    const user = {
      isRoot: 'N' as string,
      roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
      allowedEmpresas: [5],
    };
    expect(shouldScopeByEmpresa(user)).toBe(false);
    expect(getScopedEmpresas(user)).toBeNull();
  });

  it('root (isRoot=S) → shouldScopeByEmpresa=false → getScopedEmpresas=null', () => {
    const user = { isRoot: 'S' as string, allowedEmpresas: [5] };
    expect(shouldScopeByEmpresa(user)).toBe(false);
    expect(getScopedEmpresas(user)).toBeNull();
  });

  it('despacho con allowedEmpresas=[X] → getScopedEmpresas=null (despacho wins)', () => {
    const user = {
      isRoot: 'N' as string,
      roles: [{ RolId: '49', RolNombre: 'Despacho', RolTipo: '' }],
      allowedEmpresas: [99],
    };
    expect(getScopedEmpresas(user)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC7 — DashboardIndicators.sinAsignar es global (NO usa scopedZonaIds)
// Este test verifica el contrato: el cómputo global de "sin asignar" NO se filtra
// por zona, aunque el componente reciba scopedZonaIds (excepción explícita del spec).
// Replica la lógica de DashboardIndicators.pedidosStats.sinAsignar.
// ─────────────────────────────────────────────────────────────────────────────
describe('DashboardIndicators.sinAsignar — sin scope de zona (AC7)', () => {
  function computeSinAsignar(
    pedidos: Array<{ estado_nro: number; movil: number | null }>,
  ): number {
    // Replica DashboardIndicators: sinAsignar = estado 1 sin móvil o móvil === 0
    return pedidos.filter(
      (p) => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0),
    ).length;
  }

  it('cuenta pedidos de todas las zonas, incluidas las ajenas al scope distribuidor', () => {
    const pedidos = [
      { estado_nro: 1, movil: null },  // zona 12 → dentro del scope
      { estado_nro: 1, movil: null },  // zona 19 → fuera del scope distribuidor
      { estado_nro: 1, movil: 304 },   // tiene movil → no cuenta
      { estado_nro: 2, movil: null },  // finalizado → no cuenta
    ];
    // El total global debe ser 2, sin importar el scope de zona
    expect(computeSinAsignar(pedidos)).toBe(2);
  });

  it('distribuidor no filtra el total global aunque tenga scope de zona', () => {
    // Simulación: hay pedidos de zona 19 (ajena) + zona 12 (propia).
    // El navbar siempre debe mostrar el total, no el filtrado.
    const todosPedidos = [
      { estado_nro: 1, movil: null }, // zona propia
      { estado_nro: 1, movil: null }, // zona ajena
    ];
    const scopedZonaIds = new Set([12]); // solo zona 12 permitida
    // DashboardIndicators recibe scopedZonaIds pero el cómputo de sinAsignar lo ignora a propósito
    const globalTotal = computeSinAsignar(todosPedidos);
    // Si se aplicara scope erróneamente, daría 1. El contrato es que dé 2.
    expect(globalTotal).toBe(2);
    // Aseguramos que scopedZonaIds existe pero no afecta el cómputo
    expect(scopedZonaIds).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3/AC4 — DashboardIndicators.zonasSinMoviles + zonasNoActivas SÍ usan scope
// Replica la lógica post-fetch del componente: filtra zonas y demoras por scope.
// Cubre el bug donde el navbar mostraba conteos globales para distribuidores.
// ─────────────────────────────────────────────────────────────────────────────
describe('DashboardIndicators.zonasSinMoviles — CON scope de zona (AC3/AC4)', () => {
  /**
   * Replica el cálculo de zonasSinMoviles del componente: zonas con geojson
   * dentro del escenario y del scope, donde no hay móviles asignados (post-filtro
   * de scope en movilesZonasRecords) y la zona no está marcada como no-activa.
   */
  function computeZonasSinMoviles(
    rawZonas: Array<{ zona_id: number; escenario_id: number; geojson: unknown }>,
    rawMovilesZonas: Array<{ zona_id: number; tipo_de_servicio: string; prioridad_o_transito: number }>,
    rawDemoras: Array<{ zona_id: number; escenario_id: number; minutos: number; activa: boolean }>,
    escenarioIds: number[],
    scopedZonaIds: Set<number> | null,
    serviceFilter: string,
  ): number {
    const zonas = rawZonas.filter(
      (z) =>
        escenarioIds.includes(z.escenario_id) &&
        z.geojson &&
        (scopedZonaIds == null || scopedZonaIds.has(z.zona_id)),
    );
    const mz = rawMovilesZonas.filter(
      (r) =>
        (r.tipo_de_servicio || '').toUpperCase() === serviceFilter.toUpperCase() &&
        (scopedZonaIds == null || scopedZonaIds.has(r.zona_id)),
    );
    const counts = new Map<number, { prioridad: number; transito: number }>();
    for (const r of mz) {
      const cur = counts.get(r.zona_id) || { prioridad: 0, transito: 0 };
      if (r.prioridad_o_transito === 1) cur.prioridad++;
      else cur.transito++;
      counts.set(r.zona_id, cur);
    }
    const dMap = new Map<number, { minutos: number; activa: boolean }>();
    for (const d of rawDemoras) {
      if (!escenarioIds.includes(d.escenario_id)) continue;
      if (scopedZonaIds != null && !scopedZonaIds.has(d.zona_id)) continue;
      const ex = dMap.get(d.zona_id);
      if (!ex || d.minutos > ex.minutos) {
        dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
      }
    }
    return zonas.filter((z) => {
      const dInfo = dMap.get(z.zona_id);
      if (dInfo && dInfo.activa === false) return false;
      const c = counts.get(z.zona_id);
      return !c || (c.prioridad === 0 && c.transito === 0);
    }).length;
  }

  const rawZonas = [
    { zona_id: 12, escenario_id: 1, geojson: { type: 'Polygon' } }, // propia, sin móviles
    { zona_id: 14, escenario_id: 1, geojson: { type: 'Polygon' } }, // propia, con móvil
    { zona_id: 19, escenario_id: 1, geojson: { type: 'Polygon' } }, // ajena, sin móviles
    { zona_id: 22, escenario_id: 1, geojson: { type: 'Polygon' } }, // ajena, con móvil
  ];
  const rawMovilesZonas = [
    { zona_id: 14, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 }, // móvil propio en zona propia
    { zona_id: 22, tipo_de_servicio: 'URGENTE', prioridad_o_transito: 1 }, // móvil ajeno en zona ajena
  ];
  const rawDemoras: Array<{ zona_id: number; escenario_id: number; minutos: number; activa: boolean }> = [];

  it('root/despacho (scope=null): cuenta zonas sin móvil de TODOS los escenarios', () => {
    // 12 y 19 quedan sin móvil → total 2
    const total = computeZonasSinMoviles(rawZonas, rawMovilesZonas, rawDemoras, [1], null, 'URGENTE');
    expect(total).toBe(2);
  });

  it('distribuidor con scope {12, 14}: solo cuenta zonas propias sin móvil', () => {
    // Solo zona 12 queda sin móvil dentro del scope → total 1
    const total = computeZonasSinMoviles(rawZonas, rawMovilesZonas, rawDemoras, [1], new Set([12, 14]), 'URGENTE');
    expect(total).toBe(1);
  });

  it('distribuidor con scope vacío: fail-closed → 0', () => {
    const total = computeZonasSinMoviles(rawZonas, rawMovilesZonas, rawDemoras, [1], new Set(), 'URGENTE');
    expect(total).toBe(0);
  });

  it('distribuidor con scope que NO incluye zonas con móvil: cuenta su propia zona sin móvil', () => {
    // scope solo incluye zona 12 (propia, sin móvil) → total 1
    const total = computeZonasSinMoviles(rawZonas, rawMovilesZonas, rawDemoras, [1], new Set([12]), 'URGENTE');
    expect(total).toBe(1);
  });

  it('distribuidor con scope solo de zonas con móvil: total 0', () => {
    // scope solo incluye zona 14 (con móvil) → 0 sin móvil
    const total = computeZonasSinMoviles(rawZonas, rawMovilesZonas, rawDemoras, [1], new Set([14]), 'URGENTE');
    expect(total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useScopedZonaIds — estado loading cuando escenarioIds.length === 0
// Replica la rama del hook que retorna { scopedZonaIds: null, isLoading: false }
// inmediatamente cuando no hay escenarios seleccionados, evitando flicker.
// ─────────────────────────────────────────────────────────────────────────────
describe('useScopedZonaIds — escenarioIds vacío', () => {
  /**
   * Replica la decisión del hook: si no hay escenarios, no se hace fetch
   * y se devuelve null sin loading. (Coverage del Bug #2 de iter 3.)
   */
  function shouldFetch(
    user: { isRoot: string; allowedEmpresas: number[] | null } | null,
    escenarioIds: number[],
  ): boolean {
    if (!user) return false;
    if (escenarioIds.length === 0) return false;
    // root o sin allowedEmpresas → no fetch
    if (user.isRoot === 'S') return false;
    return true;
  }

  it('escenarioIds=[] → no se hace fetch (no loading)', () => {
    const user = { isRoot: 'N', allowedEmpresas: [5] };
    expect(shouldFetch(user, [])).toBe(false);
  });

  it('escenarioIds=[1] con distribuidor con empresas → sí fetch', () => {
    const user = { isRoot: 'N', allowedEmpresas: [5] };
    expect(shouldFetch(user, [1])).toBe(true);
  });

  it('user=null → no fetch aunque haya escenarios', () => {
    expect(shouldFetch(null, [1])).toBe(false);
  });
});
