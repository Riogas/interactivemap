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

interface GraficosTabsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon: React.ReactNode;
  stackedData: StackRow[];
  pendientesData: BucketRow[];
  finalizadosData: BucketRow[];
}

type TabKey = 'volumen' | 'pendientes' | 'finalizados';

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
                      className="h-full flex items-center justify-center overflow-hidden"
                      style={{ width: `${pct}%`, backgroundColor: colors[bucket] ?? '#6B7280' }}
                      title={`${bucket}: ${count}`}
                    >
                      {pct >= 15 && (
                        <span className="text-[9px] font-black text-white leading-none [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]">
                          {pct}%
                        </span>
                      )}
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

// ─── Componente principal ─────────────────────────────────────────────────────

export function GraficosTabsModal({
  isOpen,
  onClose,
  title,
  icon,
  stackedData,
  pendientesData,
  finalizadosData,
}: GraficosTabsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('volumen');

  if (!isOpen) return null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'volumen', label: 'Volumen' },
    { key: 'pendientes', label: 'Pendientes por atraso' },
    { key: 'finalizados', label: 'Finalizados por atraso' },
  ];

  const pendienteBuckets = BUCKETS_PENDIENTE_ORDEN as readonly BucketPendiente[];
  const finalizadoBuckets = BUCKETS_FINALIZADO_ORDEN as readonly BucketFinalizado[];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto py-8 px-4 stats-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl stats-modal-content">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold tracking-tight text-stats-foreground dark:text-white flex items-center gap-2.5">
            <span className="text-stats-muted-fg dark:text-gray-400">{icon}</span>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-all duration-200 group text-stats-muted-fg hover:text-stats-foreground hover:bg-stats-surface-2 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 group-hover:rotate-90 transition-transform duration-200"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-stats-border dark:border-white/10 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info ${
                activeTab === tab.key
                  ? 'border-stats-info text-stats-info'
                  : 'border-transparent text-stats-muted-fg hover:text-stats-foreground dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="text-sm min-h-[200px]">
          {activeTab === 'volumen' && (
            <StackedBarChart data={stackedData} expanded />
          )}

          {activeTab === 'pendientes' && (
            <>
              <BucketStackedBar
                rows={pendientesData}
                buckets={pendienteBuckets}
                colors={COLORS_BUCKETS_PENDIENTE}
                maxRows={20}
              />
              {pendientesData.length > 0 && (
                <div className="mt-5 pt-4 border-t border-stats-border dark:border-white/10">
                  <BucketLegend
                    buckets={pendienteBuckets}
                    colors={COLORS_BUCKETS_PENDIENTE}
                  />
                </div>
              )}
            </>
          )}

          {activeTab === 'finalizados' && (
            <>
              <BucketStackedBar
                rows={finalizadosData}
                buckets={finalizadoBuckets}
                colors={COLORS_BUCKETS_FINALIZADO}
                maxRows={20}
              />
              {finalizadosData.length > 0 && (
                <div className="mt-5 pt-4 border-t border-stats-border dark:border-white/10">
                  <BucketLegend
                    buckets={finalizadoBuckets}
                    colors={COLORS_BUCKETS_FINALIZADO}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
