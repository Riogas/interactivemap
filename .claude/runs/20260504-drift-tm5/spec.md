# Spec — Instrumentacion visible de drift de realtime (runId: 20260504-drift-tm5)

## Pedido
Agregar instrumentacion visible (toast + indicador 🟢🟡🔴 + audit_log) al dashboard de TrackMovil
para diagnosticar drift en el contador de moviles del colapsable. Solo visible para usuarios
con `user?.isRoot === 'S'`. El audit_log corre para todos.

## Contexto tecnico confirmado

### Toast lib
`react-hot-toast` ya instalado y en uso (`MapView.tsx:34`). Import: `import toast from 'react-hot-toast'`.
NO instalar dependencias nuevas.

### user.isRoot
`user` viene de `useAuth()` en `app/dashboard/page.tsx:60`. El campo `user?.isRoot` es string `'S'` | `'N'`.
**CRITICO**: siempre comparar `user?.isRoot === 'S'`. NUNCA `=== true`. Bug conocido `7f8c318`.

### fetchPositions actualmente
- NO retorna ningun valor (void implicitly)
- Calcula `newApiMoviles.length` y `removedCount` internamente en lineas 561-564
- La logica de reconcile de los 4 useEffects SOLO llama `fetchPositions()` sin capturar retorno

### AuditClientEvent.event_type
El union actual es `'api_call' | 'navigation' | 'click' | 'custom' | 'realtime'`.
Decision: **extender el union** con `'realtime_drift'` para legibilidad. Verificar que
`/api/audit` route no tenga validacion estricta del campo (muy probable que sea permisivo
porque usa `extra?: unknown`). Si el implementer confirma que el route valida el enum,
fallback a `'custom'` con `extra.realtime_type: 'drift'`.

### MovilSelector
La prop `user` NO existe en la interface. Agregar prop `isRootUser?: boolean` (booleana,
no el objeto user completo) para no acoplar el componente a la estructura de AuthContext.
El parent (page.tsx) pasa `user?.isRoot === 'S'` como booleana.

### Ubicacion del indicador en MovilSelector
El header de la categoria 'moviles' esta en las lineas 885-1092. El indicador se inserta
dentro del bloque `category.key === 'moviles'`, despues del badge de count (linea 895-899),
antes de los botones de accion. Solo visible si `isRootUser === true`.

---

## ACs refinados (6 confirmados)

### AC1 — Toast al detectar drift (solo root)

Cuando `fetchPositions()` completa la fase de reconciliacion y detecta `added > 0 OR removed > 0`:
- Mostrar toast via `toast()` de react-hot-toast durante 3 segundos
- Texto: `🔄 Reconciliacion (<trigger>): +<added> / -<removed> moviles`
- Triggers: `'interval'` | `'reconnect'` | `'visibility'` | `'silence'`
- Gate: `user?.isRoot === 'S'` evaluado en el momento de llamar `reportDrift()` (no en render)
- Si `added === 0 && removed === 0`: NO mostrar toast (sync limpio)
- Decision de diseno: NO crear `RealtimeDriftToast.tsx` — llamar `toast()` directamente
  desde `lib/realtime-drift.ts`. Razon: evita un componente que hace re-render del
  arbol completo; react-hot-toast tiene su propio portal. Mas simple, cero re-renders.

### AC2 — Indicador "ultima sync" en header del colapsable (solo root)

Nuevo componente `components/dashboard/RealtimeDriftIndicator.tsx`:
- Props: `lastSync: LastSyncState | null`, `pollingSeconds: number`, `onResync: () => void`
- Muestra mini chip con emoji + texto `sync hace Ns`:
  - 🟢 si `(Date.now() - lastSync.at) < pollingSeconds * 1000`
  - 🟡 si `>= pollingSeconds * 1000 && < pollingSeconds * 2000`
  - 🔴 si `>= pollingSeconds * 2000` — ademas muestra boton "Resync ahora" que llama `onResync()`
- Tooltip: `trigger` del ultimo sync (interval/reconnect/visibility/silence)
- Actualizar el chip cada segundo con `setInterval(1000)` via `useEffect` interno
- "Sync exitoso" = cuando `fetchPositions()` recibe `result.success === true`
- Si `lastSync === null`: mostrar `🔴 sin sync` (primer estado antes de la primera carga)
- Solo se renderiza si la prop se pasa (el parent la pasa condicionalmente: `{isRoot && <RealtimeDriftIndicator .../>}`)

### AC3 — Audit log al detectar drift (todos los users)

En `lib/realtime-drift.ts`, funcion `reportDrift(params)` llama `sendAuditBatch`:
```ts
sendAuditBatch([{
  event_type: 'realtime_drift',  // extender el union en audit-client.ts
  endpoint: 'dashboard/reconcile',
  extra: {
    trigger: 'interval' | 'reconnect' | 'visibility' | 'silence',
    added: number,
    removed: number,
    totalAfter: number,
    totalBefore: number,
    selectedDate: string,
    userIsRoot: boolean,
  }
}]);
```
- Llamar siempre que `added > 0 OR removed > 0`, sin importar isRoot
- Si `result.success === false` en `fetchPositions()`: emitir `event_type: 'realtime_drift_fetch_failed'`
  con `extra.status` = HTTP status code (o 0 si error de red)
- NO emitir si `added === 0 && removed === 0`
- `sendAuditBatch` es fire-and-forget, ya maneja errores internamente

### AC4 — Gating estricto

- UI (RealtimeDriftIndicator + toast): `user?.isRoot === 'S'` — comparacion LITERAL
- audit_log: siempre para todos cuando hay drift
- La comparacion de isRoot se hace en page.tsx antes de pasar la prop a MovilSelector
  y antes de llamar `reportDrift` para el toast

### AC5 — No tocar logica del reconcile, solo instrumentar

`fetchPositions()` se modifica MINIMO:
- Cambia firma de `async () => void` a `async () => Promise<{ added: number; removed: number; success: boolean }>`
- En la rama de reconciliacion (lineas 561-604): ya calcula `newApiMoviles.length` y `removedCount`.
  Solo agregar `return { added: newApiMoviles.length, removed: removedCount, success: true }` al final del bloque `if (result.success)`.
- En la rama de error: `return { added: 0, removed: 0, success: false }`
- En la rama de early-return (usuario restringido sin empresas): `return { added: 0, removed: 0, success: true }`
- En la rama de primera carga (`isInitialLoad`): `return { added: 0, removed: 0, success: true }`
  (primera carga no es drift)
- Los 4 useEffects capturan el retorno de `fetchPositions()` y llaman `reportDrift()`

### AC6 — Tests

Archivo nuevo: `__tests__/realtime-drift.test.ts` (Vitest)

Funciones puras a testear (exportar desde `lib/realtime-drift.ts`):
- `getSyncColor(lastSyncAt: number | null, pollingSeconds: number, now?: number): 'green' | 'yellow' | 'red'`
  - Parametro `now` inyectable para facilitar tests sin mockear Date.now()
- `buildDriftAuditEvent(params: DriftParams): AuditClientEvent`
  - Verifica que el shape del evento sea correcto
- `buildDriftFailedAuditEvent(params: FailedParams): AuditClientEvent`

Tests obligatorios:
1. Gating: `RealtimeDriftIndicator` NO se renderiza si `isRootUser !== true`
   (en vez de RTL: testear la condicion booleana directamente)
2. `sendAuditBatch` se llama con shape correcto cuando drift > 0
3. `sendAuditBatch` NO se llama si added=0 && removed=0
4. `getSyncColor`: devuelve 'green' si < 1x, 'yellow' si 1x-2x, 'red' si > 2x
5. Suite existente de 342 tests sigue pasando (no se deben romper)

---

## Contratos de interfaz

### LastSyncState (nuevo tipo)
```ts
// en lib/realtime-drift.ts
export interface LastSyncState {
  at: number;            // Date.now() del momento del sync exitoso
  trigger: 'interval' | 'reconnect' | 'visibility' | 'silence';
  added: number;
  removed: number;
}
```

### fetchPositions (modificacion minima)
```ts
// antes: async () => void (implicito)
// despues:
async (): Promise<{ added: number; removed: number; success: boolean }>
```

### reportDrift (nueva funcion en lib/realtime-drift.ts)
```ts
export function reportDrift(params: {
  trigger: LastSyncState['trigger'];
  added: number;
  removed: number;
  totalBefore: number;
  totalAfter: number;
  selectedDate: string;
  isRoot: boolean;
  pollingSeconds: number;
}): void
// Efecto: si added>0 || removed>0 → sendAuditBatch + toast si isRoot
// Si added===0 && removed===0 → solo actualizar lastSync (no toast, no audit)
```

Nota: `reportDrift` necesita el setter de `lastSync` del componente parent. Opciones:
(a) reportDrift solo hace audit + toast y el parent actualiza lastSync separadamente
(b) reportDrift devuelve el nuevo LastSyncState y el parent lo aplica con setLastSync

Decision: opcion (a) — reportDrift es puro en efectos secundarios (audit + toast).
El parent llama `setLastSync({ at: Date.now(), trigger, added, removed })` despues
de `reportDrift()`. Mas testeable.

### getSyncColor (nueva funcion pura en lib/realtime-drift.ts)
```ts
export function getSyncColor(
  lastSyncAt: number | null,
  pollingSeconds: number,
  now?: number
): 'green' | 'yellow' | 'red'
```

### RealtimeDriftIndicator props
```ts
interface RealtimeDriftIndicatorProps {
  lastSync: LastSyncState | null;
  pollingSeconds: number;  // para calcular umbrales del color
  onResync: () => void;
}
```

### MovilSelector nuevas props
```ts
// Agregar a MovilSelectorProps:
isRootUser?: boolean;            // true si user?.isRoot === 'S'
lastSync?: LastSyncState | null; // estado del ultimo sync (solo visible si isRootUser)
onResync?: () => void;           // callback para el boton Resync
pollingSeconds?: number;         // default 60 si no se pasa
```

---

## Archivos a crear/modificar

### CREAR
- `lib/realtime-drift.ts` — helper: LastSyncState type, reportDrift(), getSyncColor(), buildDriftAuditEvent()
- `components/dashboard/RealtimeDriftIndicator.tsx` — chip 🟢🟡🔴 + boton Resync
- `__tests__/realtime-drift.test.ts` — tests de funciones puras + gating

### MODIFICAR
- `lib/audit-client.ts` — extender union de event_type con 'realtime_drift' y 'realtime_drift_fetch_failed'
- `app/dashboard/page.tsx` — agregar state lastSync, modificar fetchPositions() retorno, modificar los 4 useEffects para capturar retorno y llamar reportDrift(), pasar nuevas props a MovilSelector
- `components/ui/MovilSelector.tsx` — agregar props isRootUser/lastSync/onResync/pollingSeconds, insertar <RealtimeDriftIndicator> en header de categoria 'moviles'

---

## Riesgo principal

`fetchPositions` es un `useCallback` con muchas dependencias — cambiar su firma de retorno puede
requerir ajustar los `useEffects` que lo usan si tienen algun tipo de retorno esperado. El implementer
debe verificar que ninguna otra parte del codigo llame a fetchPositions y use el retorno previo (void).
Con `grep -rn "fetchPositions\(\)"` confirmar que todos los call sites son `void`.

---

## Out of scope (confirmado del request)
- UI en /admin/auditoria
- Threshold de alertas
- Persistencia de lastSync en sessionStorage
- Tocar useGPSTracking / useMoviles / usePedidosRealtime
