# Spec mínima (inline orquestador): Dashboard lifecycle bugs — selectedDate persistence + realtime drift

## Pedido literal
Fix dos bugs relacionados al ciclo de vida del dashboard:
1. F5 resetea la fecha seleccionada (selectedDate no persiste).
2. Drift del contador de móviles en realtime (reconnect no hace refetch).

## Síntomas reportados
- Bug 1: Cambiar fecha a 3 días atrás, hacer F5 → fecha vuelve a hoy.
- Bug 2: Dashboard dice "80 móviles", F5 corrige a 82 o 78.

## Acceptance criteria
- AC1: Cambiar fecha + F5 → sigue siendo la misma fecha.
- AC2: Logout → fecha vuelve a today al relogi.
- AC3: Cerrar pestaña → fecha vuelve a today (sessionStorage, no localStorage).
- AC4: Valor inválido en sessionStorage → usar todayMontevideo() y limpiar.
- AC5: Reconexión GPS → fetchPositions() automático.
- AC6: Reconexión useMoviles → refetch automático.
- AC7: realtimePollingReconcileSeconds 0/null → default 60s (solo -1 desactiva).
- AC8: realtimeRefetchOnVisible null/undefined → default true.
- AC9: Tests existentes siguen pasando.
- AC10: Tests nuevos para reconnect callbacks y defaults de preferencias.

## Áreas afectadas
- app/dashboard/page.tsx (selectedDate init, setters, reconcile defaults)
- contexts/AuthContext.tsx (sessionStorage.removeItem en logout)
- lib/hooks/useRealtimeSubscriptions.ts (useGPSTracking + useMoviles reconnect)
- components/providers/RealtimeProvider.tsx (pasar onReconnect a los hooks)
- __tests__/ (tests nuevos)
