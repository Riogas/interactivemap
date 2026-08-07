/**
 * Lógica pura de components/metricas/VariantesLabCard.tsx — mismo patrón
 * que zona-corrida-logic.ts (vitest environment: 'node').
 *
 * Acá vive la DISCIPLINA ANTI-RUIDO del laboratorio: con 13 variantes
 * compitiendo, "la mejor del día" suele ganar por suerte (comparaciones
 * múltiples). Una variante solo se declara PROMOVIBLE si le ganó al
 * motor en la mayoría de los días evaluados Y por un margen acumulado
 * real — nunca por el porcentaje de un día suelto.
 */

import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { LabJob, MotorScore, VarianteKnobs, VarianteScore } from '@/types/metricas-variantes';

export type VariantesFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

/** Regla de promoción (documentada también en la página de documentación). */
export const PROMO_MIN_DIAS_EVALUADOS = 7;
export const PROMO_MIN_DIAS_GANADOS = 5;
export const PROMO_MARGEN_PTS = 1.5;

export const TOLERANCIAS = [10, 15, 25] as const;
export const RANGOS_DIAS = [7, 14, 30] as const;

/**
 * Umbral del control de sanidad "espejo": la variante Campeón replica al
 * motor, así que su coincidencia debería ser total. No se exige 100%
 * porque el día en que se activa el laboratorio (o tras un hueco del
 * job) la escalera propia de cada variante arranca sin historia intradía
 * y puede publicar un escalón de diferencia hasta la medianoche.
 */
export const UMBRAL_ESPEJO_OK = 99.5;

/** Hoy en Montevideo como YYYY-MM-DD (en-CA da exactamente ese formato). */
export function fechaMontevideoHoy(ahora: Date): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
}

/** Resta días a una fecha YYYY-MM-DD sin sorpresas de huso (aritmética UTC). */
export function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Mismo contrato fail-closed que el resto de las cards de la pantalla. */
export function buildVariantesFetch(params: {
  escenario: number | null;
  tipo: TipoDesfasaje | null;
  dias: number;
  tolerancia: number;
  hoy: string;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}): VariantesFetchIntent {
  const { escenario, tipo, dias, tolerancia, hoy, empresaSel, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot && empresasIds.length === 0) return { skip: true };

  const sp = new URLSearchParams({
    escenario: String(escenario),
    desde: restarDias(hoy, dias - 1),
    hasta: hoy,
    tolerancia: String(tolerancia),
  });
  if (tipo != null) sp.set('tipo', tipo);
  if (empresaSel != null) sp.set('empresa', String(empresaSel));

  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    headers['x-track-empresas-ids'] = empresasIds.join(',');
  }

  return { skip: false, url: `/api/metricas/variantes?${sp.toString()}`, headers };
}

/** Un número con coma decimal, sin ceros colgando ("0,80" → "0,8"). */
function numeroCorto(n: number): string {
  return String(Number(n.toFixed(2))).replace('.', ',');
}

const ESTADISTICO_CHIP: Record<string, string> = {
  MEDIA: 'promedio',
  MEDIANA: 'mediana',
  P75: 'P75',
  P90: 'P90',
};

/**
 * Las perillas de una variante como chips legibles. Una variante sin
 * ninguna perilla cambiada es el control ("espejo del motor").
 */
export function knobChips(knobs: VarianteKnobs): string[] {
  const chips: string[] = [];
  if (knobs.estadistico != null) chips.push(ESTADISTICO_CHIP[knobs.estadistico] ?? knobs.estadistico);
  if (knobs.nivel_ritmo === 'ZONA') chips.push('ritmo de zona');
  if (knobs.factor != null) chips.push(`×${numeroCorto(knobs.factor)}`);
  if (knobs.escalon_minutos != null) chips.push(`escalón ${knobs.escalon_minutos}′`);
  if (!knobs.suavizado) chips.push('sin escalera');
  if (knobs.suavizado_paso != null) chips.push(`escalera de a ${knobs.suavizado_paso}′`);
  if (knobs.min_minutos != null) chips.push(`piso ${knobs.min_minutos}′`);
  return chips.length > 0 ? chips : ['espejo del motor'];
}

/**
 * Días en los que la variante le ganó AL MOTOR REAL (no al Despacho):
 * se cruzan por fecha y solo cuentan los días donde ambos llegan al
 * mínimo de pedidos.
 */
export function diasVsMotor(
  v: VarianteScore,
  motor: MotorScore | null,
  minN: number,
): { ganados: number; total: number } {
  if (motor == null) return { ganados: 0, total: 0 };
  const motorPorFecha = new Map(motor.dias.map((d) => [d.fecha, d]));
  let ganados = 0;
  let total = 0;
  for (const d of v.dias) {
    const md = motorPorFecha.get(d.fecha);
    if (md == null || d.n < minN || md.n < minN || d.le_tol == null || md.le_tol == null) continue;
    total += 1;
    if (d.le_tol > md.le_tol) ganados += 1;
  }
  return { ganados, total };
}

export interface Promocion {
  promovible: boolean;
  motivo: string;
}

/**
 * La regla de promoción: PROMOVIBLE solo si (a) hay al menos
 * PROMO_MIN_DIAS_EVALUADOS días evaluables contra el motor, (b) le ganó
 * en al menos PROMO_MIN_DIAS_GANADOS, y (c) el acumulado le saca al
 * motor al menos PROMO_MARGEN_PTS puntos. El CAMPEON nunca es
 * promovible (es el control).
 */
export function evaluarPromocion(v: VarianteScore, motor: MotorScore | null, minN: number): Promocion {
  if (v.codigo === 'CAMPEON') return { promovible: false, motivo: 'Es el control del laboratorio.' };
  const { ganados, total } = diasVsMotor(v, motor, minN);
  if (total < PROMO_MIN_DIAS_EVALUADOS) {
    return {
      promovible: false,
      motivo: `Faltan días de medición: ${total} de los ${PROMO_MIN_DIAS_EVALUADOS} necesarios.`,
    };
  }
  if (ganados < PROMO_MIN_DIAS_GANADOS) {
    return {
      promovible: false,
      motivo: `Le ganó al motor ${ganados} de ${total} días (necesita ${PROMO_MIN_DIAS_GANADOS}).`,
    };
  }
  const margen = v.le_tol != null && motor?.le_tol != null ? v.le_tol - motor.le_tol : null;
  if (margen == null || margen < PROMO_MARGEN_PTS) {
    return {
      promovible: false,
      motivo: `El margen acumulado (${margen == null ? 'sin dato' : `${margen.toFixed(1)} pts`}) no llega a ${PROMO_MARGEN_PTS} pts.`,
    };
  }
  return {
    promovible: true,
    motivo: `Le ganó al motor ${ganados} de ${total} días y le saca ${margen.toFixed(1)} pts acumulados.`,
  };
}

/**
 * El titular del laboratorio, en lenguaje llano: la mejor variante real
 * (excluido el control), contra el motor y el Despacho, con la honestidad
 * del tamaño de muestra.
 */
export function narrativaLab(params: {
  variantes: VarianteScore[];
  motor: MotorScore | null;
  despacho: { le_tol: number | null } | null;
  minN: number;
  tolerancia: number;
}): string {
  const { variantes, motor, despacho, minN, tolerancia } = params;
  const candidatas = variantes.filter((v) => v.codigo !== 'CAMPEON' && v.le_tol != null && v.n > 0);
  if (candidatas.length === 0) {
    return 'El laboratorio todavía no juntó entregas contra sus variantes. Con las corridas de hoy ya empieza a llenarse solo.';
  }
  const mejor = candidatas.reduce((a, b) => ((b.le_tol ?? -1) > (a.le_tol ?? -1) ? b : a));
  const partes: string[] = [];
  const chips = knobChips(mejor.knobs).join(' + ');
  partes.push(
    `La mejor combinación hasta ahora es ${mejor.nombre} (${chips}): ${mejor.le_tol?.toFixed(1)}% dentro de ±${tolerancia}′ sobre ${mejor.n} pedidos`,
  );
  if (motor?.le_tol != null) {
    const d = (mejor.le_tol ?? 0) - motor.le_tol;
    partes.push(`${d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1)} pts vs el motor real (${motor.le_tol.toFixed(1)}%)`);
  }
  if (despacho?.le_tol != null) {
    const d = (mejor.le_tol ?? 0) - despacho.le_tol;
    partes.push(`${d >= 0 ? `+${d.toFixed(1)}` : d.toFixed(1)} pts vs el Despacho (${despacho.le_tol.toFixed(1)}%)`);
  }
  const promo = evaluarPromocion(mejor, motor, minN);
  const cierre = promo.promovible
    ? 'Cumple la regla de promoción: se puede llevar al motor.'
    : `Todavía no se promociona: ${promo.motivo.toLowerCase()}`;
  return `${partes.join(' · ')}. ${cierre}`;
}

/* ─────────────────── Reproceso (cola demoras_lab_jobs) ─────────────────── */

/** Mismo tope que la RPC metricas_lab_job_crear: reprocesar es caro. */
export const MAX_DIAS_REPROCESO = 31;

export type ReprocesoFetchIntent =
  | { skip: true }
  | {
      skip: false;
      url: string;
      method: 'GET' | 'POST';
      headers: Record<string, string>;
      body?: string;
    };

/**
 * Mismo contrato fail-closed que buildVariantesFetch, con una vuelta de
 * tuerca: esto ESCRIBE (encola un reproceso que reescribe las variantes
 * de todo un rango, para todas las empresas), así que el único alcance
 * aceptable es root — un usuario con empresas asignadas ni siquiera
 * llega a pedirlo.
 *
 * Con `crear` presente es el alta (POST); sin él, la consulta de la cola
 * (GET).
 */
export function buildReprocesoFetch(params: {
  escenario: number | null;
  isRoot: boolean;
  funcionalidades: string[];
  crear?: { desde: string; hasta: string; variantes: number[] | null } | null;
}): ReprocesoFetchIntent {
  const { escenario, isRoot, funcionalidades, crear } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot) return { skip: true };

  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
    'x-track-isroot': 'S',
  };

  const url = `/api/metricas/variantes/reproceso?escenario=${encodeURIComponent(String(escenario))}`;

  if (crear == null) {
    return { skip: false, url, method: 'GET', headers };
  }

  // Selección vacía no es "todas" (eso se pide con variantes: null): es un
  // pedido sin sentido y no vale la pena molestar al servidor.
  if (crear.variantes != null && crear.variantes.length === 0) return { skip: true };

  headers['Content-Type'] = 'application/json';
  return {
    skip: false,
    url,
    method: 'POST',
    headers,
    body: JSON.stringify({
      desde: crear.desde,
      hasta: crear.hasta,
      variantes: crear.variantes,
    }),
  };
}

/** ¿Hay algo en la cola todavía? Es lo que dispara el refresco cada 5s. */
export function hayJobActivo(jobs: LabJob[]): boolean {
  return jobs.some((j) => j.estado === 'PENDIENTE' || j.estado === 'CORRIENDO');
}

/** "2026-08-01" → "1/8" (sin Intl: el formato es siempre el mismo). */
function diaMes(fecha: string): string {
  const [, m, d] = fecha.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** Miles con punto, a mano — no depende del ICU que traiga el runtime. */
function numeroMiles(n: number): string {
  const entero = Math.abs(Math.round(n)).toString();
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `-${conPuntos}` : conPuntos;
}

/** Segundos → "45 s" / "3 min" / "3 min 20 s". null si no hay dato. */
export function duracionTexto(seg: number | null | undefined): string | null {
  if (seg == null || !Number.isFinite(seg) || seg < 0) return null;
  const total = Math.round(seg);
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const resto = total % 60;
  return resto === 0 ? `${min} min` : `${min} min ${resto} s`;
}

/**
 * El estado de un trabajo en una línea, en lenguaje llano: el rango y el
 * alcance siempre adelante (es lo que identifica al trabajo para el que
 * lo pidió) y después qué pasó con él.
 */
export function resumenJob(job: LabJob): string {
  const rango = job.desde === job.hasta ? `${diaMes(job.desde)}` : `${diaMes(job.desde)} al ${diaMes(job.hasta)}`;
  const cuantas = job.variantes?.length ?? 0;
  const alcance =
    job.variantes == null
      ? 'todas las variantes'
      : cuantas === 1
        ? '1 variante'
        : `${cuantas} variantes`;
  const cabeza = `${rango} · ${alcance}`;
  const dur = duracionTexto(job.duracion_seg);

  switch (job.estado) {
    case 'PENDIENTE':
      return `${cabeza} — en cola, arranca en el próximo minuto.`;
    case 'CORRIENDO':
      return `${cabeza} — corriendo${dur != null ? ` hace ${dur}` : ''}…`;
    case 'LISTO': {
      const detalle =
        job.corridas != null
          ? `${numeroMiles(job.corridas)} corridas${job.filas != null ? ` y ${numeroMiles(job.filas)} filas` : ''}`
          : 'sin corridas para ese rango';
      return `${cabeza} — listo: ${detalle}${dur != null ? ` en ${dur}` : ''}.`;
    }
    case 'ERROR':
      return `${cabeza} — falló: ${job.error ?? 'sin detalle del error'}`;
    default:
      return cabeza;
  }
}
