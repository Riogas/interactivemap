/**
 * Lógica pura de components/metricas/DemoraComparativa.tsx, extraída para
 * poder testearse sin infraestructura de render de componentes (el repo no
 * tiene jsdom/@testing-library/react, vitest.config.ts usa environment:
 * 'node') — mismo patrón que lib/scope-filter.ts y
 * components/metricas/metricas-theme.ts (ver __tests__/metricas-dashboard-
 * theme.test.ts).
 */

import type { TipoDemora, RitmoOrigen, UltimaCorridaZona } from '@/types/demoras-comparativa';
import { formatMin, formatCount } from './metricas-theme';

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

// ─── Desglose por zona: la última corrida traducida a lenguaje llano ────────
// (docs/DEMORA_MODELO_TRAMOS.md — la card tiene que poder contestar "¿por qué
// esta zona informa esto?" sin que el lector conozca el modelo.)

/**
 * De qué nivel de la cascada salió el ritmo, dicho para humanos. GLOBAL y
 * DEFECTO son los dos niveles "sin historia propia" — el número que producen
 * es el menos confiable y el texto lo dice.
 */
export const RITMO_ORIGEN_LABEL: Record<RitmoOrigen, string> = {
  CHOFER: 'historia del chofer',
  MOVIL: 'historia del móvil',
  ZONA: 'historia de la zona',
  GLOBAL: 'promedio global — la zona no tiene historia propia',
  DEFECTO: 'valor por defecto — sin ninguna estadística',
};

/**
 * Capacidad (pedidos por minuto, μ = dedicación/ritmo sumada por móvil) dicha
 * al revés, que es como la piensa cualquiera: "1 pedido cada ~N min". El
 * número crudo (0,0166) no le dice nada a nadie; su inverso (60) sí.
 */
export function capacidadHumana(cap: number | null): string {
  if (cap === null || Number.isNaN(cap)) return '—';
  if (cap <= 0) return 'nadie disponible';
  const min = 1 / cap;
  if (min < 1.5) return 'más de 1 pedido por minuto';
  // toLocaleString: hay capacidades reales ínfimas (0,000414 en la zona 8 el
  // 2026-08-03) que dan miles de minutos — "2.415" se lee, "2415" no tanto.
  return `1 pedido cada ~${Math.round(min).toLocaleString('es-UY')} min`;
}

/**
 * Hora local Montevideo "HH:MM" de un ISO. `hourCycle: 'h23'` explícito: el
 * default de es-UY difiere entre ICUs (el de Node agrega "a. m.") y acá se
 * quiere siempre reloj de 24.
 */
export function horaMontevideo(iso: string): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

/**
 * Marcas cortas para el tooltip del gráfico (zona elegida): por qué ese punto
 * no es un resultado "limpio" del modelo. Vacío = punto sin nada que aclarar.
 */
export function sufijosPunto(p: {
  sin_capacidad: boolean;
  clampeado: 'MIN' | 'MAX' | null;
  ritmo_origen: RitmoOrigen | null;
}): string[] {
  const out: string[] = [];
  if (p.sin_capacidad) out.push('sin móviles');
  else if (p.clampeado === 'MAX') out.push('techo');
  else if (p.clampeado === 'MIN') out.push('mínimo');
  if (p.ritmo_origen === 'GLOBAL') out.push('ritmo global');
  if (p.ritmo_origen === 'DEFECTO') out.push('ritmo por defecto');
  return out;
}

/** Vista ya redactada del desglose: la card solo la pinta. */
export interface DetalleUltima {
  /** "Última corrida HH:MM — informó N min". */
  titulo: string;
  /** Pares dato→valor formateados, en orden de lectura. Se omite lo que falta. */
  items: { label: string; value: string }[];
  /** Aclaraciones en lenguaje llano (techo, mínimo, suavizado, sin auditoría). */
  notas: string[];
}

/**
 * Redacta el "porqué" de la última corrida de una zona. Toda la lógica de
 * qué decir (y qué callar cuando el dato no existe) vive acá para poder
 * testearse; el componente no decide nada.
 */
export function detalleUltimaCorrida(u: UltimaCorridaZona): DetalleUltima {
  const items: DetalleUltima['items'] = [];
  const notas: string[] = [];

  if (u.demora_cruda !== null) {
    items.push({ label: 'Resultado del modelo', value: `${formatMin(u.demora_cruda)} min` });
  }
  if (u.as400 !== null) {
    items.push({ label: 'AS400 en ese momento', value: `${formatMin(u.as400)} min` });
  }
  if (u.cola_por_delante !== null) {
    items.push({ label: 'Pedidos por delante', value: formatCount(u.cola_por_delante) });
  }
  if (u.moviles_considerados !== null) {
    items.push({ label: 'Móviles que aportan', value: formatCount(u.moviles_considerados) });
  }

  // Capacidad: constante si la simulación resolvió todo en un tramo; si
  // recorrió escalones, se cuenta el arranque, el final y cuántos fueron.
  // Capacidad inicial 0 = la zona arrancó sin nadie y un móvil se sumó
  // después ("arrancó sin nadie disponible", no "arrancó en nadie...").
  if (u.capacidad_inicial !== null && u.capacidad_final !== null && u.tramos !== null) {
    const arranque =
      u.capacidad_inicial <= 0
        ? 'arrancó sin nadie disponible'
        : `arrancó en ${capacidadHumana(u.capacidad_inicial)}`;
    items.push({
      label: 'Capacidad',
      value:
        u.tramos <= 1
          ? `${capacidadHumana(u.capacidad_inicial)} (constante)`
          : `${arranque} y terminó en ${capacidadHumana(u.capacidad_final)}, en ${u.tramos} escalones`,
    });
  }

  if (u.ritmo_usado !== null && u.ritmo_origen !== null) {
    const muestras = u.ritmo_muestras !== null ? ` (${formatCount(u.ritmo_muestras)} muestras)` : '';
    // Fallback al valor crudo: si el backend agrega un origen nuevo al CHECK
    // antes de que el front lo conozca, mejor "NUEVO_ORIGEN" que "undefined".
    const origen = (RITMO_ORIGEN_LABEL as Record<string, string>)[u.ritmo_origen] ?? u.ritmo_origen;
    items.push({
      label: 'Ritmo',
      value: `${formatMin(u.ritmo_usado)} min por pedido · ${origen}${muestras}`,
    });
  }

  // El pipeline real es crudo → clamp → suavizado → redondeo (demoras_acabado):
  // `suavizado_aplicado` se marca TANTO en subas capadas (suben hasta
  // subida_max por corrida) COMO en bajas capadas (bajan hasta bajada_max) —
  // nunca afirmar una dirección fija. Y con suavizado encima, lo publicado
  // puede NO coincidir con el techo/mínimo del clamp: las notas se combinan
  // en una sola para no contradecirse entre sí (ni con el título).
  if (u.sin_capacidad) {
    // El suavizado corre igual con sin_capacidad (demoras_acabado no tiene
    // bypass por default): si la zona venía publicando poco y perdió su
    // último móvil, la SUBA al techo también se capa — "se informó el techo"
    // sería falso hasta que la escalera llegue.
    notas.push(
      u.suavizado_aplicado
        ? 'No había ningún móvil activo en la zona: corresponde el techo por definición, no por cálculo — pero el publicado se mueve de a pasos limitados por corrida (suavizado) y puede no haber llegado al techo todavía.'
        : 'No había ningún móvil activo en la zona: se informó el techo por definición, no por cálculo.',
    );
  } else if (u.suavizado_aplicado) {
    if (u.clampeado === 'MAX') {
      notas.push(
        u.demora_cruda !== null
          ? `El modelo dio ${formatMin(u.demora_cruda)} min, por encima del máximo publicable, y además el publicado se mueve de a pasos limitados por corrida (suavizado): lo informado puede no coincidir ni con el modelo ni con el techo.`
          : 'El resultado superó el máximo publicable y además el publicado se mueve de a pasos limitados por corrida (suavizado).',
      );
    } else if (u.clampeado === 'MIN') {
      notas.push(
        u.demora_cruda !== null
          ? `El modelo dio ${formatMin(u.demora_cruda)} min, por debajo del mínimo publicable, y además el publicado se mueve de a pasos limitados por corrida (suavizado): lo informado puede no coincidir ni con el modelo ni con el mínimo.`
          : 'El resultado quedó por debajo del mínimo publicable y además el publicado se mueve de a pasos limitados por corrida (suavizado).',
      );
    } else if (u.demora_cruda !== null && u.demora_cruda > u.demora_informada) {
      // Sin clamp, el objetivo del suavizado es el propio crudo: la dirección
      // se deriva comparando, no se asume.
      notas.push(
        `El modelo pedía ${formatMin(u.demora_cruda)} min pero el publicado sube de a pasos limitados por corrida (suavizado): todavía está alcanzándolo.`,
      );
    } else if (u.demora_cruda !== null && u.demora_cruda < u.demora_informada) {
      notas.push(
        `El modelo ya da ${formatMin(u.demora_cruda)} min pero el publicado baja de a pasos limitados por corrida (suavizado): todavía viene bajando.`,
      );
    } else {
      notas.push('El publicado se mueve de a pasos limitados por corrida (suavizado).');
    }
  } else if (u.clampeado === 'MAX') {
    notas.push(
      u.demora_cruda !== null
        ? `El modelo dio ${formatMin(u.demora_cruda)} min, por encima del máximo publicable: se informó el techo.`
        : 'El resultado superó el máximo publicable: se informó el techo.',
    );
  } else if (u.clampeado === 'MIN') {
    notas.push(
      u.demora_cruda !== null
        ? `El modelo dio ${formatMin(u.demora_cruda)} min, por debajo del mínimo publicable: se informó el mínimo.`
        : 'El resultado quedó por debajo del mínimo publicable: se informó el mínimo.',
    );
  }

  // Corridas del modelo viejo (o de CAPACIDAD_PROMEDIO): sin auditoría de
  // tramos no hay desglose que inventar, y se dice.
  if (u.tramos === null && u.capacidad_inicial === null && !u.sin_capacidad) {
    notas.push('Esta corrida no tiene el detalle del modelo por tramos (es anterior a la migración).');
  }

  return {
    titulo: `Última corrida ${horaMontevideo(u.corrida_at)} — informó ${formatMin(u.demora_informada)} min`,
    items,
    notas,
  };
}
