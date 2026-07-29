/**
 * Lógica pura de components/metricas/DemoraComparativa.tsx, extraída para
 * poder testearse sin infraestructura de render de componentes (el repo no
 * tiene jsdom/@testing-library/react, vitest.config.ts usa environment:
 * 'node') — mismo patrón que lib/scope-filter.ts y
 * components/metricas/metricas-theme.ts (ver __tests__/metricas-dashboard-
 * theme.test.ts).
 */

import type { TipoDemora } from '@/types/demoras-comparativa';

/**
 * True si un caller no-root no tiene NINGUNA empresa en su scope.
 *
 * Fix round 1 (Important): antes de esto, la card no distinguía "el motor
 * no corrió" de "no tenés zonas asignadas" — las dos caían en el mismo
 * mensaje ("Todavía no hay corridas del motor para hoy."), porque el
 * endpoint devuelve 200 con arrays vacíos en ambos casos (fail-closed).
 * Acá el resultado (EMPTY_DATA) ya se sabe de antemano sin llamar al
 * endpoint: root nunca está "sin alcance" (ve todo).
 */
export function sinAlcanceNoRoot(isRoot: boolean, empresasIds: number[]): boolean {
  return !isRoot && empresasIds.length === 0;
}

/**
 * Mensaje mostrado cuando `sinAlcanceNoRoot` es true. Constante exportada
 * (en vez de un literal inline en el componente) para que el test pueda
 * verificar el texto exacto sin renderizar JSX — única fuente de verdad,
 * sin riesgo de que el texto probado y el texto mostrado diverjan. Hablado
 * desde el lado del usuario, no del sistema: nada de "fail-closed"/"scope
 * vacío" en pantalla.
 */
export const MENSAJE_SIN_ALCANCE = 'No tenés zonas asignadas para ver esta comparativa. Consultá con el administrador.';

/** Estado transitorio: hay scope y config, pero el motor todavía no escribió hoy. */
export const MENSAJE_SIN_CORRIDAS = 'Todavía no hay corridas del motor para hoy.';

/**
 * B3 — estado PERMANENTE, no transitorio: el motor tiene el escenario 1000
 * hardcodeado (`v_esc integer := 1000` en `demoras_calcular_run`) y el seed de
 * `demoras_config` siembra solo ese escenario, pero la pantalla tiene selector
 * de escenario. Con cualquier otro no va a haber corridas NUNCA — decir
 * "todavía no hay corridas para hoy" invita a esperar algo que no va a pasar.
 */
export const MENSAJE_ESCENARIO_NO_CONFIGURADO =
  'El motor de demora no está configurado para este escenario.';

/**
 * Mensaje del estado vacío de la card. Separa la condición permanente (el
 * escenario no tiene configuración) de la transitoria (el motor todavía no
 * corrió hoy).
 */
export function mensajeSinDatos(escenarioConfigurado: boolean): string {
  return escenarioConfigurado ? MENSAJE_SIN_CORRIDAS : MENSAJE_ESCENARIO_NO_CONFIGURADO;
}

/**
 * Intención de fetch a /api/demoras/comparativa: o se saltea la llamada
 * (`skip: true`, sin construir URL ni headers), o trae la URL + headers
 * listos para pasarle a `fetch()`.
 */
export type ComparativaFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

/**
 * Arma el pedido a /api/demoras/comparativa, o decide no pedir nada.
 * `skip=true` cuando no hay escenario elegido, o cuando un no-root no tiene
 * empresas en su scope (`sinAlcanceNoRoot`) — en ambos casos el componente
 * no debe tocar la red.
 */
export function buildComparativaFetch(params: {
  escenario: number | null;
  tipo: TipoDemora;
  zona: number | null;
  isRoot: boolean;
  empresasIds: number[];
  /**
   * Nombres de funcionalidades de los roles del caller. Viajan en
   * `x-track-funcs` — sin esto NINGÚN no-root pasaba el gate
   * `requireFuncionalidad(request, 'Estadisticas Cumplimiento')` del endpoint
   * y la card devolvía 403 para todos salvo root (B5).
   */
  funcionalidades: string[];
}): ComparativaFetchIntent {
  const { escenario, tipo, zona, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (sinAlcanceNoRoot(isRoot, empresasIds)) return { skip: true };

  const sp = new URLSearchParams({ escenario: String(escenario), tipo });
  if (zona != null) sp.set('zona', String(zona));

  // x-track-funcs SIEMPRE (también para root, que igual bypassea el gate):
  // mismo patrón que app/dashboard/page.tsx:1213 y
  // lib/hooks/use-zona-capacidad-snapshot.ts. El endpoint corre
  // requireFuncionalidad('Estadisticas Cumplimiento') ANTES de resolver
  // scope, así que sin este header un no-root con la funcionalidad asignada
  // recibía 403 igual.
  //
  // Root se anuncia además con x-track-isroot (igual que
  // metricas/dashboard); no-root manda su scope como query param
  // `empresaIds` (CSV) — /api/demoras/comparativa sigue el mismo patron que
  // app/api/demoras y app/api/zonas, NO el de
  // lib/hooks/use-metricas-dashboard.ts, que usa un header. A esta altura
  // sinAlcanceNoRoot ya garantiza empresasIds.length > 0 para el caso
  // no-root (si estuviera vacío, ya volvimos arriba con skip:true).
  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades
      .map((f) => String(f).trim())
      .filter((f) => f.length > 0)
      .join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    sp.set('empresaIds', empresasIds.join(','));
  }

  return { skip: false, url: `/api/demoras/comparativa?${sp.toString()}`, headers };
}
