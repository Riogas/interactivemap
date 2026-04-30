# Prompt para `/feature` — Fix de 7 issues HIGH (TrackMovil)

Pegá el bloque de abajo (todo lo que está después de la línea `---`) en una nueva sesión Claude Code abierta en `C:\Users\jgomez\Documents\Projects\trackmovil`, después de `/feature `.

El prompt está armado para que el **triage decida la partición** (puede ser 1 run, 7 runs, o N runs intermedios), con las soluciones propuestas ya analizadas para que `analyst` y `architect` no tengan que redescubrir todo, y deje espacio para iterar en los issues largos (#21 y #24).

---

# /feature

# Fix de 7 issues HIGH detectados en auditoría exhaustiva 2026-04-30

**Working dir:** `C:\Users\jgomez\Documents\Projects\trackmovil` (Next.js 16 + Supabase self-hosted + Python FastAPI/AS400)

**Reporte completo:** ver `AUDITORIA-EXHAUSTIVA-2026-04-30.md` en la raíz del proyecto.

## Multi-intent — fix los siguientes 7 issues

Triage: tenés autonomía para decidir cómo partir esto. Sugerencia inicial:
- **Bundle 1 (rápidos, 1 PR):** #9, #10, #11 — fixes de hooks/queue/leak con bajo riesgo
- **Bundle 2 (medio):** #14 — logger central, toca ~50 archivos pero es mecánico
- **Bundle 3 (medio-grande):** #22 — refactor de hooks Realtime (factory)
- **Bundle 4 (grande, ITERAR):** #24 — repository pattern, 8 entidades a migrar incrementalmente
- **Bundle 5 (largo, ITERAR):** #21 — descomposición de monolitos (dashboard 2.5K LOC + MapView 3.1K LOC)

Si te parece mejor otra partición, decidila vos. Lo importante: **no dejar nada atrás** y que cada PR sea mergeable independientemente. Si un bundle es demasiado grande para una sola pasada, dividilo en sub-features y corré el pipeline para cada uno (analyst → architect → implementer → reviewer → qa-tester).

## Restricciones globales

1. **Tests obligatorios** para todo cambio de lógica. Vitest ya está configurado.
2. **No modificar el código de seguridad/auth** (`lib/auth-middleware.ts`, RLS, etc.) — son issues CRITICAL aparte que se resuelven en otra branch. Si tu fix toca esos paths, **avisá y abortá el sub-feature**.
3. **No tocar `as400-api/`** (Python) en estos fixes.
4. **Mantener compatibilidad**: nada de cambios breaking en API HTTP (cambio de paths, de query params, de shapes de respuesta) sin justificación explícita.
5. **NO bypassear hooks** ni con `--no-verify` ni con `--no-gpg-sign`. Si pre-commit falla, fix la raíz.
6. **Commits pequeños y frecuentes** dentro de cada bundle — facilita el code review.
7. **Code-reviewer + qa-tester son obligatorios** después de cada implementer. Si reviewer pide cambios, iterá hasta APPROVED.

## Detalle por issue

### #9 — Stale closure en useGPSTracking
- **Path:** `lib/hooks/useRealtimeSubscriptions.ts:169-183`
- **Síntoma:** loop infinito de WebSockets cuando hay error de red.
- **Solución propuesta:** reemplazar `useState retryCount` por `useRef retryCountRef`. Resetear a 0 en `SUBSCRIBED`. Backoff exponencial (1s, 2s, 4s, ..., max 30s).
- **Aplicar mismo fix a los otros 5 hooks** (`useMoviles`, `usePedidos`, `useEmpresasFleteras`, `usePedidosRealtime`, `useServicesRealtime`) — ojo, mejor todavía: factorizalos primero (#22) y este fix queda gratis.
- **Test:** mockear `supabase.channel().subscribe()` para emitir `CHANNEL_ERROR` en loop, verificar que para a los 5 retries.

### #10 — Race condition GPS batch + URL hardcoded
- **Path:** `lib/gps-batch-queue.ts:125-213, 284`
- **Problema 1:** `flush()` no es atómico — `this.queue = []` puede perder records insertados durante el flush.
- **Problema 2:** `createMissingMoviles` hace `fetch('http://localhost:3002/api/import/moviles')` sin api key.
- **Solución 1:** mutex via `flushPromise`. Usar `splice(0, length)` en vez de `= []`. En caso de error, re-`unshift` el batch al frente de la queue.
- **Solución 2:** env var `APP_BASE_URL` (default `http://localhost:3000`) + agregar header `x-api-key: process.env.INTERNAL_API_KEY`.
- **Test:** disparar 100 `addBatch()` concurrentes desde `Promise.all` y verificar que ningún record se pierde. Mock de `fetch` para `createMissingMoviles`.

### #11 — Memory leak URL.createObjectURL
- **Path:** `contexts/IncidentRecorderContext.tsx:358`
- **Solución:** crear hook `useObjectUrl(blob)` en `lib/hooks/useObjectUrl.ts` que llama `URL.createObjectURL` y `URL.revokeObjectURL` en cleanup del effect. Reemplazar el código inline.
- **Buscar otros `createObjectURL` en el repo** y migrarlos también: `grep -rn "createObjectURL" --include="*.ts" --include="*.tsx"`.
- **Test:** simular grabación + discard 50 veces, medir que `URL.revokeObjectURL` se llamó la misma cantidad de veces.

### #14 — Logger central con redacción
- **Paths:** `app/api/proxy/[...path]/route.ts:96-345`, `app/api/auth/login/route.ts:20`, y ~50 archivos más con `console.log/error/warn`.
- **Solución:**
  1. Crear `lib/logger.ts` con `pino` (o `winston` si preferís) — niveles `error/warn/info/debug`, redacción automática de keys sensibles (`authorization`, `cookie`, `token`, `password`, `apikey`, `secret`, `x-api-key`).
  2. Helper `debug(msg, obj)` que solo loguea si `LOG_VERBOSE=1`.
  3. Migrar todos los `console.*` a `logger.*` o `debug()`.
  4. Setear `LOG_LEVEL=info` y `LOG_VERBOSE=0` en `.env.production`.
- **Tests:** unit test de `redact()` con varios shapes anidados, validar que no hay strings con `Bearer `, `eyJ`, etc. en output.
- **Search asistido:** `grep -rn "console\." --include="*.ts" --include="*.tsx" app/ lib/ contexts/ components/` y migrar todo.

### #21 — Descomposición de monolitos (ITERAR — dividir en sub-features)
- **Paths:** `app/dashboard/page.tsx` (2548 LOC), `components/map/MapView.tsx` (3132 LOC), `components/ui/MovilSelector.tsx` (1649 LOC).
- **Estrategia:** **NO big-bang.** Partí en sub-features incrementales:
  - **Sub-feature 21.1:** Mover los 12 modales de `dashboard/page.tsx` a `next/dynamic` lazy imports en un nuevo `DashboardModalsContainer.tsx`. Verificar que el bundle inicial baja al menos 30%.
  - **Sub-feature 21.2:** Extraer los 3 `setInterval` a un hook `useDashboardPolling.ts`.
  - **Sub-feature 21.3:** Extraer la lógica de filtros a `useDashboardFilters.ts`.
  - **Sub-feature 21.4:** Extraer la lógica de reconciliación post-reconexión WS a `useDashboardReconcile.ts`.
  - **Sub-feature 21.5:** Romper `MapView.tsx` en `layers/MovilesLayer.tsx`, `layers/PedidosLayer.tsx`, `layers/ZonasLayer.tsx`, `layers/PuntosInteresLayer.tsx`. **1 layer por sub-feature** (queremos PRs chicos).
  - **Sub-feature 21.6:** Romper `MovilSelector.tsx` en `MovilSelectorList.tsx` + `MovilSelectorFilters.tsx` + `MovilSelectorActions.tsx`.
- **Cada sub-feature:** spec + plan + impl + reviewer + qa-tester completo. Después de cada uno, **comparar render performance** (idealmente con React DevTools Profiler) — el HMR debe bajar y el FCP debe mantenerse igual o mejor.
- **Restricción:** ningún componente extraído debe pasar 400 LOC. Si pasa, dividirlo más.
- **Tests:** mantener los tests existentes en verde + agregar smoke tests con `@testing-library/react` que verifiquen que el dashboard renderiza sin errores con un mock de los hooks.

### #22 — Factory de hooks Realtime
- **Path:** `lib/hooks/useRealtimeSubscriptions.ts` (712 LOC)
- **Solución:**
  1. Crear `lib/hooks/createRealtimeHook.ts` con la fábrica genérica que toma `{ table, channelPrefix, filter, idKey, events?, maxRetries? }`.
  2. La fábrica debe incluir el fix de #9 (`useRef` para retry, backoff exponencial, reset en SUBSCRIBED).
  3. Migrar los 6 hooks existentes a usar la fábrica:
     - `useGPSTracking` → `gps_latest_positions`
     - `useMoviles` → `moviles`
     - `usePedidos` y `usePedidosRealtime` (ojo: hay duplicación, decidí cuál es canónico) → `pedidos`
     - `useEmpresasFleteras` → `empresas_fleteras`
     - `useServicesRealtime` → `services`
  4. Mantener la API pública de cada hook **idéntica** (mismos exports, mismos tipos de retorno) — los consumers no deberían cambiar.
- **Tests:** mockear `supabase.channel` y verificar que la fábrica:
  - Crea canal con nombre único (timestamp en nombre)
  - Aplica el filter correctamente
  - Maneja INSERT/UPDATE/DELETE en el Map
  - Reconecta con backoff hasta maxRetries
  - Hace cleanup del canal en unmount
- **Verificación final:** archivo `useRealtimeSubscriptions.ts` debe terminar con menos de 200 LOC (target: ~150).

### #24 — Repository pattern para Supabase (ITERAR — 1 entidad por sub-feature)
- **Paths afectados:** ~19 componentes UI con `supabase.from(...)` directo.
- **Estrategia:** crear `lib/repositories/` y `lib/hooks/queries/` (con SWR) y migrar **1 entidad por sub-feature**.
- **Orden sugerido (de menos a más complejo):**
  - **Sub-feature 24.1:** `zonasRepo` + `useZonasQuery` + migrar consumers (`ZonasModal`, `ZonasLayer`, etc.)
  - **Sub-feature 24.2:** `puntosInteresRepo` + hook + consumers
  - **Sub-feature 24.3:** `empresasRepo` + hook + consumers
  - **Sub-feature 24.4:** `movilesRepo` + hook + consumers (este es el más usado, +5 consumers)
  - **Sub-feature 24.5:** `pedidosRepo` + hook + consumers
  - **Sub-feature 24.6:** `servicesRepo` + hook + consumers
  - **Sub-feature 24.7:** `userPreferencesRepo` + hook + consumers
  - **Sub-feature 24.8 (final):** lint rule que prohíba importar `@/lib/supabase` desde `app/` y `components/` (solo permitido desde `lib/repositories/` y `lib/hooks/queries/`).
- **Reglas de cada repo:**
  - Funciones puras async que reciben todos los inputs explícitos (incluido `allowedEmpresas`).
  - **Fail-closed:** si `allowedEmpresas.length === 0`, devolver `[]` (no permitir queries sin scope).
  - Usar `getServerSupabaseClient()` para escrituras server-side, `supabase` cliente para lecturas browser.
  - Manejo de errores tipado: `class RepoError extends Error`.
- **Tests:** unit test por repo con mock de `@supabase/supabase-js`. Verificar fail-closed y scope.
- **Cada sub-feature: el implementer debe correr `npm run build` y `npm test` para verificar que no rompió nada.**

## Iteración

Para los issues **#21 y #24**, el triage debe correr el pipeline completo (analyst → architect → implementer → reviewer → qa-tester) **una vez por sub-feature**, no para todo el bundle. Si una sub-feature falla en QA, iterar hasta verde antes de pasar a la siguiente.

Para los demás (#9, #10, #11, #14, #22), pueden ir en un solo run cada uno.

## Definition of Done global

- [ ] Todos los tests existentes siguen en verde
- [ ] Tests nuevos cubren los caminos críticos (race conditions, retries, fail-closed)
- [ ] `npm run build` exitoso
- [ ] `npm run lint` sin nuevos errores (warnings OK)
- [ ] No se introdujeron `// @ts-ignore`, `// eslint-disable`, ni casts `as any` nuevos
- [ ] Cada PR tiene descripción con: qué cambió, por qué, cómo testear, posibles regresiones
- [ ] Checkpoint: tras cada sub-feature, el documenter actualiza `docs/CHANGELOG.md` con la entrada correspondiente

## Output esperado

Por cada sub-feature:
1. **Spec** (analyst): qué se va a hacer, criterios de aceptación, edge cases.
2. **Plan** (architect): archivos a tocar, orden, riesgos.
3. **Diff** (implementer): cambios reales + commits.
4. **Review** (code-reviewer): APPROVED o CHANGES_REQUESTED con lista.
5. **Test report** (qa-tester): PASSED o FAILED con repros.
6. **Doc update** (documenter): entrada de changelog.

Al final del bundle entero: un **resumen ejecutivo** del run con métricas (LOC eliminadas, tests agregados, bundle size delta, performance delta si medible).

## Notas finales

- Si alguno de los fixes interactúa con los issues CRITICAL pendientes (RLS, multi-tenancy server-side, ENABLE_SECURITY_CHECKS, secretos), **detener** ese sub-feature y dejar nota en el reporte. Esos van por otra branch.
- Priorizá la **calidad** sobre la velocidad. Si un sub-feature requiere más tiempo para hacerlo bien, tomalo.
- **No commits con secretos** — verificar `.gitignore` antes de cada commit, usar `git diff --staged | grep -i 'key\|secret\|password\|token'` como sanity check.
- Idioma: español para PRs, comentarios y docs.
