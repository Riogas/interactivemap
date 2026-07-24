'use client';

import { InfoPopover } from './InfoPopover';

/**
 * Wrapper de card con header (título + hint) + botón "i" (E3) + botón
 * "ampliar" (E2, opcional vía onExpand). Usado por las 4 secciones
 * analíticas (tendencia, por tipo, ranking, tabla).
 */
export function CardShell({
  title,
  hint,
  infoTitle,
  infoText,
  onExpand,
  className = '',
  style,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  infoTitle: string;
  infoText: string;
  onExpand?: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`stats-section-enter rounded-2xl border border-stats-border bg-stats-surface p-4 shadow-sm ${className}`}
      style={style}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[0.96rem] font-bold text-stats-foreground">{title}</h3>
            <InfoPopover title={infoTitle} text={infoText} size="xs" />
          </div>
          {hint && <p className="text-[0.74rem] text-stats-muted-fg">{hint}</p>}
        </div>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Ampliar ${infoTitle}`}
            title="Ampliar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stats-border bg-stats-surface-2 text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
