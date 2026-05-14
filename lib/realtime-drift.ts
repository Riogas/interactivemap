'use client';

import { sendAuditBatch } from '@/lib/audit-client';

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
 * Construye el evento de audit para un drift exitoso (testeable de forma pura).
 */
export function buildDriftAuditEvent(params: DriftParams) {
  return {
    event_type: 'realtime_drift' as const,
    endpoint: 'dashboard/reconcile',
    extra: {
      trigger: params.trigger,
      added: params.added,
      removed: params.removed,
      totalAfter: params.totalAfter,
      totalBefore: params.totalBefore,
      selectedDate: params.selectedDate,
      userIsRoot: params.isRoot,
    },
  };
}

/**
 * Reporta drift al audit_log y muestra toast si isRoot.
 * No hace nada si added === 0 && removed === 0.
 * El caller es responsable de actualizar setLastSync separadamente.
 */
export function reportDrift(params: DriftParams): void {
  if (params.added === 0 && params.removed === 0) return;

  // Audit log para todos los usuarios (fire-and-forget)
  sendAuditBatch([{
    event_type: 'realtime_drift',
    endpoint: 'dashboard/reconcile',
    extra: {
      trigger: params.trigger,
      added: params.added,
      removed: params.removed,
      totalAfter: params.totalAfter,
      totalBefore: params.totalBefore,
      selectedDate: params.selectedDate,
      userIsRoot: params.isRoot,
    },
  }]);

  // Toast de "Reconciliacion (...): +N / -M moviles" removido a pedido del
  // usuario — era ruido visual para roots. El audit_log de arriba sigue
  // emitiendo siempre, así que la observabilidad backend no se pierde.
}

/**
 * Reporta un fallo del fetch de posiciones (result.success === false).
 * Siempre emite al audit_log, nunca muestra toast.
 */
export function reportDriftFetchFailed(params: {
  trigger: DriftTrigger;
  status: number;
  selectedDate: string;
  isRoot: boolean;
}): void {
  sendAuditBatch([{
    event_type: 'realtime_drift_fetch_failed',
    endpoint: 'dashboard/reconcile',
    extra: {
      trigger: params.trigger,
      status: params.status,
      selectedDate: params.selectedDate,
      userIsRoot: params.isRoot,
    },
  }]);
}
