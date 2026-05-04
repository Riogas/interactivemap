# Bug Report — Fecha actual mal calculada en TZ Montevideo

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Síntoma

Usuario entró a TrackMovil el **02/05/2026 a las 21:40 hora Montevideo (UTC-3)** y el sistema mostraba como "fecha actual" **03/05/2026** — un día por delante. Esto rompe filtros de pedidos del día, dashboard, mapa, indicadores, inputs de fecha (`max`), etc. La ventana del bug es **21:00–23:59 hora Montevideo cada día** (3 horas).

## Causa raíz

Hay **~24 ocurrencias** del patrón:

```ts
new Date().toISOString().split('T')[0]
```

`Date.prototype.toISOString()` está definido por especificación ECMA para devolver SIEMPRE en UTC, sin importar el TZ del proceso/navegador. Como Montevideo es UTC-3, entre las 21:00 y 23:59 hora local, UTC ya marca el día siguiente → el `.split('T')[0]` devuelve la fecha de mañana.

`pm2.config.js:30` setea `TZ: America/Montevideo`, pero **no afecta a `toISOString()`** (afecta solo a `toLocaleString` / `Date#toString`). Y la mayoría de los usos están en componentes React que corren en el navegador del cliente, donde ni siquiera aplica el TZ del server.

## Solución propuesta

Crear/usar un helper centralizado **`todayMontevideo()`** (y `todayInTimezone(tz)` opcional) que devuelva el `YYYY-MM-DD` correcto en hora Montevideo usando `Intl.DateTimeFormat`:

```ts
// lib/date-utils.ts (nuevo)
export function todayMontevideo(now: Date = new Date()): string {
  // 'en-CA' produce YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
```

Ya existe el patrón correcto en `lib/import-helpers/gps-autocreate.ts:24` (`startOfDayMontevideoIso`). Reutilizar la lógica o factorizar.

## Archivos a modificar

Reemplazar `new Date().toISOString().split('T')[0]` por `todayMontevideo()` en:

**Server-side / API routes:**
- `lib/db.ts` (líneas 17, 73, 179, 240, 267 — algunos tienen `+ ' 00:00:00'`)
- `app/api/all-positions/route.ts:65`
- `app/api/moviles-extended/route.ts:32` (`hoy`)
- `app/api/movil-session/[id]/route.ts:40`
- `app/api/movil/[id]/route.ts:29`
- `app/api/pedidos-pendientes/route.ts:17`
- `app/api/pedidos-servicios-pendientes/[movilId]/route.ts:19`

**Client-side / componentes React:**
- `app/dashboard/page.tsx` (líneas 319, 678, 700, 729, 1198)
- `app/dashboard/stats/page.tsx:221`
- `components/dashboard/DashboardIndicators.tsx:276`
- `components/map/MovilInfoPopup.tsx:89`
- `components/map/ServiceInfoPopup.tsx:39`
- `components/map/PedidoInfoPopup.tsx:40`

**Inputs `max=` (date pickers):**
- `components/layout/Navbar.tsx:75`
- `components/layout/FloatingToolbar.tsx:121`
- `components/ui/TrackingModal.tsx:182`
- `components/map/RouteAnimationControl.tsx:262`

## Acceptance Criteria

1. **AC1** — A las 23:00 hora Montevideo del día X, el dashboard, mapa, indicadores y filtros muestran/usan **día X**, no día X+1.
2. **AC2** — A las 02:00 hora Montevideo (05:00 UTC), `todayMontevideo()` devuelve la fecha del día actual local Montevideo.
3. **AC3** — Tests unitarios con fechas mockeadas para 4 escenarios:
   - 02/05 21:40 Montevideo (00:40 UTC del 03/05) → debe devolver `'2026-05-02'`
   - 02/05 23:59 Montevideo (02:59 UTC del 03/05) → debe devolver `'2026-05-02'`
   - 03/05 00:01 Montevideo (03:01 UTC del 03/05) → debe devolver `'2026-05-03'`
   - 02/05 12:00 Montevideo (15:00 UTC del 02/05) → debe devolver `'2026-05-02'`
4. **AC4** — Inputs `<input type="date" max=...>` no permiten seleccionar el día siguiente cuando son las 21:00–23:59 Montevideo.
5. **AC5** — Los queries SQL del backend (lib/db.ts) filtran correctamente por el día Montevideo, no UTC.
6. **AC6** — Suite de tests existente sigue pasando (no regresiones).

## Out of scope

- No tocar timezone del server pm2 ni envvars.
- No reescribir el componente de calendario (DatePicker custom) — solo reemplazar el cálculo de "hoy".
- No cambiar la representación de timestamps en pantalla (ya hay `utils/pedidoDelay.ts` con su propia lógica).

## Verificar

- Que el helper funcione igual en SSR (Node con `TZ=America/Montevideo`) que en CSR (navegador con cualquier TZ del usuario).
- Que `Intl.DateTimeFormat` con `timeZone: America/Montevideo` esté soportado en el target de TS/Node del proyecto (Node 22 + browsers modernos: sí).
- Que NO se rompa la lógica del seed GPS de `gps-autocreate.ts` (ya estaba correcta).
