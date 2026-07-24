'use client';

/**
 * E3 — botón "i" que abre un popover explicando qué muestra la card.
 *
 * Portaleado a document.body (regla dura del repo): las cards del dashboard
 * viven en un grid con overflow/transform potenciales en ancestros (charts,
 * animaciones de entrada), lo que rompería el position:fixed de un popover
 * no-portaleado. Se posiciona con getBoundingClientRect() del trigger y se
 * re-calcula en resize/scroll mientras está abierto.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const PANEL_WIDTH = 288;

export function InfoPopover({
  title,
  text,
  size = 'sm',
}: {
  title: string;
  text: string;
  size?: 'xs' | 'sm';
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    let left = rect.right - PANEL_WIDTH;
    left = Math.max(8, Math.min(left, window.innerWidth - PANEL_WIDTH - 8));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 8);
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }

    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, updatePos]);

  const sizeClass = size === 'xs' ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Información: ${title}`}
        aria-expanded={open}
        title="Info"
        className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full border border-stats-border bg-stats-surface-2 font-bold text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary`}
      >
        i
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[95]" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="dialog"
              aria-label={title}
              className="metricas-popover-in fixed z-[96] rounded-xl border border-stats-border bg-stats-surface p-3.5 shadow-2xl"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-stats-foreground">{title}</h4>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar"
                  className="shrink-0 text-stats-muted-fg transition-colors hover:text-stats-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-[0.8rem] leading-relaxed text-stats-muted-fg">{text}</p>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
