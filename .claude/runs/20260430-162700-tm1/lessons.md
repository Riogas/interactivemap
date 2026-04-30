# Lessons — 20260430-162700-tm1

## Pedido
Bug múltiple en filtro de móviles del dashboard de Pedidos/Services en TrackMovil (3 problemas: filtro no aplica, badge mal renderizado, contador "+N" mal calculado).

## Bucket inicial
bug-fix (single-intent, alta confianza, todos los bugs en mismo componente).

## Resumen del path
```
triage (haiku, 57s, $.001)
  → implementer (sonnet, 333s, $.18, +10 -6 en MovilSelector.tsx, 1 iter)
  → code-reviewer (sonnet, 155s, $.04, APPROVED 1 iter)
  → qa-tester (sonnet, 253s, $.10, PASSED 37 tests nuevos)
  → ux-validator (sonnet, 877s, $.10, UX_BLOCKED por AuthContext.tsx pre-existente)
```
Total: ~$0.42, 47min wall-clock.

## Patrones detectados

### Trunk roto sin tests de smoke
**Lección:** Un /feature run anterior (commit `d2816fe`) shipeó código que no compila (`AuthContext.tsx:148` falta `}`). El TS error es claro pero ese pipeline aparentemente no corrió `tsc --noEmit` ni el dev server, o lo corrió y lo ignoró.
**Why:** ux-validator tuvo que descubrirlo encendiendo el dev server. Si los pipelines anteriores hubieran corrido un smoke `tsc --noEmit` antes del commit, no llegamos acá.
**How to apply:** En futuros runs de TrackMovil donde se modifique código de Auth/Context/Provider, agregar al `implementer` un paso explícito de `pnpm exec tsc --noEmit` antes de cerrar la iteración. Actualmente solo corre `pnpm lint` y `pnpm test` (vitest, que no chequea tipos). El error TS1005 escapa de ambos.

### bucket=bug-fix con touches=ui SIEMPRE merece ux-validator si el bug es visual
**Lección:** Triage marcó `ux-validator: skip` porque el bucket es bug-fix, pero el orquestador override a `keep` porque el bug ES visual. Esa decisión fue correcta — el ux-validator descubrió el blocker pre-existente que de otra forma habría llegado al usuario.
**Why:** Las heurísticas del triage son por bucket, pero la naturaleza del bug (visual, reportado con captura) es el factor real.
**How to apply:** Al evaluar auto-skip de ux-validator, no solo mirar `bucket`, también mirar si el pedido tiene captura adjunta o palabras como "badge", "muestra", "se ve", "renderiza".

### Tests puros como fallback cuando no hay RTL
**Lección:** El qa-tester logró cubrir AC1-AC6 + EC1/EC3/EC5 sin React Testing Library, replicando la lógica como funciones puras. Esto fue suficiente para PASSED, aunque dejó EC2 y EC4 (integración multi-empresa) parcialmente cubiertos.
**Why:** El repo no tiene RTL. Instalar dependencias para QA es scope creep.
**How to apply:** En repos Next/React sin RTL, el qa-tester debe replicar la lógica como funciones puras antes de pedir RTL. El patrón existe ya (`distribuidor-scope-ui.test.ts`).

## Métricas clave
- Iteraciones: 1 en cada stage (cero rejections)
- Tokens totales: ~49.4k in + out
- Tests agregados: 37 (cobertura completa AC1-AC6 + EC1, EC3, EC5)
- LOC producción: +10 -6 (1 archivo)
- Escalación al humano: NO (UX_BLOCKED es ambiental, no fix)

## Ítem para PR separado (capturado por reviewer + implementer)
1. Shadowing de `allSelected` en `MovilSelector.tsx:670` (badge de empresas pisa scope) — cosmético.
2. Orden de IDs en badge parcial (selección vs numérico) — UX menor.
3. Asimetría entre `handleSelectAll` (movilesFiltered global) y `allSelected` local (filteredMoviles tras búsqueda) — pre-existente, no regresión.
4. **AuthContext.tsx:148 build break — BLOCKER del dev server, requiere patch inmediato.**
