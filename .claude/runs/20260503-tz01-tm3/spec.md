# Spec mínima (inline orquestador): Fix timezone bug — todayMontevideo() helper

## Pedido literal
Reemplazar ~24 ocurrencias del patrón `new Date().toISOString().split('T')[0]` por un helper
centralizado `todayMontevideo()` que devuelve la fecha correcta en hora Montevideo (America/Montevideo).

## Síntoma reportado
Entre las 21:00 y 23:59 hora Montevideo (UTC-3), el sistema muestra el día siguiente como fecha
actual, rompiendo filtros de pedidos, dashboard, mapa, indicadores, inputs de fecha (max=).

## Acceptance criteria
- [ ] AC1: A las 23:00 hora Montevideo día X, todo muestra día X (no X+1).
- [ ] AC2: A las 02:00 hora Montevideo (05:00 UTC), todayMontevideo() devuelve fecha local correcta.
- [ ] AC3: Tests unitarios con 4 escenarios de fechas mockeadas (ver request.md).
- [ ] AC4: Inputs <input type="date" max=...> no permiten día siguiente entre 21:00–23:59 Montevideo.
- [ ] AC5: Queries SQL en lib/db.ts filtran por día Montevideo, no UTC.
- [ ] AC6: Suite de tests existente sigue pasando (no regresiones).

## Áreas afectadas (de triage)
- lib/date-utils.ts (NUEVO — helper centralizado)
- lib/db.ts (5 ocurrencias)
- 6 archivos app/api/
- 5 ocurrencias en app/dashboard/page.tsx + 1 en stats/page.tsx
- 3 componentes map, 1 DashboardIndicators
- 4 inputs de fecha en Navbar, FloatingToolbar, TrackingModal, RouteAnimationControl
- __tests__/date-utils.test.ts (NUEVO — 4 test cases)

## Patrón existente a reutilizar
lib/import-helpers/gps-autocreate.ts:24 — `startOfDayMontevideoIso` ya usa Intl.DateTimeFormat
correctamente. El nuevo helper sigue exactamente la misma lógica pero devuelve solo YYYY-MM-DD.

## Restricciones
- No tocar pm2.config.js ni envvars
- No reescribir DatePicker custom
- No cambiar timestamps en pantalla (utils/pedidoDelay.ts fuera de scope)
- El helper debe funcionar en SSR (Node) y CSR (browser) sin diferencias
