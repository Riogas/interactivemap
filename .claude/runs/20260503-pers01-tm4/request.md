# Bug Report — Persistencia de selectedDate + Drift de realtime al hacer F5

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Problema 1 — F5 resetea la fecha seleccionada

**Síntoma:** Si el usuario cambia la fecha del dashboard (ej: a 3 días atrás), los datos cargan correctamente. Pero al apretar F5, la fecha vuelve a hoy.

**Comportamiento esperado:** la fecha seleccionada debe persistir a través de F5 y permanecer hasta que el usuario haga logout (al volver a loguear, sí debe arrancar en la fecha de hoy).

**Causa raíz** — `app/dashboard/page.tsx:312`:
```ts
const [selectedDate, setSelectedDate] = useState<string>(() => {
  // inicializa con todayMontevideo() o similar
});
```
`useState` se ejecuta en cada montaje (que F5 dispara). No hay `sessionStorage`/`localStorage`.

**Fix propuesto:**
- En el inicializador del `useState`, leer de `sessionStorage.getItem('trackmovil:selectedDate')`. Si existe y es válido, usarlo. Si no, default a `todayMontevideo()`.
- En cada `setSelectedDate(date)`, escribir `sessionStorage.setItem('trackmovil:selectedDate', date)`.
- En el flujo de **logout** (`contexts/AuthContext.tsx`), llamar `sessionStorage.removeItem('trackmovil:selectedDate')`.
- Usar `sessionStorage`, NO `localStorage` — así sobrevive a F5 pero NO a cerrar la pestaña ni a un nuevo login en otra pestaña.

## Problema 2 — Drift del contador de móviles en realtime

**Síntoma:** El usuario deja la pantalla del dashboard abierta con realtime activo. Después de un rato, el colapsable dice "80 móviles". Al hacer F5, el número cambia a 82 o 78. Es decir: el realtime está perdiendo o no aplicando algunos eventos, y la reconciliación solo ocurre con un refresh manual.

**Comportamiento esperado:** el dashboard debe reflejar la realidad sin necesidad de F5. Los analistas pueden estar tomando decisiones con números desactualizados.

**Causas raíz identificadas en `lib/hooks/useRealtimeSubscriptions.ts`:**

### 2.a — `useGPSTracking` (línea 62) NO tiene reconnect-refetch

Cuando el canal de Supabase Realtime se desconecta (network blip, throttling de tab en background, timeout) y reconecta, no se notifica al consumidor para que haga refetch del estado completo. Todos los eventos `INSERT/UPDATE` que ocurrieron durante la desconexión quedan **perdidos**. Compará con `usePedidosRealtime` (línea 405) que sí tiene `wasConnectedRef` + `onReconnect` callback y dispara refetch al reconectar (líneas 519–523).

**Fix:** replicar en `useGPSTracking` el patrón de `usePedidosRealtime`:
- Agregar `wasConnectedRef = useRef(false)` y parámetro `onReconnect?: () => void`.
- En `subscribe()` callback cuando `status === 'SUBSCRIBED'` y `wasConnectedRef.current === true`, llamar a `onReconnect()`.
- En el dashboard, pasar el `onReconnect` que llama a `fetchPositions()`.

### 2.b — `useMoviles` (línea 220) tampoco tiene retry/reconnect logic

Es la versión más simple: no tiene `setupChannel` con reintentos, no tiene `wasConnectedRef`, no tiene `onReconnect`. Si Supabase se desconecta, los cambios en la tabla `moviles` (un móvil que pasa a inactivo, un móvil nuevo) se pierden hasta F5.

**Fix:** aplicar el mismo patrón completo de `usePedidosRealtime` (setupChannel + retry + reconnect callback).

### 2.c — Reconciliación periódica es opcional/configurable

`app/dashboard/page.tsx:678` arranca un `setInterval` que llama a `fetchPositions/fetchPedidos/fetchServices` cada `preferences.realtimePollingReconcileSeconds`. Pero si la preferencia es `0` o `null`, **no corre**. Lo mismo para `realtimeRefetchOnVisible` (refetch al volver de tab en background).

**Fix:** cambiar el comportamiento default cuando la preferencia es 0/null/undefined:
- `realtimePollingReconcileSeconds`: default **60s** (no off).
- `realtimeRefetchOnVisible`: default **true** (no off).
- Mantener la posibilidad de que el usuario lo cambie en `PreferencesModal`, pero el "off" debe ser explícito (ej: `-1` o un toggle separado), no implícito por valor cero.

## Acceptance Criteria

### Persistencia de fecha
1. **AC1** — Cambiar la fecha a `2026-04-30` y hacer F5 → la fecha sigue siendo `2026-04-30`.
2. **AC2** — Cambiar la fecha a `2026-04-30`, hacer logout, volver a loguear → la fecha es `todayMontevideo()` (hoy).
3. **AC3** — Cerrar la pestaña, abrir una nueva → la fecha es `todayMontevideo()` (sessionStorage no sobrevive a cerrar la pestaña).
4. **AC4** — Si en `sessionStorage` hay un valor inválido (ej: `"invalid"`, `null`, una fecha futura mayor a hoy), usar `todayMontevideo()` y limpiar el valor inválido.

### Realtime drift
5. **AC5** — Simular desconexión + reconexión del canal `gps_latest_positions` (con eventos perdidos en el medio): al reconectar, el dashboard debe llamar a `fetchPositions` automáticamente y el contador queda consistente con el de la DB sin necesidad de F5.
6. **AC6** — Mismo escenario para `useMoviles` (canal `moviles`): al reconectar, el dashboard refetcha y el contador queda correcto.
7. **AC7** — Si `realtimePollingReconcileSeconds` está en `0`/`null`/`undefined` en preferencias, el sistema usa default **60s** y reconcilia. Solo se desactiva con valor explícito `-1`.
8. **AC8** — Si `realtimeRefetchOnVisible` está en `null`/`undefined`, default `true`. Al volver de tab inactiva, refetch automático.
9. **AC9** — La suite existente de tests sigue pasando.
10. **AC10** — Tests unitarios nuevos cubren: (a) reconnect callback en `useGPSTracking` y `useMoviles`, (b) defaults de las preferencias de reconciliación.

## Archivos a modificar (mapa preliminar)

- `app/dashboard/page.tsx` — selectedDate init/setters, defaults de reconciliación.
- `contexts/AuthContext.tsx` — limpiar `sessionStorage` en logout.
- `lib/hooks/useRealtimeSubscriptions.ts` — reconnect refetch en `useGPSTracking` (línea 62) y `useMoviles` (línea 220).
- `components/ui/PreferencesModal.tsx` — opcional, ajustar UI de "off explícito" si toca.
- `__tests__/` — tests nuevos (vitest).

## Out of scope

- No cambiar la arquitectura de Supabase Realtime (canales, filtros).
- No reescribir el `PreferencesModal` completo — solo si hace falta para "off explícito".
- No tocar el resto de hooks que ya tienen reconnect-refetch (`usePedidosRealtime`, `useServicesRealtime`).
- No persistir otros filtros del dashboard (empresas seleccionadas, etc.) — solo `selectedDate`.

## Verificar

- Que el `sessionStorage` no falle en SSR (Next.js): proteger con `typeof window !== 'undefined'`.
- Que el clean en logout efectivamente se ejecute antes de que el usuario sea redireccionado al login.
- Que el reconnect refetch no genere loops si Supabase reconecta repetidamente.
- Que el reconcile periódico de 60s NO fetch si el tab está oculto (combinarlo con visibility check para no quemar bandwidth innecesario).
