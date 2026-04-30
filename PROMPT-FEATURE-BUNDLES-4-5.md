# Prompt para `/feature` — Bundles 4 y 5: #24 (repos) + #21 (monolitos)

**Cómo usarlo:**

1. Abrí una **sesión nueva** de Claude Code en `C:\Users\jgomez\Documents\Projects\trackmovil`
2. Tipeá `/feature` y pegá TODO el contenido desde la línea `# /feature` para abajo
3. El triage va a partir esto en ~14+ sub-features. Cada una corre el pipeline completo (analyst → architect → implementer → reviewer → qa-tester)
4. Mirá el progreso en localhost:4321 — vas a ver iteraciones por sub-feature

**Contexto previo:** los issues #9, #10, #11, #14, #22 ya están resueltos en branches:
- `fix/high-bundle-1-realtime-queue-leak` (a8f66e1, 50eafcb, 0883264) — #9 #10 #11
- `fix/high-bundle-2-logger-central` (34d8734, 5095e06, 97eacc0) — #14
- `fix/high-bundle-3-realtime-factory` (9f72f7b, 34f4524) — #22

Estas 3 branches están en `dev` LOCAL pero NO mergeadas. Los Bundles 4 y 5 deben arrancar desde `dev` (NO desde esas branches) — cada bundle/sub-feature en su propia branch independiente, mergeable después en cualquier orden.

---

# /feature

# Multi-intent: Fix de los 2 issues HIGH restantes — #24 (repos) y #21 (monolitos)

**Working dir:** `C:\Users\jgomez\Documents\Projects\trackmovil` (Next.js 16 + Supabase self-hosted)

**Reportes de referencia:**
- `AUDITORIA-EXHAUSTIVA-2026-04-30.md` — auditoría completa con los 60 hallazgos
- `PROMPT-FEATURE-FIX-7-ISSUES.md` — prompt original con análisis técnico de los 7 issues HIGH

**Issues #9, #10, #11, #14, #22 YA ESTÁN RESUELTOS** en branches `fix/high-bundle-1-*`, `fix/high-bundle-2-*`, `fix/high-bundle-3-*` (no mergeadas todavía). NO los toques.

## Multi-intent — fix los siguientes 2 issues con triage que decida partición

Triage: tenés autonomía para decidir cómo partir. **Ambos issues son grandes y deben iterarse en sub-features.** Sugerencia inicial:

### Bundle 4 — Issue #24: Repository pattern (8 sub-features × 1 entidad)

- **24.1** `zonasRepo` — la entidad más simple, ideal para validar el pattern
- **24.2** `puntosInteresRepo`
- **24.3** `empresasRepo`
- **24.4** `movilesRepo` (la más usada, +5 consumers)
- **24.5** `pedidosRepo`
- **24.6** `servicesRepo`
- **24.7** `userPreferencesRepo`
- **24.8** `lint-rule` que prohíba `import { supabase } from '@/lib/supabase'` desde `app/` y `components/` (solo permitido desde `lib/repositories/` y `lib/hooks/queries/`)

### Bundle 5 — Issue #21: Descomposición de monolitos (6+ sub-features)

- **21.1** Extraer 12 modales de `dashboard/page.tsx` a `next/dynamic` lazy imports
- **21.2** Extraer los 3 `setInterval` a `useDashboardPolling.ts`
- **21.3** Extraer lógica de filtros a `useDashboardFilters.ts`
- **21.4** Extraer reconciliación post-WS-reconnect a `useDashboardReconcile.ts`
- **21.5** Romper `MapView.tsx` (3132 LOC) — **1 layer por sub-feature**:
  - 21.5.a — `MovilesLayer.tsx`
  - 21.5.b — `PedidosLayer.tsx`
  - 21.5.c — `ZonasLayer.tsx`
  - 21.5.d — `PuntosInteresLayer.tsx`
- **21.6** Romper `MovilSelector.tsx` (1649 LOC) en `MovilSelectorList`/`Filters`/`Actions`

Si te parece mejor otra partición, decidila vos. Lo importante: **ningún PR debe pasar +800 LOC de cambios netos** y **ningún componente extraído debe pasar 400 LOC**.

## Restricciones globales

1. **Tests obligatorios** para todo cambio de lógica. Vitest configurado.
2. **NO modificar** auth, RLS, secretos, ENABLE_SECURITY_CHECKS, `.env*`. Esos issues CRITICAL van por otra branch.
3. **NO tocar** `as400-api/` (Python).
4. **Mantener compatibilidad** de API HTTP — nada de cambios breaking en paths/query params/shapes sin justificación explícita.
5. **NO bypass** de hooks git (`--no-verify`, `--no-gpg-sign`).
6. **Commits pequeños y frecuentes** dentro de cada sub-feature.
7. **Code-reviewer + qa-tester obligatorios** después de cada implementer. Iterar hasta APPROVED.
8. **NO instalar deps nuevas** sin que un sub-feature lo justifique explícitamente. SWR ya lo está, podés usarlo. Si necesitás otra, abortá y avisá.
9. **NO `any`/`as any`/`@ts-ignore`/`eslint-disable` nuevos** (excepto los preexistentes que estaban antes del bundle).
10. Idioma: **español** para PRs, comentarios y commits.

## Detalle por issue

### #24 — Repository pattern para Supabase (ITERAR — 8 sub-features)

**Problema:** ~19 componentes UI hacen `supabase.from(...)` directo. Cero capa de servicio. Cada modal/layer hace su propia query con sus filtros. La query "moviles activos" está duplicada en 3+ lugares. La lógica de scope-by-empresa se duplica con riesgo de filtrarla en un sitio y NO en otro → **data leak entre empresas**.

**Solución incremental — 1 entidad por sub-feature:**

#### Estructura objetivo

```
lib/repositories/
├── index.ts                  // re-exports
├── _types.ts                 // RepoError, ListParams base
├── zonasRepo.ts
├── puntosInteresRepo.ts
├── empresasRepo.ts
├── movilesRepo.ts
├── pedidosRepo.ts
├── servicesRepo.ts
└── userPreferencesRepo.ts

lib/hooks/queries/
├── useZonasQuery.ts          // SWR sobre el repo
├── usePuntosInteresQuery.ts
├── useEmpresasQuery.ts
├── useMovilesQuery.ts
├── usePedidosQuery.ts
├── useServicesQuery.ts
└── useUserPreferencesQuery.ts
```

#### Reglas de cada repo (OBLIGATORIO):

1. **Funciones puras async** que reciben TODOS los inputs explícitos.
2. **`allowedEmpresas: number[]` parámetro obligatorio** en cualquier función que devuelva data scoped por empresa. Fail-closed: si `allowedEmpresas.length === 0`, devolver `[]`.
3. **`escenarioId: number`** parámetro obligatorio donde aplique.
4. **Manejo de errores tipado** — `class RepoError extends Error { constructor(public op: string, public cause: unknown)`.
5. **Type imports** — usar `Database` de `types/supabase.ts` (existe pero no está usado consistentemente; este es el momento).
6. **NO transformar shapes** — devolver lo que Supabase devuelve. Si la UI necesita transformaciones, hacerlas en el hook query, no en el repo.

#### Reglas de cada hook query:

1. **SWR** con `dedupingInterval: 5000` para deduplicación global.
2. **Key array** — `[entityName, ...inputsRelevantes]`.
3. **`revalidateOnFocus: false`** salvo justificación explícita.
4. **Inputs vienen del AuthContext** — `useAuth()` provee `escenarioId` y `allowedEmpresas`. NO aceptar `allowedEmpresas` como prop.

#### Migración de consumers por sub-feature:

Para cada entidad:
1. Crear repo + hook query + tests del repo.
2. Identificar consumers con `grep`: `grep -rn "supabase.from('<table>')" --include="*.tsx" --include="*.ts" app/ components/ contexts/`
3. Migrar consumer por consumer en el mismo PR.
4. Verificar `npm run build` + `npm test` después de cada consumer.
5. **Verificación final del sub-feature:** ningún `from('<table>')` queda en `app/` o `components/` (solo en `lib/repositories/`).

#### Sub-feature 24.8 — lint rule

Después de migrar las 7 entidades, agregar a `eslint.config.mjs`:

```js
{
  files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'contexts/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@/lib/supabase',
        message: 'Importá de @/lib/repositories — no acceder a Supabase directamente desde UI'
      }]
    }]
  }
}
```

**Tests del sub-feature 24.8:** correr `npm run lint` y verificar 0 errors.

### #21 — Descomposición de monolitos (ITERAR — 6+ sub-features)

**Paths:** `app/dashboard/page.tsx` (2548 LOC), `components/map/MapView.tsx` (3132 LOC), `components/ui/MovilSelector.tsx` (1649 LOC).

**Estrategia:** NO big-bang. Partir en sub-features incrementales.

#### Sub-feature 21.1 — Lazy modales en dashboard

Mover los 12 modales de `dashboard/page.tsx` a `next/dynamic`. Crear `components/dashboard/DashboardModalsContainer.tsx` que importe todos via `next/dynamic` con `ssr: false`. Verificar:
- `npm run build` reporta bundle inicial menor.
- HMR de `dashboard/page.tsx` baja de tiempo (medir con `next dev` cronómetro).

#### Sub-feature 21.2 — Hook useDashboardPolling

Extraer los 3 `setInterval` actuales (líneas 672, 697, 1730 según auditoría) a `lib/hooks/dashboard/useDashboardPolling.ts`. El hook debe:
- Pausar polling cuando la pestaña no está visible (`useTabVisibility`).
- Cleanup correcto de intervals en unmount.
- Tests con `vi.useFakeTimers()` que verifiquen frecuencia + cleanup.

#### Sub-feature 21.3 — Hook useDashboardFilters

Extraer toda la lógica de filtros (visibilidad, scope, filterBar) del dashboard a `lib/hooks/dashboard/useDashboardFilters.ts`. Tests del filtrado puro.

#### Sub-feature 21.4 — Hook useDashboardReconcile

Extraer la lógica de refetch tras reconexión WS a `lib/hooks/dashboard/useDashboardReconcile.ts`. Tests con mock del reconnect callback.

#### Sub-feature 21.5.a-d — Romper MapView en layers

`MapView.tsx` actualmente orquesta TODAS las capas de Leaflet. Romper en:
- `components/map/layers/MovilesLayer.tsx`
- `components/map/layers/PedidosLayer.tsx`
- `components/map/layers/ZonasLayer.tsx`
- `components/map/layers/PuntosInteresLayer.tsx`

`MapView.tsx` queda con ~200 LOC haciendo solo el wrapper de Leaflet + composición de layers.

**Cada layer en su propio sub-feature.** No hacer las 4 en uno solo.

#### Sub-feature 21.6 — Descomponer MovilSelector

`MovilSelector.tsx` (1649 LOC) → `MovilSelectorList`/`MovilSelectorFilters`/`MovilSelectorActions`.

#### Restricciones específicas de #21

- **Ningún archivo extraído debe pasar 400 LOC.** Si pasa, dividirlo más.
- Mantener tests existentes en verde.
- Agregar smoke tests con `@testing-library/react` (instalar si no está) que verifiquen que el dashboard renderiza sin errores con mocks de los hooks.
- **Comparar performance** entre antes y después con React DevTools Profiler — el FCP debe mantenerse igual o mejor; HMR debe bajar.

## Iteración por sub-feature

Para CADA sub-feature (de las ~14 totales):

1. **Spec** (analyst): qué se hace, criterios de aceptación, edge cases. Escrita en `intents/<sub-feature-id>/spec.md` dentro del run.
2. **Plan** (architect): archivos a tocar, orden, riesgos. Escrita en `intents/<sub-feature-id>/plan.md`.
3. **Diff** (implementer): cambios reales + commits.
4. **Review** (code-reviewer): APPROVED o CHANGES_REQUESTED. Iterar hasta APPROVED.
5. **Test report** (qa-tester): PASSED o FAILED. Iterar hasta PASSED.
6. **Doc update** (documenter): entrada en `docs/CHANGELOG.md`.

Cada sub-feature en su propia branch: `fix/high-24-N-<entidad>` o `fix/high-21-N-<componente>`.

## Definition of Done global

- [ ] Todos los tests existentes en verde
- [ ] Tests nuevos cubren los caminos críticos (scope multi-empresa, fail-closed, layer rendering)
- [ ] `npm run build` exitoso después de cada sub-feature
- [ ] `npm run lint` sin errors nuevos
- [ ] Para Bundle 4: lint rule activa al final, 0 imports directos de `@/lib/supabase` desde UI
- [ ] Para Bundle 5: ningún componente >400 LOC, dashboard.tsx <250 LOC, MapView.tsx <250 LOC
- [ ] Documentación actualizada en `docs/CHANGELOG.md`

## Output esperado

Por cada sub-feature, todos los stages outputs en `~/.claude/runs/<run-id>/intents/<sub-id>/`. Al final del run, resumen ejecutivo con:
- Cantidad de sub-features ejecutadas
- LOC eliminadas / agregadas
- Tests agregados
- Bundle size delta (si medible)
- Performance delta (si medible)

## Notas finales

- **NO mergear** las branches de los Bundles 1, 2, 3 antes de arrancar — son independientes.
- **NO commits con secretos** — antes de cada commit: `git diff --staged | grep -i 'key\|secret\|password\|token'` como sanity check.
- **Telemetry primero, optimización después** — preferir runs visibles en el dashboard sobre runs rápidos sin trazabilidad.
- Si una sub-feature falla 3 veces en QA, **abortarla**, dejar nota en `lessons.md`, y continuar con la siguiente.
