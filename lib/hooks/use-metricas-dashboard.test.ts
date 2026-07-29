/**
 * Tests del contrato de headers de lib/hooks/use-metricas-dashboard.ts.
 *
 * B5 (bloqueante de la revisión final): el hook armaba los headers de
 * auth-scope con `x-track-isroot` / `x-track-empresas-ids` pero NUNCA con
 * `x-track-funcs`. Del otro lado, app/api/metricas/dashboard/route.ts corre
 * `requireFuncionalidad(request, 'Estadisticas Cumplimiento')`, que lee
 * exactamente ese header — así que todo caller no-root recibía 403 aunque
 * tuviera la funcionalidad asignada en SecuritySuite. La misma omisión
 * existía en components/metricas/demora-comparativa-logic.ts (cubierta en su
 * propio test); el patrón correcto está en app/dashboard/page.tsx:1213.
 *
 * Se testea la función pura `buildMetricasDashboardHeaders` en vez del hook:
 * vitest.config.ts usa environment 'node' (sin jsdom / @testing-library), el
 * mismo motivo por el que components/metricas/demora-comparativa-logic.ts
 * existe separado de su componente.
 */

import { describe, it, expect } from 'vitest';
import { buildMetricasDashboardHeaders } from './use-metricas-dashboard';

/** Nombre EXACTO que exige el gate de app/api/metricas/dashboard/route.ts. */
const FUNC = 'Estadisticas Cumplimiento';

describe('buildMetricasDashboardHeaders()', () => {
  it('no-root manda x-track-funcs (sin esto el endpoint devuelve 403)', () => {
    const h = buildMetricasDashboardHeaders({ isRoot: false, empresasIds: [70], funcionalidades: [FUNC] });
    expect(h['x-track-funcs']).toBe(FUNC);
  });

  it('no-root con empresas manda además su scope por header', () => {
    const h = buildMetricasDashboardHeaders({ isRoot: false, empresasIds: [70, 80], funcionalidades: [FUNC] });
    expect(h['x-track-empresas-ids']).toBe('70,80');
    expect(h['x-track-isroot']).toBeUndefined();
  });

  it('root manda x-track-isroot Y x-track-funcs (patrón de app/dashboard/page.tsx:1213)', () => {
    const h = buildMetricasDashboardHeaders({ isRoot: true, empresasIds: [], funcionalidades: [FUNC] });
    expect(h['x-track-isroot']).toBe('S');
    expect(h['x-track-funcs']).toBe(FUNC);
    expect(h['x-track-empresas-ids']).toBeUndefined();
  });

  it('varias funcionalidades viajan como CSV', () => {
    const h = buildMetricasDashboardHeaders({
      isRoot: false,
      empresasIds: [70],
      funcionalidades: ['Otra Cosa', FUNC],
    });
    expect(h['x-track-funcs']).toBe(`Otra Cosa,${FUNC}`);
  });

  it('descarta vacíos y espacios sobrantes (no genera comas huérfanas)', () => {
    const h = buildMetricasDashboardHeaders({
      isRoot: false,
      empresasIds: [70],
      funcionalidades: ['  ', ` ${FUNC} `, ''],
    });
    expect(h['x-track-funcs']).toBe(FUNC);
  });

  it('sin funcionalidades el header viaja vacío (el 403 del server es correcto ahí)', () => {
    const h = buildMetricasDashboardHeaders({ isRoot: false, empresasIds: [70], funcionalidades: [] });
    expect(h['x-track-funcs']).toBe('');
  });

  it('no-root sin empresas: fail-closed del server, pero el header de funcs viaja igual', () => {
    const h = buildMetricasDashboardHeaders({ isRoot: false, empresasIds: [], funcionalidades: [FUNC] });
    expect(h['x-track-empresas-ids']).toBeUndefined();
    expect(h['x-track-funcs']).toBe(FUNC);
  });
});
