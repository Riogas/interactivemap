'use client';

import { useState } from 'react';
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

const COLLAPSED_ROWS = 7;

// ─── BucketStackedBar ─────────────────────────────────────────────────────────

function BucketStackedBar({
  rows,
  buckets,
  colors,
  maxRows,
}: {
  rows: BucketRow[];
  buckets: readonly string[];
  colors: Record<string, string>;
  maxRows?: number;
}) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  const extra = rows.length - visible.length;
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
          + {extra} más
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

// ─── Card expandible (compacta + modal grande) ────────────────────────────────

function GraphCard({
  title,
  collapsedContent,
  expandedContent,
}: {
  title: string;
  collapsedContent: React.ReactNode;
  expandedContent: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto py-8 px-4 stats-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="w-full max-w-5xl stats-modal-content">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold tracking-tight text-stats-foreground dark:text-white">
                {title}
              </h3>
              <button
                onClick={() => setExpanded(false)}
                className="p-2 rounded-xl transition-all duration-200 group text-stats-muted-fg hover:text-stats-foreground hover:bg-stats-surface-2 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
                title="Cerrar"
                aria-label="Cerrar tarjeta expandida"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:rotate-90 transition-transform duration-200" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="text-sm">{expandedContent}</div>
          </div>
        </div>
      )}
      <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 hover:-translate-y-px hover:shadow-md dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40 dark:hover:bg-white/[0.07]">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-stats-foreground dark:text-gray-200">
            {title}
          </h4>
          <button
            onClick={() => setExpanded(true)}
            className="p-1 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 text-stats-muted-fg hover:text-stats-foreground hover:bg-stats-surface-2 dark:text-gray-500 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
            title="Expandir"
            aria-label="Expandir tarjeta"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="text-sm">{collapsedContent}</div>
      </div>
    </>
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
      <GraphCard
        title="Volumen"
        collapsedContent={<StackedBarChart data={stackedData} expanded maxRows={COLLAPSED_ROWS} />}
        expandedContent={<StackedBarChart data={stackedData} expanded />}
      />

      <GraphCard
        title="Pendientes por atraso"
        collapsedContent={
          <>
            {pendientesData.length > 0 && (
              <div className="mb-3">
                <BucketLegend buckets={pendienteBuckets} colors={COLORS_BUCKETS_PENDIENTE} />
              </div>
            )}
            <BucketStackedBar
              rows={pendientesData}
              buckets={pendienteBuckets}
              colors={COLORS_BUCKETS_PENDIENTE}
              maxRows={COLLAPSED_ROWS}
            />
          </>
        }
        expandedContent={
          <>
            {pendientesData.length > 0 && (
              <div className="mb-4">
                <BucketLegend buckets={pendienteBuckets} colors={COLORS_BUCKETS_PENDIENTE} />
              </div>
            )}
            <BucketStackedBar
              rows={pendientesData}
              buckets={pendienteBuckets}
              colors={COLORS_BUCKETS_PENDIENTE}
            />
          </>
        }
      />

      <GraphCard
        title="Finalizados por atraso"
        collapsedContent={
          <>
            {finalizadosData.length > 0 && (
              <div className="mb-3">
                <BucketLegend buckets={finalizadoBuckets} colors={COLORS_BUCKETS_FINALIZADO} />
              </div>
            )}
            <BucketStackedBar
              rows={finalizadosData}
              buckets={finalizadoBuckets}
              colors={COLORS_BUCKETS_FINALIZADO}
              maxRows={COLLAPSED_ROWS}
            />
          </>
        }
        expandedContent={
          <>
            {finalizadosData.length > 0 && (
              <div className="mb-4">
                <BucketLegend buckets={finalizadoBuckets} colors={COLORS_BUCKETS_FINALIZADO} />
              </div>
            )}
            <BucketStackedBar
              rows={finalizadosData}
              buckets={finalizadoBuckets}
              colors={COLORS_BUCKETS_FINALIZADO}
            />
          </>
        }
      />
    </div>
  );
}
