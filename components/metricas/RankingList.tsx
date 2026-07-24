'use client';

import { useEffect, useState } from 'react';
import type { RankingRow } from '@/types/metricas-dashboard';
import { formatMin } from './metricas-theme';
import { usePrefersReducedMotion } from './useCountUp';

function RankRow({ row, idx, tone, maxVal, animateIn }: { row: RankingRow; idx: number; tone: 'good' | 'bad'; maxVal: number; animateIn: boolean }) {
  const widthPct = maxVal > 0 ? ((row.promedio ?? 0) / maxVal) * 100 : 0;
  const barColor = tone === 'good' ? 'var(--color-stats-success)' : 'var(--color-stats-destructive)';
  return (
    <div className="grid grid-cols-[1.4rem_1fr_auto] items-center gap-2 py-[0.28rem]">
      <span className="text-right font-stats-mono text-[0.74rem] text-stats-muted-fg">{idx + 1}</span>
      <span className="truncate text-[0.82rem] text-stats-foreground" title={row.valor}>
        {row.valor}
      </span>
      <span className="font-stats-mono text-[0.82rem] font-semibold tabular-nums text-stats-foreground">
        {formatMin(row.promedio)} <span className="text-[0.8em] text-stats-muted-fg">min</span>
      </span>
      <div className="col-span-2 col-start-2 mt-0.5 h-2 overflow-hidden rounded-full bg-stats-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${animateIn ? widthPct : 0}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

export function RankingList({ ranking, limit = 5 }: { ranking: RankingRow[]; limit?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);

  // Se re-dispara el "crecimiento" de las barras cada vez que cambia el
  // ranking (nueva dimensión/filtro/período) — deliberado, no accidental:
  // sin esto las barras aparecerían ya llenas al cambiar de filtro.
  useEffect(() => {
    setMounted(false);
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [ranking]);

  if (ranking.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-center text-sm text-stats-muted-fg">
        Sin datos para esta dimensión en el período seleccionado.
      </div>
    );
  }

  const sorted = [...ranking].sort((a, b) => (a.promedio ?? 0) - (b.promedio ?? 0));
  const best = sorted.slice(0, limit);
  const worst = sorted.slice(-limit).reverse();
  const maxVal = Math.max(...sorted.map((r) => r.promedio ?? 0), 1);
  const animateIn = mounted || reducedMotion;

  return (
    <div>
      <div className="mb-1 mt-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-stats-success">▲ Más rápidos</div>
      {best.map((r, i) => (
        <RankRow key={`best-${i}-${r.valor}`} row={r} idx={i} tone="good" maxVal={maxVal} animateIn={animateIn} />
      ))}
      <div className="mb-1 mt-2.5 text-[0.68rem] font-bold uppercase tracking-wide text-stats-destructive">▼ Más lentos</div>
      {worst.map((r, i) => (
        <RankRow key={`worst-${i}-${r.valor}`} row={r} idx={i} tone="bad" maxVal={maxVal} animateIn={animateIn} />
      ))}
    </div>
  );
}
