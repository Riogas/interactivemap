# Lessons — 20260504-drift-tm5

## Pedido
Instrumentacion visible de drift de realtime (toast + indicador 🟢🟡🔴 + audit_log) al dashboard.
Solo root para UI, audit_log para todos.

## Bucket inicial
small-feature (alta confianza, spec detallada del usuario)

## Resumen del path
triage (inline, 10s) → analyst (inline, 2min) → architect (inline, 3min) → implementer (sonnet-inline, 15min) → code-reviewer (APPROVED, 1 iter) → qa (PASSED, 365/365) → ux (APPROVED)
Total: ~75min wall-clock, ~$0.48 estimado

## Patrones detectados

### fetchPositions con retorno de drift es backwards compatible
Cambiar `async () => void` a `async () => Promise<{ added, removed, success }>` en un useCallback
es TypeScript-safe porque `() => Promise<X>` es asignable a `() => void` (el retorno se ignora).
Esto permitio agregar la instrumentacion sin tocar el RealtimeProvider ni los call sites que no
necesitaban el retorno.

### Gating booleano como prop, no como objeto user completo
Pasar `isRootUser={user?.isRoot === 'S'}` (boolean) en vez del objeto `user` completo a
MovilSelector reduce el acoplamiento. El componente no sabe nada de AuthContext. Patron
replicable para cualquier otro feature gateado por rol.

### useCallback wrapper para instrumentar un callback existente
En vez de modificar el callback original `fetchPositions` para que haga audit/toast,
se crea un wrapper `fetchPositionsWithReconnectReport` para el trigger de reconexion.
El original queda limpio, el wrapper agrega la capa de observabilidad. Mas testeable.

### Chip de diagnostico como componente hoja con setInterval propio
Un `setInterval(1000)` en un componente hoja (RealtimeDriftIndicator) hace re-renders
de 1 componente, no del arbol completo. El parent solo re-renderiza cuando cambia `lastSync`.
Patron correcto para indicadores que necesitan actualizarse continuamente.

## Metrica clave
- Iteraciones: 1 en cada stage (sin rejections)
- Tests nuevos: 23 (cobertura completa de funciones puras)
- LOC produccion: ~200 nuevas
- tsc --noEmit: CLEAN
- Regresiones: 0 (342/342 previos siguen pasando)
- Escalacion al arbiter: NO
- Escalacion al humano: NO
