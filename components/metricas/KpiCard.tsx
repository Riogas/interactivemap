'use client';

import { Sparkline } from './Sparkline';
import { InfoPopover } from './InfoPopover';
import { useCountUp } from './useCountUp';
import { formatMin, formatCount, SERIE_COLOR } from './metricas-theme';

export interface KpiCardProps {
  label: string;
  value: number | null;
  /** 'min' | '' (cantidad no lleva unidad). */
  unit: string;
  prev: number | null;
  spark?: number[];
  accent?: 'brand' | 'accent';
  /** 'abs' = delta en minutos (KPIs de tiempo); 'pct' = delta porcentual (Cumplidos). */
  deltaMode: 'abs' | 'pct';
  /** Dirección de cambio que se considera favorable (color verde). */
  goodDirection: 'up' | 'down';
  decimals: 0 | 1;
  infoTitle: string;
  infoText: string;
  /** Texto secundario opcional (ej. "72% a tiempo" en la card de atraso). */
  secondary?: string;
  animationDelayMs?: number;
}

export function KpiCard({
  label,
  value,
  unit,
  prev,
  spark,
  accent = 'brand',
  deltaMode,
  goodDirection,
  decimals,
  infoTitle,
  infoText,
  secondary,
  animationDelayMs = 0,
}: KpiCardProps) {
  const displayValue = useCountUp(value, decimals);
  const valueText = unit === '' ? formatCount(displayValue) : formatMin(displayValue);

  // ── Delta vs período previo ────────────────────────────────────────────
  let deltaLabel = '—';
  let deltaClass = 'text-stats-muted-fg bg-stats-surface-2';
  let arrow = '–';

  if (value !== null && prev !== null && prev !== 0) {
    const rawDiff = value - prev;
    const isFlat = Math.abs(rawDiff) < 1e-9;
    arrow = isFlat ? '–' : rawDiff > 0 ? '▲' : '▼';

    const increasedIsGood = goodDirection === 'up';
    const isGood = isFlat ? null : (rawDiff > 0) === increasedIsGood;

    if (deltaMode === 'pct') {
      const pct = (rawDiff / Math.abs(prev)) * 100;
      deltaLabel = `${Math.abs(Math.round(pct * 10) / 10)}%`;
    } else {
      deltaLabel = `${formatMin(Math.abs(rawDiff))} vs ant.`;
    }

    deltaClass = isFlat
      ? 'text-stats-muted-fg bg-stats-surface-2'
      : isGood
        ? 'text-stats-success bg-stats-success-soft'
        : 'text-stats-destructive bg-stats-destructive-soft';
  } else if (value !== null && (prev === null || prev === 0)) {
    // Sin período previo con datos (borde inicial del rango) — estado flat, sin división por cero.
    deltaLabel = '—';
  }

  return (
    <div
      className="stats-row-enter relative overflow-hidden rounded-2xl border border-stats-border bg-stats-surface p-4 pt-[0.95rem] shadow-sm"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <span
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${accent === 'accent' ? 'bg-stats-accent' : 'bg-stats-primary'}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[0.72rem] font-semibold tracking-wide text-stats-muted-fg">{label}</span>
        <InfoPopover title={infoTitle} text={infoText} size="xs" />
      </div>
      <div className="mt-[0.45rem] font-stats-mono text-[1.85rem] font-bold leading-none tracking-tight text-stats-foreground tabular-nums">
        {valueText}
        {unit && <span className="ml-1 text-[0.8rem] font-medium text-stats-muted-fg">{unit}</span>}
      </div>
      <div className="mt-[0.55rem] flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-stats-mono text-[0.72rem] font-bold ${deltaClass}`}
        >
          {arrow} {deltaLabel}
        </span>
        {secondary && <span className="font-stats-mono text-[0.72rem] text-stats-muted-fg">{secondary}</span>}
      </div>
      {spark && spark.length >= 2 && (
        <Sparkline
          values={spark}
          color={accent === 'accent' ? 'var(--color-stats-accent)' : SERIE_COLOR}
          className="pointer-events-none absolute bottom-0 right-0 h-[40%] w-[46%] opacity-50"
        />
      )}
    </div>
  );
}
