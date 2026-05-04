# Implementacion — runId: 20260504-drift-tm5

## Archivos creados
- `lib/realtime-drift.ts` — helper con getSyncColor, buildDriftAuditEvent, reportDrift, reportDriftFetchFailed, LastSyncState, DriftTrigger
- `components/dashboard/RealtimeDriftIndicator.tsx` — chip 🟢🟡🔴 + boton Resync ahora
- `__tests__/realtime-drift.test.ts` — 23 tests de funciones puras y gating

## Archivos modificados
- `lib/audit-client.ts` — +1 linea: union extendido con 'realtime_drift' | 'realtime_drift_fetch_failed'
- `app/dashboard/page.tsx` — +99/-15: import, lastSync state, isRoot var, fetchPositions retorno, 4 useEffects instrumentados, props a MovilSelector
- `components/ui/MovilSelector.tsx` — +24/-1: imports, 4 nuevas props, RealtimeDriftIndicator en header de moviles

## Decisiones de implementacion
1. Toast via `toast()` directo en reportDrift (no componente separado) — menos re-renders
2. isRoot pasado como `boolean` a MovilSelector (no el objeto user) — bajo acoplamiento
3. fetchPositions devuelve { added, removed, success } — cambio minimo de firma
4. fetchPositionsWithReconnectReport wrapper para el trigger de reconexion — limpio y testeable
5. pollingSeconds normalizado inline en page.tsx (null→60, 0→60, −1→60) — consistente con el useEffect de polling existente

## Verificaciones
- tsc --noEmit: CLEAN
- ESLint nuevos archivos: CLEAN
- vitest run: 365/365 PASSED
