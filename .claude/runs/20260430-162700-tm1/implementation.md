# Implementation: Fix filtro de móviles en dashboard

## Estado
Completa (sin desviaciones del plan)

## Archivos modificados

| Archivo | Resumen del cambio | Lineas |
|---------|-------------------|--------|
| `components/ui/MovilSelector.tsx` | 3 fixes quirurgicos: filtro pedidos, filtro services, badge | +10 -6 |

## Causa raiz de cada bug

### Bug 1 — Filtro no aplica (pedidos/services muestran sin asignar e inactivos)
**Lineas afectadas:** 315 (pedidos), 439 (services)

La condicion `return !isPartialEmpresa` dentro del bloque `if (selectedMoviles.length > 0)` dejaba pasar los pedidos/services sin movil asignado cuando `hideUnassigned` era `false` (caso de usuario root con todas las empresas seleccionadas). La spec AC1/AC2 dice que cuando hay 1+ moviles seleccionados, los pedidos/services sin asignar nunca deben aparecer, independientemente del estado de `isPartialEmpresa`.

**Fix:** `return !isPartialEmpresa` → `return false` en ambos filtros.

Nota sobre inactivos: los moviles inactivos que esten en `selectedMoviles` siguen pasando — esto es correcto porque el usuario los selecciono explicitamente. Los inactivos que NO esten en `selectedMoviles` ya son bloqueados por la condicion `selectedMoviles.some(id => Number(id) === Number(pedido.movil))`. La spec no exige filtrar inactivos del estado `movil` del pedido; exige que solo aparezcan pedidos de moviles seleccionados. Eso ya funciona con el fix de "sin asignar".

### Bug 2 — Badge muestra IDs en lugar de "Todos"
**Linea afectada:** 646 (original)

`const allMovilesSelected = selectedMoviles.length === moviles.length` usaba `moviles` (la prop global, ej. 300 moviles) en vez de `filteredMoviles` (los visibles en el colapsable, ej. 80). Cuando el usuario tiene 80 del colapsable seleccionados, `80 !== 300` → condicion falsa → badge mostraba IDs.

**Fix:** Reemplazar `allMovilesSelected` por la variable `allSelected` ya calculada en linea 293 (`filteredMoviles.every(m => selectedMoviles.includes(m.id))`), que compara contra los moviles visibles en el colapsable.

### Bug 3 — Contador "+N" mal calculado
**Linea afectada:** 653 (original)

El "+200" que veia el usuario era una consecuencia directa del Bug 2: como `allMovilesSelected` era falso, el badge entraba al branch de "parcial" y calculaba `selectedMoviles.length - 5 = 205 - 5 = 200`. Una vez corregido Bug 2, `allSelected` es verdadero y el badge muestra "Todos".

Para el caso de seleccion parcial genuina, el calculo `selectedMoviles.length - VISIBLE_IDS` es correcto (ej: 7 seleccionados → 5 visibles + "+2"). Esto coincide con la spec AC5 ("N = rebalse de los seleccionados que no caben en el badge").

## Cambios aplicados

| Archivo:Linea | Que cambio |
|---------------|-----------|
| `MovilSelector.tsx:315` | `return !isPartialEmpresa` → `return false` (filtro pedidos sin asignar) |
| `MovilSelector.tsx:439` | `return !isPartialEmpresaSvc` → `return false` (filtro services sin asignar) |
| `MovilSelector.tsx:646-657` | Badge: `allMovilesSelected` (basado en `moviles.length`) → `allSelected` (basado en `filteredMoviles`). Variable `VISIBLE_IDS = 5` extraida para claridad. |

## Decisiones de diseno no triviales

- **No se toco `isPartialEmpresa`/`hideUnassigned` en el branch `else if`** (lineas 322-332 pedidos, 444-453 services). Ese branch cubre el caso "sin moviles seleccionados pero empresa parcial" — comportamiento correcto que no cambia.
- **`allSelected` ya existia** en linea 293 para el boton "Seleccionar Todos/Deseleccionar Todos". Reutilizarlo en el badge es natural y evita duplicacion.
- **Se mantiene `moviles` como referencia** en el badge para el caso "Ninguno" (`noneSelected = selectedMoviles.length === 0`) — correcto porque no depende del denominador.

## Output de lint y tests

```
pnpm lint: Solo warnings preexistentes. Ningun error nuevo introducido.
pnpm test: 258 passed (258) — 9 test files, todos verdes.
tsc --noEmit: Error preexistente en contexts/AuthContext.tsx:436 ('}' expected) — confirmado preexistente via git stash antes/despues.
```

## Deviaciones de la spec

Ninguna.

## Cuarto bug encontrado (anotado, no corregido)

En la linea 653 del badge, cuando hay seleccion parcial y `selectedMoviles.length > VISIBLE_IDS`, los IDs mostrados en el badge son los primeros 5 del array `selectedMoviles` — que puede estar en cualquier orden (orden de seleccion). No estan ordenados numericamente. El usuario podria ver "Moviles: 252, 106, 330, 147, 250 +2" en lugar de "106, 147, 250, 252, 330 +2". No es un bug funcional pero puede parecer inconsistente. Candidato para un fix separado.
