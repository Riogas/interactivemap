'use client';

import { useEffect, useState } from 'react';
import { getSyncColor, LastSyncState } from '@/lib/realtime-drift';

interface RealtimeDriftIndicatorProps {
  lastSync: LastSyncState | null;
  pollingSeconds: number;
  onResync: () => void;
}

const EMOJI: Record<'green' | 'yellow' | 'red', string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

/** Formatea segundos transcurridos de forma compacta: <60s → "Xs", <3600s → "Xm Ys", else "Xh". */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/**
 * Chip pequeño que muestra el estado del ultimo sync de posiciones.
 * Solo se renderiza si el parent lo decide (gating por isRoot en MovilSelector).
 * Se actualiza cada segundo via setInterval interno.
 */
export default function RealtimeDriftIndicator({
  lastSync,
  pollingSeconds,
  onResync,
}: RealtimeDriftIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  // Tick cada 10s para recomputar el color (no se muestra el contador en seg).
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  // Antes del primer sync: punto neutro sin alarma.
  if (!lastSync) {
    return (
      <span
        className="inline-flex items-center text-xs rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 font-mono"
        title="Cargando datos iniciales"
      >
        ⚪
      </span>
    );
  }

  const color = getSyncColor(lastSync.at, pollingSeconds, now);
  const emoji = EMOJI[color];
  const elapsedSeconds = Math.floor((now - lastSync.at) / 1000);
  const tooltipText = `Ultimo sync: ${lastSync.trigger} hace ${formatElapsed(now - lastSync.at)} | +${lastSync.added} / -${lastSync.removed} moviles`;

  return (
    <span className="inline-flex items-center gap-1" title={tooltipText}>
      <span className="inline-flex items-center text-xs rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 font-mono">
        {emoji}
      </span>
      {color === 'red' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onResync();
          }}
          className="text-xs text-red-600 underline hover:text-red-800 transition-colors whitespace-nowrap"
          title={`Sin sync hace ${elapsedSeconds}s — forzar resync ahora`}
        >
          Resync
        </button>
      )}
    </span>
  );
}
