'use client';

/**
 * E2 — modal de ampliación reusado por las 4 secciones (tendencia, por tipo,
 * ranking, tabla). Portaleado a document.body. Se renderiza condicionalmente
 * (return null si !open), así que cada apertura es un mount nuevo — el chart
 * hijo (Recharts ResponsiveContainer) mide su tamaño final desde el primer
 * layout, sin arrastrar medidas stale de una apertura anterior.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function ExpandModal({
  open,
  onClose,
  title,
  hint,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <div
        className="metricas-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="metricas-modal-content relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-stats-border bg-stats-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stats-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-stats-foreground">{title}</h3>
            {hint && <p className="mt-0.5 text-xs text-stats-muted-fg">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg border border-stats-border bg-stats-surface-2 p-1.5 text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
