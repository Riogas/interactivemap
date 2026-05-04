# Plan de implementacion — runId: 20260504-drift-tm5

## Resumen ejecutivo

Implementar instrumentacion visible de drift en 6 pasos secuenciales. La estrategia es:
1. Crear el helper puro `lib/realtime-drift.ts` primero (sin dependencias de componentes)
2. Extender el tipo en audit-client.ts
3. Crear el componente `RealtimeDriftIndicator.tsx`
4. Modificar `fetchPositions()` para devolver `{ added, removed, success }`
5. Modificar los 4 useEffects en page.tsx para capturar retorno y llamar reportDrift
6. Agregar state `lastSync` y pasar nuevas props a MovilSelector + insertar indicador

## Notas de TypeScript sobre cambio de firma de fetchPositions

`fetchPositions` pasa como callback a `setOnReconnect(fetchPositions)`.
El tipo del contexto es `onReconnect: (() => void) | null`.
En TypeScript, `() => Promise<X>` ES asignable a `() => void` — el retorno se ignora.
No requiere cambio de tipos en RealtimeProvider. Verificar con `tsc --noEmit`.

Call sites que ignoran el retorno (no necesitan cambio):
- L696: setOnReconnect(fetchPositions) — OK, void ignora Promise
- L718: fetchPositions() — resultado ignorado (es el trigger del polling de intervalo — NECESITA capturar retorno para reportDrift)
- L746: fetchPositions() — idem (silence trigger — NECESITA capturar retorno)
- L768: fetchPositions() — idem (visibility trigger — NECESITA capturar retorno)
- L809: fetchPositions() — llamado al cambiar empresas/fecha — es re-carga completa, isInitialLoad=true, retorna {added:0,removed:0,success:true} — OK ignorar
- L1779: fetchPositions() — llamado desde algun efecto — ver contexto
- L1814: fetchPositions() — idem — ver contexto

Solo los 3 call sites dentro de los useEffects de reconcile (L718, L746, L768) necesitan
capturar el retorno para llamar reportDrift. Los demas son llamadas de recarga completa
donde isInitialLoad=true y el drift no aplica.

El reconnect (L696) es un caso especial: el callback se registra en el provider.
Cuando el provider hace onReconnect?.(), el resultado es ignorado — correcto.
Pero el implementer DEBE agregar un wrapper para capturar el resultado del reconnect
y llamar reportDrift con trigger='reconnect'. Ver Paso 5 para el detalle.

## Paso 1 — Crear lib/realtime-drift.ts

```typescript
'use client';

import toast from 'react-hot-toast';
import { sendAuditBatch } from '@/lib/audit-client';

export type DriftTrigger = 'interval' | 'reconnect' | 'visibility' | 'silence';

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

/** Calcula color del chip segun tiempo desde ultimo sync. */
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

/** Construye el evento de audit para drift exitoso. */
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

/** Reporta drift al audit_log y muestra toast si isRoot.
 * NO llama si added===0 && removed===0.
 * El caller es responsable de actualizar setLastSync. */
export function reportDrift(params: DriftParams): void {
  if (params.added === 0 && params.removed === 0) return;

  // Audit log para todos (fire-and-forget)
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

  // Toast solo para root
  if (params.isRoot) {
    toast(
      `🔄 Reconciliacion (${params.trigger}): +${params.added} / -${params.removed} moviles`,
      { duration: 3000 },
    );
  }
}

/** Reporta fallo del fetch (result.success === false). */
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
```

## Paso 2 — Extender union en lib/audit-client.ts

Cambiar la linea 18:
```ts
// antes:
event_type: 'api_call' | 'navigation' | 'click' | 'custom' | 'realtime';
// despues:
event_type: 'api_call' | 'navigation' | 'click' | 'custom' | 'realtime' | 'realtime_drift' | 'realtime_drift_fetch_failed';
```

Solo esa linea. Verificar que el /api/audit route no valide el enum (muy probable que sea
permisivo porque usa `extra?: unknown` y no hay schema estricto de event_type).

## Paso 3 — Crear components/dashboard/RealtimeDriftIndicator.tsx

Componente funcional con:
- Props: `lastSync: LastSyncState | null`, `pollingSeconds: number`, `onResync: () => void`
- Estado interno: `now: number` actualizado cada 1000ms via useEffect
- Usa `getSyncColor(lastSync?.at ?? null, pollingSeconds, now)` para el color
- Chip: span pequeño con emoji + "sync hace Xs" (calcular elapsed = now - lastSync.at)
- Tooltip via `title` (sin libreria externa)
- Boton "Resync ahora" solo si color === 'red'
- Si `lastSync === null`: mostrar "🔴 sin sync"
- className Tailwind para chip: `inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5`

## Paso 4 — Modificar fetchPositions en page.tsx

Cambios minimos:
- Cambiar firma del useCallback: `async (): Promise<{ added: number; removed: number; success: boolean }>`
- Agregar returns en cada rama:
  - Early return (usuario restringido): `return { added: 0, removed: 0, success: true }`
  - Primera carga (isInitialLoad): `return { added: 0, removed: 0, success: true }` (al final del bloque isInitialLoad)
  - Reconciliacion sin drift: `return { added: 0, removed: 0, success: true }` (al final del bloque `newApiMoviles.length === 0 && removedCount === 0`)
  - Reconciliacion con drift: `return { added: newApiMoviles.length, removed: removedCount, success: true }` (al final del bloque else)
  - result.success === false: `return { added: 0, removed: 0, success: false }`
  - Catch block: `return { added: 0, removed: 0, success: false }`

## Paso 5 — Modificar los 4 useEffects de reconcile en page.tsx

Agregar:
- State: `const [lastSync, setLastSync] = useState<LastSyncState | null>(null);`
- Import: `import { reportDrift, LastSyncState, DriftTrigger } from '@/lib/realtime-drift';`
- Variable derivada: `const isRoot = user?.isRoot === 'S';` (cerca de las otras vars derivadas)

### useEffect polling interval (L704-722): trigger='interval'
```ts
const result = await fetchPositions();
if (result.added > 0 || result.removed > 0) {
  setLastSync({ at: Date.now(), trigger: 'interval', added: result.added, removed: result.removed });
} else if (result.success) {
  setLastSync(prev => prev ? { ...prev, at: Date.now(), trigger: 'interval', added: 0, removed: 0 } : prev);
}
reportDrift({
  trigger: 'interval',
  added: result.added,
  removed: result.removed,
  totalBefore: movilesRef.current.length,
  totalAfter: movilesRef.current.length + result.added - result.removed,
  selectedDate: selectedDate ?? '',
  isRoot,
});
```

Nota: `totalAfter` es una estimacion. El valor exacto esta en el state de moviles despues del
setMoviles, pero setMoviles es async. Usar movilesRef.current (ref siempre actualizado) para
totalBefore y calcular totalAfter = totalBefore + added - removed.

### useEffect silence detection (L729-751): trigger='silence'
Similar al anterior, capturar retorno de fetchPositions() dentro del if (silenceMs > thresholdMs).

### useEffect visibility (L757-773): trigger='visibility'
Similar, dentro del handler de visibilitychange.

### useEffect reconnect (L695-698): trigger='reconnect'
El reconnect usa `setOnReconnect(fetchPositions)`. El provider llama al callback sin capturar retorno.
Para instrumentar el reconnect hay que crear un wrapper:
```ts
const fetchPositionsWithReconnectReport = useCallback(async () => {
  const result = await fetchPositions();
  // actualizar lastSync y llamar reportDrift con trigger='reconnect'
  if (result.success) {
    setLastSync({ at: Date.now(), trigger: 'reconnect', added: result.added, removed: result.removed });
  }
  reportDrift({
    trigger: 'reconnect',
    added: result.added,
    removed: result.removed,
    totalBefore: movilesRef.current.length,
    totalAfter: movilesRef.current.length + result.added - result.removed,
    selectedDate: selectedDate ?? '',
    isRoot,
  });
}, [fetchPositions, selectedDate, isRoot]);

// Y el useEffect de reconnect pasa el wrapper:
useEffect(() => {
  setOnReconnect(fetchPositionsWithReconnectReport);
  return () => setOnReconnect(null);
}, [setOnReconnect, fetchPositionsWithReconnectReport]);
```

Dependencias de `fetchPositionsWithReconnectReport`: [fetchPositions, selectedDate, isRoot]
Esto recrea el wrapper cuando cambia la fecha o el rol (correcto).

## Paso 6 — Modificar MovilSelector.tsx y page.tsx (pasar props)

En MovilSelectorProps agregar:
```ts
isRootUser?: boolean;
lastSync?: LastSyncState | null;
onResync?: () => void;
pollingSeconds?: number;
```

En el header de la categoria 'moviles' (despues del badge de count, linea ~899):
```tsx
{/* Indicador de drift - solo root */}
{category.key === 'moviles' && isRootUser && (
  <RealtimeDriftIndicator
    lastSync={lastSync ?? null}
    pollingSeconds={pollingSeconds ?? 60}
    onResync={onResync ?? (() => {})}
  />
)}
```

En page.tsx, en la llamada a <MovilSelector> (linea ~2409):
```tsx
isRootUser={user?.isRoot === 'S'}
lastSync={lastSync}
onResync={fetchPositions}
pollingSeconds={preferences.realtimePollingReconcileSeconds ?? 60}
```

## Paso 7 — Crear __tests__/realtime-drift.test.ts

Tests de funciones puras en lib/realtime-drift.ts:
1. getSyncColor: 3 casos (green/yellow/red)
2. buildDriftAuditEvent: shape correcto
3. reportDrift: sendAuditBatch se llama con drift > 0, NO se llama con drift = 0
4. reportDrift: toast se llama si isRoot=true, NO se llama si isRoot=false
5. Gating booleano: verificar que la condicion `added === 0 && removed === 0` hace early return

Mock de sendAuditBatch y toast via vi.mock de Vitest.

## Orden de ejecucion

1. lib/audit-client.ts (extender union) — cambio de 1 linea
2. lib/realtime-drift.ts (crear) — nuevo archivo, sin dependencias circulares
3. components/dashboard/RealtimeDriftIndicator.tsx (crear)
4. app/dashboard/page.tsx (modificar fetchPositions + efectos + state + props)
5. components/ui/MovilSelector.tsx (agregar props + insertar indicador)
6. __tests__/realtime-drift.test.ts (crear)
7. Verificar con `pnpm exec tsc --noEmit` y `pnpm test`

## Estimacion de LOC

- lib/realtime-drift.ts: ~80 LOC nuevas
- lib/audit-client.ts: +1 LOC
- components/dashboard/RealtimeDriftIndicator.tsx: ~70 LOC nuevas
- app/dashboard/page.tsx: ~50 LOC nuevas (+10 -0)
- components/ui/MovilSelector.tsx: ~20 LOC nuevas
- __tests__/realtime-drift.test.ts: ~100 LOC nuevas
Total estimado: ~320 LOC nuevas, ~10 modificadas

## Riesgos y mitigaciones

1. fetchPositions cambia retorno: TypeScript acepta el cambio (void <- Promise<X> es valido).
   Mitigacion: `pnpm exec tsc --noEmit` confirma.
2. movilesRef.current para totalBefore: el ref esta actualizado en render pero el setMoviles
   en fetchPositions es async. totalBefore puede estar desactualizado ~1 frame.
   Mitigacion: aceptado — es un campo informativo del audit_log, no logica critica.
3. Re-renders del chip: el `setInterval(1000)` en RealtimeDriftIndicator provoca un re-render
   del chip cada segundo. El chip esta gateado por `isRootUser` y es un componente hoja —
   no causa re-render del dashboard principal.
   Mitigacion: useRef para el interval, cleanup en return del useEffect.
