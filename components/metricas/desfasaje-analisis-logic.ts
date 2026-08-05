/**
 * Lógica pura de components/metricas/DesfasajeAnalisis.tsx — mismo patrón
 * que desfasaje-logic.ts (vitest environment: 'node', sin render).
 */

import type { AnalisisDia, AnalisisDiagnostico, AnalisisZona, FuenteAnalisis, TipoDesfasaje } from '@/types/metricas-desfasaje';

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

// ─── El porqué del veredicto: la autopsia en palabras, con sinceridad ───────

export interface CausaNarrada {
  clave: string;
  label: string;
  n: number;
  /** Fracción sobre los puntos perdidos del motor (0..1). */
  peso: number;
  palanca: string;
}

export interface Narrativa {
  titulo: string;
  parrafos: string[];
  causas: CausaNarrada[];
}

const CAUSAS_DEF: { clave: keyof AnalisisDiagnostico; label: string; palanca: string }[] = [
  {
    clave: 'c_sobrestimo',
    label: 'El modelo pidió DE MÁS',
    palanca:
      'El pedido llegó mucho antes de lo que el motor prometió: la cola o el ritmo pesan de más a esa hora. La palanca es de MODELO: afinar el estadístico y la ventana del ritmo, y el peso de la cola — no es un problema de publicación.',
  },
  {
    clave: 'c_escalera',
    label: 'La escalera del suavizado',
    palanca:
      'El número crudo del modelo ACERTABA, pero lo publicado venía moviéndose de a pasos y no llegó a tiempo. La palanca: subir la baja/suba máxima por corrida o ampliar el bypass.',
  },
  {
    clave: 'c_techo',
    label: 'Techo de zona sin móviles',
    palanca:
      'El motor publicaba el techo de una zona sin móviles mientras el Despacho jugaba su número de grilla. El arranque predictivo (activo desde el 5/8) ataca exactamente esto.',
  },
  {
    clave: 'c_subestimo',
    label: 'El modelo pidió DE MENOS',
    palanca:
      'El pedido llegó bastante después de lo que el motor prometió (sin ser un incidente): revisar el descuento de los asignados y los ritmos que quedan cortos.',
  },
  {
    clave: 'c_operativo',
    label: 'Incidente operativo (más de 90 minutos reales)',
    palanca:
      'Entregas que pasaron de 90 minutos: eso es cancha, no cálculo — ninguna fórmula honesta lo promete; el Despacho lo "acertó" solo porque prometió alto.',
  },
];

/**
 * Redacta el porqué del veredicto a partir del diagnóstico, con las
 * palancas concretas y sin trampas: dice cuándo la mejora es de modelo,
 * cuándo de publicación, y cuándo no hay perilla que valga.
 */
export function narrarDiagnostico(d: AnalisisDiagnostico): Narrativa {
  const pct = (x: number) => `${((x / Math.max(1, d.n)) * 100).toLocaleString('es-UY', { maximumFractionDigits: 1 })}%`;
  const v = veredicto(d.despacho_le25, d.motor_le25);
  const titulo =
    v === null || v.ganador === 'empate'
      ? 'Empate técnico entre el Despacho y el motor en este corte.'
      : v.ganador === 'despacho'
        ? `El Despacho ganó por ${v.puntos.toLocaleString('es-UY')} puntos de ≤25′ en este corte.`
        : `El motor ganó por ${v.puntos.toLocaleString('es-UY')} puntos de ≤25′ en este corte.`;

  const parrafos: string[] = [];
  parrafos.push(
    `De ${d.n.toLocaleString('es-UY')} pedidos comparables: los dos acertaron ${d.ambos.toLocaleString('es-UY')} (${pct(d.ambos)}), ` +
    `solo el Despacho ${d.solo_despacho.toLocaleString('es-UY')} (${pct(d.solo_despacho)}), ` +
    `solo el motor ${d.solo_motor.toLocaleString('es-UY')} (${pct(d.solo_motor)}), ` +
    `y ${d.ninguno.toLocaleString('es-UY')} no los acertó nadie. La diferencia se juega entera en los dos del medio.`,
  );

  const causas: CausaNarrada[] = CAUSAS_DEF
    .map((c) => ({
      clave: String(c.clave),
      label: c.label,
      n: Number(d[c.clave] ?? 0),
      peso: d.solo_despacho > 0 ? Number(d[c.clave] ?? 0) / d.solo_despacho : 0,
      palanca: c.palanca,
    }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);

  // Contrafáctico honesto: publicar la cruda del modelo.
  if (d.cruda_le25 != null && d.motor_le25 != null && d.despacho_le25 != null && d.cruda_n > 0) {
    const cruda = (d.cruda_le25 * 100).toLocaleString('es-UY', { maximumFractionDigits: 1 });
    const gapModelo = Math.round((d.despacho_le25 - d.cruda_le25) * 1000) / 10;
    if (gapModelo <= 0.5) {
      parrafos.push(
        `Contrafáctico: publicando el número CRUDO del modelo (sin escalera, techo ni redondeo) el motor habría dado ${cruda}% — ` +
        'ya empata o gana al Despacho. Lo que falta es fricción de PUBLICACIÓN, no de modelo.',
      );
    } else {
      parrafos.push(
        `Contrafáctico: publicando el número CRUDO del modelo (sin escalera, techo ni redondeo) el motor habría dado ${cruda}% — ` +
        `todavía ${gapModelo.toLocaleString('es-UY')} puntos abajo del Despacho. La mejora que falta es de MODELO (qué número calcular), no de publicación.`,
      );
    }
  }

  // La sinceridad anti-inflación: el KPI castiga inflar.
  if (d.despacho_colchon + d.despacho_tarde > 0) {
    parrafos.push(
      `Inflar demoras no es camino: el KPI castiga llegar muy ANTES igual que muy tarde. De hecho, donde solo acertó el motor, ` +
      `el Despacho perdió ${d.despacho_colchon.toLocaleString('es-UY')} pedidos por colchón grande (llegaron 25′+ antes de lo prometido) ` +
      `y ${d.despacho_tarde.toLocaleString('es-UY')} por quedarse corto.`,
    );
  }

  return { titulo, parrafos, causas };
}
