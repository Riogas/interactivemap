/**
 * Lógica pura de components/metricas/DesfasajeAnalisis.tsx — mismo patrón
 * que desfasaje-logic.ts (vitest environment: 'node', sin render).
 */

import type { AnalisisDia, AnalisisZona, FuenteAnalisis, TipoDesfasaje } from '@/types/metricas-desfasaje';

export const FUENTE_ANALISIS_LABEL: Record<FuenteAnalisis, string> = {
  informada: 'Despacho',
  calculada: 'Motor',
};

export const DIAS_ANALISIS = [7, 30] as const;

export type AnalisisFetchIntent =
  | { skip: true }
  | { skip: false; url: string; headers: Record<string, string> };

/** Mismo contrato fail-closed que buildDesfasajeFetch (misma pantalla). */
export function buildAnalisisFetch(params: {
  escenario: number | null;
  tipo: TipoDesfasaje | null;
  dias: number;
  fuente: FuenteAnalisis;
  /** Día elegido (YYYY-MM-DD) para el detalle; null = todo el rango. */
  fecha: string | null;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}): AnalisisFetchIntent {
  const { escenario, tipo, dias, fuente, fecha, empresaSel, isRoot, empresasIds, funcionalidades } = params;
  if (escenario == null) return { skip: true };
  if (!isRoot && empresasIds.length === 0) return { skip: true };

  const sp = new URLSearchParams({ escenario: String(escenario), dias: String(dias), fuente });
  if (tipo != null) sp.set('tipo', tipo);
  if (fecha != null) sp.set('fecha', fecha);
  if (empresaSel != null) sp.set('empresa', String(empresaSel));

  const headers: Record<string, string> = {
    'x-track-funcs': funcionalidades.map((f) => String(f).trim()).filter((f) => f.length > 0).join(','),
  };
  if (isRoot) {
    headers['x-track-isroot'] = 'S';
  } else {
    headers['x-track-empresas-ids'] = empresasIds.join(',');
  }

  return { skip: false, url: `/api/metricas/desfasaje/analisis?${sp.toString()}`, headers };
}

/**
 * La "lectura" de una zona floja, en una etiqueta: el mismo criterio
 * editorial del informe semanal, ahora como regla fija y testeable.
 * Umbrales sobre el desfasaje CON signo (positivo = llega tarde).
 */
export function lecturaZona(z: Pick<AnalisisZona, 'tarde30_pct' | 'sesgo_mediana'>): string {
  if (z.sesgo_mediana >= 5) return 'tarde sistemático';
  if (z.tarde30_pct >= 0.2) {
    return `1 de ${Math.max(2, Math.round(1 / z.tarde30_pct))} tarde`;
  }
  if (z.sesgo_mediana <= -15) return z.tarde30_pct >= 0.08 ? 'errático' : 'sobrepromesa';
  if (z.sesgo_mediana > -8) return 'poco colchón';
  return 'disperso';
}

export interface Veredicto {
  ganador: 'motor' | 'despacho' | 'empate';
  /** Diferencia en puntos porcentuales (siempre >= 0). */
  puntos: number;
}

/**
 * Quién acierta más sobre la población común. Menos de medio punto se
 * declara empate: a estas muestras, no es señal.
 */
export function veredicto(despachoLe25: number | null, motorLe25: number | null): Veredicto | null {
  if (despachoLe25 == null || motorLe25 == null) return null;
  const diff = (motorLe25 - despachoLe25) * 100;
  if (Math.abs(diff) < 0.5) return { ganador: 'empate', puntos: Math.abs(Math.round(diff * 10) / 10) };
  return {
    ganador: diff > 0 ? 'motor' : 'despacho',
    puntos: Math.round(Math.abs(diff) * 10) / 10,
  };
}

/** Conteo de días ganados por cada sistema en el rango (para el resumen). */
export function diasGanados(porDia: AnalisisDia[]): { motor: number; despacho: number; empates: number } {
  const out = { motor: 0, despacho: 0, empates: 0 };
  for (const d of porDia) {
    const v = veredicto(d.despacho_le25, d.motor_le25);
    if (v === null) continue;
    if (v.ganador === 'motor') out.motor += 1;
    else if (v.ganador === 'despacho') out.despacho += 1;
    else out.empates += 1;
  }
  return out;
}

/**
 * "Mar 4/8" de un YYYY-MM-DD, en Montevideo, sin pasar por el reloj local.
 * hourCycle no aplica (solo fecha); weekday corto de es-UY ya viene sin
 * punto en ICU moderno — se normaliza por las dudas.
 */
export function fechaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dia = new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', weekday: 'short' })
    .format(d)
    .replace('.', '');
  const [, m, dd] = iso.split('-');
  const cap = dia.charAt(0).toUpperCase() + dia.slice(1);
  return `${cap} ${Number(dd)}/${Number(m)}`;
}

/** % 0..1 → "76,5%" (es-UY usa coma). null → em dash. */
export function pctText(x: number | null): string {
  if (x == null) return '—';
  return `${(x * 100).toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Sesgo con signo explícito: −10,7 / +11,5 / 0. */
export function sesgoText(x: number): string {
  const v = x.toLocaleString('es-UY', { maximumFractionDigits: 1 });
  return x > 0 ? `+${v}` : v;
}
