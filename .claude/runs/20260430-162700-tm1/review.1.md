# Review: Fix filtro de móviles en dashboard (MovilSelector.tsx)

## Veredicto
APPROVED

## Cumplimiento de la spec

- [x] AC1. Al seleccionar 1+ móviles, pedidos muestran exclusivamente los de esos móviles (sin asignar bloqueados con `return false` en línea 317).
- [x] AC2. Al seleccionar 1+ móviles, services muestran exclusivamente los de esos móviles (idem línea 439).
- [x] AC3. "Seleccionar todos" muestra badge "Móviles: Todos" — ahora usa `allSelected` (filteredMoviles.every) en lugar de comparar contra `moviles.length` global.
- [x] AC4. "Seleccionar todos" en el colapsable llama `onSelectAll` → `handleSelectAll` en dashboard, que setea `movilesFiltered` (sin hidden). Comportamiento idéntico al primer login.
- [x] AC5. Badge parcial: `+N` = `selectedMoviles.length - VISIBLE_IDS`. El denominador sigue siendo los seleccionados que no caben en las 5 posiciones visibles, no el universo global. Coherente con AC5 según la spec (rebalse, no total-empresa).
- [x] AC6. Si se seleccionan los N del colapsable, `filteredMoviles.every(m => selectedMoviles.includes(m.id))` → true → badge "Todos".

Edge cases:
- [x] EC1. filteredMoviles vacío: `filteredMoviles.length > 0 && ...every(...)` → `false`. `allSelected` es false. Badge no muestra "Todos" ni IDs raros (cae a "Ninguno" si selectedMoviles.length === 0). Correcto.
- [x] EC2. Múltiples empresas: `allSelected` evalúa los móviles visibles en el colapsable actual (`filteredMoviles`), que depende de la empresa seleccionada. Cada empresa es independiente.
- [x] EC3. Búsqueda activa + "Todos": `filteredMoviles` ya incorpora `movilesSearch`, así que `allSelected` y `handleSelectAll` (que usa `movilesFiltered` del dashboard) operan sobre los visibles tras la búsqueda. El badge dice "Todos" cuando están todos los visibles seleccionados. Correcto.
- [x] EC4. Móvil pasó a inactivo después de creado el pedido: si el móvil inactivo NO está en `selectedMoviles` (porque el filtro de actividad lo excluye de `filteredMoviles` y de `handleSelectAll`), el pedido no pasa. Si el usuario lo había seleccionado manualmente antes de inactivarlo, sí pasa — pero eso es correcto porque el usuario eligió incluirlo.
- [x] EC5. Deselect all: `selectedMoviles.length === 0` → filtro `if (selectedMoviles.length > 0)` no entra → comportamiento igual que primer login (sin filtro activo).

## Hallazgos

### Bloqueantes
Ninguno.

### Sugerencias (no bloqueantes)

1. **`components/ui/MovilSelector.tsx:670`** — Shadow de `allSelected`. Dentro del IIFE del badge, el badge de empresas (línea 670) declara `const allSelected = selectedEmpresas.length === empresas.length`. Esta declaración pisa con shadowing el `allSelected` del scope externo (línea 293) dentro de ese bloque. En el badge de móviles (líneas 656-664) `allSelected` refiere correctamente al del scope externo porque el badge de móviles está en un bloque `{}` anidado anterior al de empresas. El orden es: badge-móviles primero (usa outer `allSelected`), luego badge-empresas (declara su propio `allSelected` local). No hay bug en runtime, pero el shadowing es un smell que puede confundir a quien toque ese IIFE en el futuro. Considerar renombrar la variable local a `allEmpresasSelected`.

2. **`app/dashboard/page.tsx:1117` vs `MovilSelector.tsx:293`** — Asimetría de denominador en EC3. `handleSelectAll` (dashboard) usa `movilesFiltered` para calcular los IDs a seleccionar, mientras que `allSelected` (MovilSelector) usa `filteredMoviles` (calculado dentro del componente con el `movilesSearch` local). Si el usuario escribe una búsqueda, pulsa "Seleccionar todos", y la búsqueda borra un móvil de `filteredMoviles` pero `movilesFiltered` del dashboard sigue incluyéndolo, podría haber un desfase temporal. En la práctica `movilesFiltered` del dashboard baja como `moviles` prop al componente y `filteredMoviles` lo refiltra con la búsqueda local, por lo que los IDs en `filteredMoviles` son siempre un subconjunto de `movilesFiltered`. El botón "Seleccionar todos" dentro del colapsable (línea 1147) ejecuta `onSelectAll` directamente, que selecciona el `movilesFiltered` completo del dashboard — lo que puede ser más que los visibles tras la búsqueda. Esto ya existía antes del fix y no es introducido por este cambio; mención como "Nota para PR futuro".

### Positivo

- Los fixes son estrictamente quirúrgicos: 3 líneas de lógica cambiadas, sin abstracciones nuevas, sin refactors.
- Reutilizar `allSelected` ya calculado en línea 293 en lugar de duplicar la expresión en el badge es la decisión correcta.
- La extracción de `VISIBLE_IDS = 5` como constante nombrada es una mejora mínima de legibilidad que no agrega complejidad.
- Los comentarios en el diff explican el "por qué" (referencia a AC1/AC2), no el "qué". Correcto.
- Los filtros pedidos y services son simétricos: misma estructura, mismo fix, misma lógica de `hiddenMovilIds`.
- La variable `isPartialEmpresa` / `isPartialEmpresaSvc` queda intacta en el branch `else if`, preservando el comportamiento correcto para el caso "sin móviles seleccionados pero empresa parcial".

## Sobre las dos notas del implementer

**Nota 1 — Cambio de comportamiento para usuario root:** La spec es explícita en AC1/AC2: "cero pedidos Sin asignar" cuando hay 1+ móviles seleccionados, sin excepción de rol. El `return false` es la implementación directa de esa frase. El comportamiento anterior (`return !isPartialEmpresa`) era incorrecto para root porque `hideUnassigned` llega como `false` para root (sin restricción de empresa), lo que hacía pasar "Sin asignar" aunque el usuario hubiera seleccionado móviles específicos. El fix es coherente con la spec y no rompe ningún caso de uso: si root quiere ver "Sin asignar", simplemente no selecciona ningún móvil (EC5 → vista sin filtro).

**Nota 2 — Cuarto bug (orden de IDs en badge parcial):** El implementer no tocó esa lógica. Confirmado: el diff no modifica el orden de `selectedMoviles` en el badge parcial. El array se pasa tal como viene del estado del padre. No es regresión introducida por este cambio.

## Resumen

El cambio está bien. Los tres fixes son correctos, simétricos y cubren todos los AC y EC de la spec. El único item destacable es el shadowing de `allSelected` en el badge de empresas (línea 670), que no genera bug hoy por el orden de los bloques pero es un smell menor. No hay bloqueantes.
