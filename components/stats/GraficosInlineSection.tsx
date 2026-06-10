'use client';

import { StackedBarChart, type StackRow } from './Charts';
import {
  BUCKETS_PENDIENTE_ORDEN,
  BUCKETS_FINALIZADO_ORDEN,
  COLORS_BUCKETS_PENDIENTE,
  COLORS_BUCKETS_FINALIZADO,
  type BucketPendiente,
  type BucketFinalizado,
} from '@/utils/pedidoDelay';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface BucketRow {
  label: string;
  total: number;
  buckets: Record<string, number>;
}

interface GraficosInlineSectionProps {
  stackedData: StackRow[];
  pendientesData: BucketRow[];
  finalizadosData: BucketRow[];
  className?: string;
}

// ─── BucketStackedBar ─────────────────────────────────────────────────────────

function BucketStackedBar({
  rows,
  buckets,
  colors,
  maxRows = 20,
}: {
  rows: BucketRow[];
  buckets: readonly string[];
  colors: Record<string, string>;
  maxRows?: number;
}) {
  const visible = rows.slice(0, maxRows);
  const extra = rows.length - maxRows;
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-stats-muted-fg dark:text-gray-500 italic py-4">
        Sin datos para mostrar
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((row, i) => {
        const barWidth = Math.round((row.total / maxTotal) * 100);
        return (
          <div
            key={row.label}
            className="group stats-row-enter rounded -mx-1 px-1 py-0.5 hover:bg-stats-surface-2 dark:hover:bg-white/5 transition-colors"
            style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
          >
            <div className="flex justify-between items-baseline gap-2 text-sm mb-1 text-stats-foreground/80 dark:text-gray-300">
              <span className="truncate max-w-[70%] font-medium" title={row.label}>
                {row.label}
              </span>
              <span className="font-bold tabular-nums font-stats-mono text-right min-w-[3ch] text-stats-foreground dark:text-white">
                {row.total}
              </span>
            </div>
            <div className="h-6 rounded-full overflow-hidden bg-stats-surface-2 dark:bg-white/10">
              <div
                className="h-full flex rounded-full overflow-hidden"
                style={{ width: `${Math.max(barWidth, row.total > 0 ? 4 : 0)}%` }}
              >
                {buckets.map((bucket) => {
                  const count = row.buckets[bucket] ?? 0;
                  if (count === 0) return null;
                  const pct = row.total > 0 ? Math.round((count / row.total) * 100) : 0;
                  return (
                    <div
                      key={bucket}
                      className="h-full flex items-center justify-center overflow-hidden px-0.5"
                      style={{ width: `${pct}%`, backgroundColor: colors[bucket] ?? '#6B7280' }}
                      title={`${bucket}: ${count} (${pct}%)`}
                    >
                      {pct >= 18 ? (
                        <div className="text-center text-white font-black leading-[10px] whitespace-nowrap [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]">
                          <div className="text-[10px] font-stats-mono tabular-nums">{count}</div>
                          <div className="text-[8px] opacity-85">{pct}%</div>
                        </div>
                      ) : pct >= 10 ? (
                        <span className="text-[9px] font-black text-white leading-none font-stats-mono tabular-nums [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]">
                          {count}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      {extra > 0 && (
        <p className="text-[11px] text-stats-muted-fg dark:text-gray-500 pl-1 pt-1">
          + {extra} entidades más con menor volumen
        </p>
      )}
    </div>
  );
}

// ─── Leyenda de colores ───────────────────────────────────────────────────────

function BucketLegend({
  buckets,
  colors,
}: {
  buckets: readonly string[];
  colors: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-stats-muted-fg dark:text-gray-400">
      {buckets.map((bucket) => (
        <span key={bucket} className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
            style={{ backgroundColor: colors[bucket] ?? '#6B7280' }}
          />
          {bucket}
        </span>
      ))}
    </div>
  );
}

// ─── Card individual ──────────────────────────────────────────────────────────

function GraphCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40">
      <h4 className="text-sm font-semibold text-stats-foreground dark:text-gray-200 mb-4 pb-2 border-b border-stats-border dark:border-white/10">
        {title}
      </h4>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ─── Sección inline con los 3 gráficos ────────────────────────────────────────

export function GraficosInlineSection({
  stackedData,
  pendientesData,
  finalizadosData,
  className = '',
}: GraficosInlineSectionProps) {
  const pendienteBuckets = BUCKETS_PENDIENTE_ORDEN as readonly BucketPendiente[];
  const finalizadoBuckets = BUCKETS_FINALIZADO_ORDEN as readonly BucketFinalizado[];

  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stats-section-enter ${className}`}
    >
      <GraphCard title="Volumen">
        <StackedBarChart data={stackedData} expanded />
      </GraphCard>

      <GraphCard title="Pendientes por atraso">
        <BucketStackedBar
          rows={pendientesData}
          buckets={pendienteBuckets}
          colors={COLORS_BUCKETS_PENDIENTE}
          maxRows={20}
        />
        {pendientesData.length > 0 && (
          <div className="mt-5 pt-4 border-t border-stats-border dark:border-white/10">
            <BucketLegend buckets={pendienteBuckets} colors={COLORS_BUCKETS_PENDIENTE} />
          </div>
        )}
      </GraphCard>

      <GraphCard title="Finalizados por atraso">
        <BucketStackedBar
          rows={finalizadosData}
          buckets={finalizadoBuckets}
          colors={COLORS_BUCKETS_FINALIZADO}
          maxRows={20}
        />
        {finalizadosData.length > 0 && (
          <div className="mt-5 pt-4 border-t border-stats-border dark:border-white/10">
            <BucketLegend buckets={finalizadoBuckets} colors={COLORS_BUCKETS_FINALIZADO} />
          </div>
        )}
      </GraphCard>
    </div>
  );
}
