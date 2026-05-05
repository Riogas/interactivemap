# Bug — Cambio en tabla `moviles` no se refleja en colapsable hasta F5

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Síntoma

Cuando el endpoint `/api/import/moviles` hace UPSERT en la tabla `moviles` (cambia un movil de inactivo→activo, o agrega uno nuevo), el cambio **no aparece en el colapsable de móviles** hasta que el usuario hace F5 (o pasen 60s del polling de reconcile, o se dispare silence-timeout).

## Causa raíz

El cliente **sí está suscrito a la tabla `moviles`** vía `useMoviles` hook (línea 232 de `lib/hooks/useRealtimeSubscriptions.ts`). El evento UPDATE llega al `RealtimeProvider`. Pero el callback `onMovilChange` (líneas 53–56 de `components/providers/RealtimeProvider.tsx`) solo:

```ts
const onMovilChange = useCallback((movil: MovilSupabase) => {
  setLatestMovil(movil);          // se guarda pero el dashboard NO lo lee
  setLastEventAt(Date.now());      // solo se usa para silence detection
}, []);
```

**No dispara `fetchPositions()`** que es lo que refrescaría la lista del dashboard (incluyendo el `enrichMovilesWithExtendedData` que trae `estadoNro`).

El filtro del colapsable (`MovilSelector.tsx:258-264`) filtra client-side por `movil.estadoNro`. Ese campo viene del enrich (call a `/api/moviles-extended`). Hasta que el dashboard re-fetchee, el filtro sigue trabajando con datos viejos.

## Fix propuesto

Hacer que cualquier evento UPDATE/INSERT/DELETE en la tabla `moviles` dispare un refetch del dashboard, con debounce de 500ms para no spamear cuando el importer envía un lote (ej: 50 móviles → 50 eventos en <1s → 1 solo refetch al final).

### Implementación

1. **`components/providers/RealtimeProvider.tsx`** — exponer un nuevo callback `onMovilEvent: (() => void) | null` y un `setOnMovilEvent` setter, paralelo al `onReconnect` ya existente. En `onMovilChange`, además de actualizar `latestMovil/lastEventAt`, llamar a `onMovilEvent` (si está seteado). Sin debounce a este nivel — el debounce vive en el dashboard (responsabilidad del consumidor).

2. **`app/dashboard/page.tsx`** — registrar `setOnMovilEvent(debouncedFetchPositions)` con un useEffect, paralelo al `setOnReconnect` ya existente. El `debouncedFetchPositions` se construye con un `useRef` o lib mínima (lodash.debounce probablemente NO está; hacer un debounce inline de ~10 líneas). Debounce window: **500ms**.

3. **Logs** — agregar `console.log('🚗 Cambio en tabla moviles detectado — refetch debounced')` para que un usuario root pueda verlo en el indicador / drift toast / DevTools.

4. **Audit log** — opcional pero útil: cuando el debounced refetch encuentra altas/bajas (ya pasa por `reportDrift` con trigger nuevo `'moviles_event'`). Agregar `'moviles_event'` al union `DriftTrigger` en `lib/realtime-drift.ts`.

5. **NO cambiar `useMoviles`** internamente — solo el wiring en el provider.

## Acceptance Criteria

1. **AC1** — Importar un movil que cambia de `mostrar_en_mapa: false` a `mostrar_en_mapa: true`: el colapsable debe mostrarlo dentro de **<2s** de la respuesta del UPSERT (sin F5, sin esperar 60s de polling).

2. **AC2** — Importar un movil que cambia de `estado_nro: 3` (no activo) a `estado_nro: 0` (activo): el colapsable, con el filtro "actividad: activo" aplicado, debe incluirlo **<2s** después.

3. **AC3** — Importar un lote de 50 móviles que cambian estado al mismo tiempo: debe ejecutarse **1 sólo** `fetchPositions()` al final del debounce, no 50.

4. **AC4** — Test unitario del debounce: dado un stream de 5 eventos con <500ms entre cada uno, el callback final debe ejecutarse **1 sola vez** ~500ms después del último evento.

5. **AC5** — Test que verifica que `setOnMovilEvent` recibe el callback del dashboard y `onMovilChange` lo invoca correctamente.

6. **AC6** — La suite existente (372 tests) sigue pasando, sin regresiones en `useMoviles`/`useGPSTracking`/`usePedidosRealtime`.

7. **AC7** — Si `onMovilEvent` está null (no registrado todavía), `onMovilChange` no debe explotar — debe seguir actualizando `latestMovil/lastEventAt` como hoy.

8. **AC8** — Cuando el refetch encuentra drift, el toast de drift sale con trigger `moviles_event` (gateado por isRoot, como ya está).

## Out of scope

- No cambiar el shape del payload de `useMoviles`.
- No cambiar el endpoint `/api/all-positions` ni `/api/moviles-extended`.
- No modificar el filtro client-side de `MovilSelector` — el problema es propagación de datos, no el filtro.
- No tocar el polling de 60s ni el silence-timeout ni el visibility-refetch.
- No agregar UI nueva (sigue usando los chips/toasts existentes).

## Verificar

- Que el debounce no haga `fetchPositions` mientras `selectedDate !== today` (modo histórico). El gating ya existe en los otros refetchers.
- Que el cleanup del useEffect en el dashboard borre el debounce timer al desmontar.
- Que el callback registrado vía `setOnMovilEvent` sea estable (no se reregistre en cada render — usar `useCallback` con deps mínimas).
- Que un INSERT (móvil nuevo) también dispare el refetch, no solo UPDATE.
