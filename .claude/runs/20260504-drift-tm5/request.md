# Feature Request — Auto-diagnóstico de drift de realtime (solo root)

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Contexto

Tras desplegar `9796a60` (timezone), `75f7988` (reconnect-refetch + selectedDate persistence) y `cc69039` (build fix), el usuario sigue observando drift en el contador de móviles del colapsable: deja la pantalla quieta, ve "80", hace F5 y ve "82" o "78".

Las técnicas que metimos (polling de reconcile cada 60s, reconnect-refetch, refetch on visibility, silence detection) están correctamente instaladas en `app/dashboard/page.tsx` líneas 695–773 y verificadas. Pero corren en silencio: solo emiten `console.log`. Sin DevTools abierto, no hay manera de saber si están corriendo, si encuentran drift, o si fallan.

**Objetivo:** instrumentar visiblemente las 3 técnicas — pero **solo para usuarios root** (`user.isRoot === 'S'`). Los usuarios no-root no deben ver toasts, indicadores ni nada. El audit_log puede escribirse para cualquier usuario (es backend), pero el panel `/admin/auditoria` ya está restringido por su lado.

## Acceptance Criteria

### AC1 — Toast cuando el polling/reconcile detecta drift (solo root)

Cuando cualquiera de los reconciles (`polling 60s`, `reconnect-refetch`, `refetch on visible`, `silence-detected`) **encuentre alta(s) o baja(s)** de móviles vs el state actual, mostrar un toast discreto durante 3 segundos:

- Texto: `🔄 Reconciliación (<trigger>): +N / -M móviles` (ej: `🔄 Reconciliación (interval): +2 / -1`).
- Trigger: `interval` | `reconnect` | `visibility` | `silence`.
- Si N=0 y M=0 (sync exitoso pero sin drift), **no mostrar nada** (evitar spam).
- **Solo se muestra si `user?.isRoot === 'S'`**. No-root: silencioso, ni siquiera console.log si querés (mantener console.log es OK porque no es visible al user normal).

### AC2 — Indicador "última sync" al lado del contador del colapsable (solo root)

Junto al contador "X móviles" (donde sea que esté el header del colapsable de móviles), mostrar un mini chip:

- 🟢 `sync hace Ns` — si el último sync exitoso fue hace < 1× del polling configurado (default 60s).
- 🟡 `sync hace Ns` — si fue hace 1× a 2× (60s–120s).
- 🔴 `sync hace Ns` con un botón **"Resync ahora"** clickeable — si fue hace > 2× (>120s con default). El botón llama a `fetchPositions()` + `fetchPedidos()` + `fetchServices()`.
- Tooltip al hover: muestra el `trigger` del último sync (interval/reconnect/visibility/silence).
- "Sync exitoso" = `fetchPositions()` que devuelve `result.success === true`. Si devuelve 401 / fallo, NO actualiza `lastSync` (clave para detectar H1: si vemos 🔴 permanente, confirma que el polling está fallando).
- **Solo se muestra si `user?.isRoot === 'S'`**.

### AC3 — Log a audit_log cuando hay drift (todos los users, pero gate visible solo root)

Cuando cualquiera de los reconciles encuentre drift (added > 0 o removed > 0), escribir a `audit_log` vía el helper `sendAuditBatch` ya existente (`lib/audit-client.ts`):

```json
{
  "event_type": "realtime_drift",
  "endpoint": "dashboard/reconcile",
  "extra": {
    "trigger": "interval" | "reconnect" | "visibility" | "silence",
    "added": <N>,
    "removed": <M>,
    "totalAfter": <count>,
    "totalBefore": <count>,
    "selectedDate": "<YYYY-MM-DD>",
    "userIsRoot": <bool>
  }
}
```

- Escribir **siempre** que haya drift, no solo si el usuario es root. Es data backend para análisis.
- Si `result.success === false` (fallo del fetch), escribir un evento alternativo `event_type: 'realtime_drift_fetch_failed'` con `extra.status` para detectar H1.
- **No** escribir si `added=0 && removed=0` (sync limpio) — evita inundar la tabla.

### AC4 — Gating estricto

- Los componentes UI (Toast, indicador, botón Resync) **solo se renderizan si `user?.isRoot === 'S'`**. Comparación literal con `'S'` (no `=== true`, recordá el bug de `7f8c318` que tuvimos que fixear ayer).
- El audit_log SÍ corre para todos.
- No exponer `realtime_drift` events en ningún log público o toast a usuarios no-root.

### AC5 — No tocar la lógica del reconcile, solo instrumentarla

- NO cambiar el comportamiento de `fetchPositions`, polling, reconnect-refetch, etc. Solo agregar la **detección de drift** dentro de los callbacks.
- El cálculo de `added/removed` debe hacerse **comparando el state ANTES del setMoviles vs el array que viene de la API**, antes de aplicar el merge. Reutilizar la lógica existente en `app/dashboard/page.tsx:557-564` (que ya calcula `newApiMoviles.length` y `removedCount`).

### AC6 — Tests

- Test de gating: toast/indicador NO se renderizan si `user.isRoot !== 'S'` (probar `'N'`, `undefined`, `null`).
- Test de audit_log: se llama a `sendAuditBatch` con el shape correcto cuando hay drift, NO se llama si `added=0 && removed=0`.
- Test del helper de "sync ago": dado un `lastSyncAt` y un threshold, devuelve el color correcto (🟢/🟡/🔴).
- La suite existente de 342 tests sigue pasando.

## Archivos a tocar (mapa preliminar)

- `app/dashboard/page.tsx` — agregar state `lastSync: { at: number, trigger: string, added: number, removed: number } | null`. Modificar `fetchPositions` para devolver `{added, removed}`. Modificar los 4 useEffects de reconcile (polling, reconnect, visibility, silence) para llamar al nuevo helper de "report drift" cuando hay cambios.
- `components/dashboard/RealtimeDriftIndicator.tsx` — **NUEVO**, indicador 🟢🟡🔴 + botón Resync. Gateado por `isRoot`.
- `components/dashboard/RealtimeDriftToast.tsx` — **NUEVO** (o usar la lib de toast ya existente — vi `react-hot-toast` o similar en `MapView.tsx:777`). Componente que escucha el último drift y muestra el toast 3s. Gateado por `isRoot`.
- `lib/realtime-drift.ts` — **NUEVO**, helper para reportar drift al audit_log con el shape correcto + colores del indicador.
- Wherever está el "header del colapsable de móviles": insertar el `<RealtimeDriftIndicator />`. Buscar componente del colapsable (puede ser `MovilesPanel`, `MovilesList`, etc.).
- `__tests__/realtime-drift.test.ts` — **NUEVO**.

## Out of scope

- No agregar UI nueva en `/admin/auditoria` para visualizar los drift events. El audit_log ya tiene su pantalla genérica — ahí podés filtrar por `event_type='realtime_drift'`.
- No hacer threshold de alertas (ej: "alertar si > 5 drifts en 1h"). Solo log + indicador.
- No tocar `useGPSTracking` / `useMoviles` / `usePedidosRealtime`. Esa capa está bien.
- No persistir `lastSync` en sessionStorage. Vivir en memoria es suficiente.

## Hipótesis a confirmar con esta instrumentación

Después del deploy, en 1–2 días el usuario va a poder ver:

- **Si el indicador queda en 🟢 con números bajos de drift** → las técnicas funcionan, el "drift" que veía era visual/percibido.
- **Si el indicador queda en 🔴 permanente y nunca aparece toast** → el polling está fallando (probablemente H1: 401 por auth). Pasamos al fix de auth.
- **Si el indicador es 🟢 y aparecen muchos toasts de drift cada 60s** → el realtime está perdiendo eventos consistentemente y el polling los está atrapando. Tema de WS/red.
- **Si el indicador alterna 🟡/🟢 y rara vez aparece toast** → todo OK, drift mínimo.

## Verificar

- Que el toast no spamee (rate limit lógico ya cubierto por "no mostrar si added=0 && removed=0").
- Que el indicador no cause re-renders excesivos del dashboard. Usar `useMemo`/`useRef` donde haga falta.
- Que `sendAuditBatch` no falle si el audit endpoint está caído (ya tiene queue interna; verificar que no tira excepciones).
- Que la comparación `user?.isRoot === 'S'` se haga en el render (no en el efecto), así un cambio de user mid-session se respeta.
