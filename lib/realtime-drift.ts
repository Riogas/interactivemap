'use client';

import toast from 'react-hot-toast';

export type DriftTrigger = 'interval' | 'reconnect' | 'visibility' | 'silence' | 'initial' | 'moviles_event';

export interface LastSyncState {
  at: number;
  trigger: DriftTrigger;
  added: number;
  removed: number;
}

export interface DriftParams {
  trigger: DriftTrigger;
  added: number;
  removed: number;
  totalBefore: number;
  totalAfter: number;
  selectedDate: string;
  isRoot: boolean;
}

/**
 * Calcula el color del chip de sync segun tiempo transcurrido desde el ultimo sync exitoso.
 * @param lastSyncAt - timestamp epoch del ultimo sync, o null si nunca hubo sync
 * @param pollingSeconds - umbral de polling configurado (default 60)
 * @param now - inyectable para tests (default Date.now())
 */
export function getSyncColor(
  lastSyncAt: number | null,
  pollingSeconds: number,
  now: number = Date.now(),
): 'green' | 'yellow' | 'red' {
  if (lastSyncAt === null) return 'red';
  const elapsed = now - lastSyncAt;
  if (elapsed < pollingSeconds * 1000) return 'green';
  if (elapsed < pollingSeconds * 2000) return 'yellow';
  return 'red';
}

/**
 * Muestra toast de reconciliacion solo a usuarios root.
 * No hace nada si added === 0 && removed === 0.
 */
export function reportDrift(params: DriftParams): void {
  if (params.added === 0 && params.removed === 0) return;
  if (!params.isRoot) return;

  toast(
    `🔄 Reconciliacion (${params.trigger}): +${params.added} / -${params.removed} moviles`,
    { duration: 3000 },
  );
}
