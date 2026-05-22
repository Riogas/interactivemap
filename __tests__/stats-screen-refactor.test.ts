import { describe, test, expect } from 'vitest';
/**
 * Tests for stats screen refactor (runId: 20260522-114549-pup)
 *
 * Coverage:
 * 1. New card order: Atrasos pendientes → Por hora → Por estado (fila 1)
 *                   Top móviles → Por zona → Por empresa  (fila 2, lazy)
 * 2. atrasosEntregadosStats — 4 rangos + edge cases
 * 3. Lazy modal cards: buttons present, no auto-fetch
 */

// ─── Helpers to mimic the atrasosEntregadosStats useMemo ─────────────────────
// This is a pure function extracted from the component logic — tested in isolation
// so we don't need a React renderer.

interface MinimalPedido {
  estado_nro: number;
  sub_estado_nro?: number | null;
  pedido_hijo?: number | null;
  atraso_cump_mins?: number | null;
}

/**
 * isPedidoEntregado replica the production logic:
 * estado_nro === 2 AND sub_estado_nro IN (3, 19)
 */
function isPedidoEntregado(p: MinimalPedido): boolean {
  const estado = Number(p.estado_nro);
  if (estado !== 2) return false;
  const sub = p.sub_estado_nro != null ? Number(p.sub_estado_nro) : null;
  return sub === 3 || sub === 19;
}

function computeAtrasosEntregados(pedidos: MinimalPedido[]) {
  const entregados = pedidos.filter(p => isPedidoEntregado(p) && !p.pedido_hijo);
  let rango1a15 = 0, rango15a30 = 0, rango30a60 = 0, rango60mas = 0, sinDato = 0;
  entregados.forEach(p => {
    const min = p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
    if (min === null) { sinDato++; return; }
    if (min <= 0) { sinDato++; return; } // en hora o anticipado: sin atraso
    if (min <= 15) rango1a15++;
    else if (min <= 30) rango15a30++;
    else if (min <= 60) rango30a60++;
    else rango60mas++;
  });
  const total = entregados.length;
  const conAtraso = rango1a15 + rango15a30 + rango30a60 + rango60mas;
  return { total, rango1a15, rango15a30, rango30a60, rango60mas, sinDato, conAtraso };
}

// ─── Helper factories ─────────────────────────────────────────────────────────
function mkEntregado(atraso: number | null, hijo = false): MinimalPedido {
  return {
    estado_nro: 2,
    sub_estado_nro: 3,  // entregado
    pedido_hijo: hijo ? 1 : null,
    atraso_cump_mins: atraso,
  };
}
function mkNoEntregado(atraso: number | null): MinimalPedido {
  return {
    estado_nro: 2,
    sub_estado_nro: 4,  // no entregado (no es 3 ni 19)
    pedido_hijo: null,
    atraso_cump_mins: atraso,
  };
}
function mkPendiente(atraso: number | null): MinimalPedido {
  return {
    estado_nro: 1,
    sub_estado_nro: 5,
    pedido_hijo: null,
    atraso_cump_mins: atraso,
  };
}

// ─── 1. Card order — verified by checking the source JSX ─────────────────────
describe('Stats page — card order in JSX', () => {
  test('source file: Atrasos appears before Por hora in the grid section', () => {
    // Read the actual source to verify render order (deterministic for SSR)
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/dashboard/stats/page.tsx'),
      'utf8'
    );

    // Find the grid section (after the KPIs sections)
    const gridStart = src.indexOf('{/* ── Gráficos ── */}');
    expect(gridStart).toBeGreaterThan(0);

    const gridSection = src.substring(gridStart);

    const atrasosPos = gridSection.indexOf('title="Atrasos de pedidos pendientes"');
    const porHoraPos = gridSection.indexOf('title="Pedidos por hora"');
    const porEstadoPos = gridSection.indexOf('title="Pedidos por estado"');

    expect(atrasosPos).toBeGreaterThan(0);
    expect(porHoraPos).toBeGreaterThan(0);
    expect(porEstadoPos).toBeGreaterThan(0);

    // Row 1: Atrasos → Por hora → Por estado
    expect(atrasosPos).toBeLessThan(porHoraPos);
    expect(porHoraPos).toBeLessThan(porEstadoPos);
  });

  test('source file: Row 2 has Top móviles → Zona → Empresa (lazy buttons)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/dashboard/stats/page.tsx'),
      'utf8'
    );
    const gridStart = src.indexOf('{/* ── Gráficos ── */}');
    const gridSection = src.substring(gridStart);

    const btnMovilPos = gridSection.indexOf('Mostrar gráficos por móvil');
    const btnZonaPos = gridSection.indexOf('Mostrar gráficos por zona');
    const btnEmpresaPos = gridSection.indexOf('Mostrar gráficos por empresa');

    expect(btnMovilPos).toBeGreaterThan(0);
    expect(btnZonaPos).toBeGreaterThan(0);
    expect(btnEmpresaPos).toBeGreaterThan(0);

    // Row 2 order: móvil → zona → empresa
    expect(btnMovilPos).toBeLessThan(btnZonaPos);
    expect(btnZonaPos).toBeLessThan(btnEmpresaPos);
  });

  test('source file: entity cards show buttons, not auto-rendered StackedBarChart', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/dashboard/stats/page.tsx'),
      'utf8'
    );
    const gridStart = src.indexOf('{/* ── Gráficos ── */}');
    const gridSection = src.substring(gridStart);

    // The 3 entity cards should NOT have ExpandableCard wrappers (those render eagerly)
    // They should have modal state guards: {modalMoviles && ...}
    expect(gridSection).toContain('{modalMoviles && (');
    expect(gridSection).toContain('{modalZona && (');
    expect(gridSection).toContain('{modalEmpresa && (');

    // And the buttons to trigger them
    expect(gridSection).toContain("setModalMoviles(true)");
    expect(gridSection).toContain("setModalZona(true)");
    expect(gridSection).toContain("setModalEmpresa(true)");

    // Verify StackedBarChart for entity cards is INSIDE the modal guard (lazy)
    const movilBtnIdx = gridSection.indexOf('setModalMoviles(true)');
    const movilChartIdx = gridSection.indexOf('StackedBarChart data={movilesTop}');
    expect(movilBtnIdx).toBeGreaterThan(0);
    expect(movilChartIdx).toBeGreaterThan(movilBtnIdx); // chart is after button (inside modal)
  });
});

// ─── 2. atrasosEntregadosStats logic ─────────────────────────────────────────
describe('atrasosEntregadosStats — range logic', () => {
  test('normal distribution: one pedido per range', () => {
    const pedidos = [
      mkEntregado(5),   // 1-15
      mkEntregado(20),  // 15-30
      mkEntregado(45),  // 30-60
      mkEntregado(90),  // 60+
    ];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.rango1a15).toBe(1);
    expect(result.rango15a30).toBe(1);
    expect(result.rango30a60).toBe(1);
    expect(result.rango60mas).toBe(1);
    expect(result.sinDato).toBe(0);
    expect(result.conAtraso).toBe(4);
    expect(result.total).toBe(4);
  });

  test('edge: atraso_cump_mins = null → sinDato (not counted in ranges)', () => {
    const pedidos = [mkEntregado(null)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.sinDato).toBe(1);
    expect(result.conAtraso).toBe(0);
    expect(result.total).toBe(1);
  });

  test('edge: atraso_cump_mins = 0 → sinDato (en hora, no es atraso)', () => {
    const pedidos = [mkEntregado(0)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.sinDato).toBe(1);
    expect(result.conAtraso).toBe(0);
  });

  test('edge: atraso_cump_mins = 15 → rango1a15 (boundary inclusive)', () => {
    const pedidos = [mkEntregado(15)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.rango1a15).toBe(1);
    expect(result.rango15a30).toBe(0);
  });

  test('edge: atraso_cump_mins = 16 → rango15a30 (just above boundary)', () => {
    const pedidos = [mkEntregado(16)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.rango1a15).toBe(0);
    expect(result.rango15a30).toBe(1);
  });

  test('edge: atraso_cump_mins = 60 → rango30a60 (boundary inclusive)', () => {
    const pedidos = [mkEntregado(60)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.rango30a60).toBe(1);
    expect(result.rango60mas).toBe(0);
  });

  test('edge: atraso_cump_mins = 61 → rango60mas (just above boundary)', () => {
    const pedidos = [mkEntregado(61)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.rango30a60).toBe(0);
    expect(result.rango60mas).toBe(1);
  });

  test('edge: negative atraso (anticipado) → sinDato', () => {
    const pedidos = [mkEntregado(-5)];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.sinDato).toBe(1);
    expect(result.conAtraso).toBe(0);
  });

  test('only entregados count (sub_estado_nro 3 or 19)', () => {
    const pedidos = [
      mkEntregado(30),           // entregado sub=3 → cuenta
      { ...mkEntregado(30), sub_estado_nro: 19 },  // entregado sub=19 → cuenta
      mkNoEntregado(30),         // no entregado → no cuenta
      mkPendiente(30),           // pendiente → no cuenta
    ];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.total).toBe(2); // solo los 2 entregados
    expect(result.rango15a30).toBe(2);
  });

  test('pedido_hijo are excluded', () => {
    const pedidos = [
      mkEntregado(30, false),  // no hijo → cuenta
      mkEntregado(30, true),   // hijo → no cuenta
    ];
    const result = computeAtrasosEntregados(pedidos);
    expect(result.total).toBe(1);
    expect(result.rango15a30).toBe(1);
  });

  test('empty pedidos → all zeros', () => {
    const result = computeAtrasosEntregados([]);
    expect(result.total).toBe(0);
    expect(result.conAtraso).toBe(0);
    expect(result.sinDato).toBe(0);
  });
});

// ─── 3. Lazy modal: no fetch without click ───────────────────────────────────
describe('Lazy modal — no auto-compute of entity charts', () => {
  test('source file: movilesTop StackedBarChart is guarded by modalMoviles state', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/dashboard/stats/page.tsx'),
      'utf8'
    );

    // Verify that the StackedBarChart for movilesTop only appears inside {modalMoviles &&
    const modalGuardIdx = src.indexOf('{modalMoviles && (');
    const chartIdx = src.indexOf('StackedBarChart data={movilesTop}');

    expect(modalGuardIdx).toBeGreaterThan(0);
    expect(chartIdx).toBeGreaterThan(modalGuardIdx);

    // Also verify there is no ExpandableCard wrapping movilesTop outside the modal
    // (ExpandableCard renders its children eagerly)
    const gridStart = src.indexOf('{/* ── Gráficos ── */}');
    const gridSection = src.substring(gridStart);
    const expandableCardsInGrid = (gridSection.match(/ExpandableCard/g) || []).length;
    // Should only be 3 ExpandableCards: Atrasos, Por hora, Por estado
    // (the entity cards are plain <div> with modal guards)
    expect(expandableCardsInGrid).toBe(3 * 2); // each ExpandableCard appears as <ExpandableCard ... and </ExpandableCard>
  });

  test('source file: buttons for entity cards call setState only (no fetch)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/dashboard/stats/page.tsx'),
      'utf8'
    );

    // The onClick of each entity button should ONLY set modal state
    // Check pattern: onClick={() => setModalXxx(true)}
    const movilBtn = src.indexOf("onClick={() => setModalMoviles(true)}");
    const zonaBtn = src.indexOf("onClick={() => setModalZona(true)}");
    const empresaBtn = src.indexOf("onClick={() => setModalEmpresa(true)}");

    expect(movilBtn).toBeGreaterThan(0);
    expect(zonaBtn).toBeGreaterThan(0);
    expect(empresaBtn).toBeGreaterThan(0);

    // Verify initial state is false (no auto-open)
    expect(src).toContain('useState(false)');
    // The 3 modal states should default to false
    const falseStates = (src.match(/useState\(false\)/g) || []).length;
    expect(falseStates).toBeGreaterThanOrEqual(3);
  });
});
