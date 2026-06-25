/**
 * Tests para los AC del fix de repoll (run 20260625-095049-n59).
 *
 * Cubre las lógicas puras extraídas de los dos archivos modificados:
 *   - app/dashboard/page.tsx  (selectedMoviles reconciliation)
 *   - components/ui/PedidosTableModal.tsx  (preFilterMovil guard)
 *
 * Los hooks de React no se montan aquí (no hay jsdom). Se replican las
 * funciones puras y la lógica de estado tal como lo hacen los tests del repo.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Réplica de la lógica de reconciliación de selectedMoviles (page.tsx §4 y §4.1)
//
// Reproduce el bloque setSelectedMoviles(prev => {...}) del efecto principal,
// tanto para el path !USE_NEW (§4) como para USE_NEW (§4.1).
// ─────────────────────────────────────────────────────────────────────────────

interface ReconcileInput {
  prev: number[];
  visibleIds: number[];
  userExplicitlyCleared: boolean;
  /** Inactivos del día conocidos — se preservan aunque no estén en visibleIds */
  inactivosKnown?: number[];
  /**
   * Universo de visibles del repoll ANTERIOR (= prevVisibleIdsRef.current en page.tsx).
   * Si se omite, se usa [] lo que hace que `[].every(...) = true` → modo Todos inicial,
   * comportamiento correcto en la primera carga.
   */
  prevVisibleIds?: number[];
}

/** Réplica del reducer §4 (!USE_NEW) — con fix prevVisibleIdsRef (iteración 2). */
function reconcileSelectedMovilesLegacy(input: ReconcileInput): number[] {
  const { prev, visibleIds, userExplicitlyCleared, inactivosKnown = [], prevVisibleIds = [] } = input;
  const visibleSet = new Set(visibleIds);
  const inactivosSet = new Set(inactivosKnown);

  const cleanPrev = prev.filter(id => visibleSet.has(id) || inactivosSet.has(id));
  const orphanCount = prev.length - cleanPrev.length;
  const missing = visibleIds.filter(id => !cleanPrev.includes(id));

  if (prev.length === 0) {
    if (userExplicitlyCleared) return prev;
    return visibleIds;
  }

  if (userExplicitlyCleared) {
    if (orphanCount === 0) return prev;
    return cleanPrev;
  }

  // FIX iter2: comparar prev contra el universo ANTERIOR (prevVisibleIds), no contra
  // visibleIds post-repoll. Si comparásemos contra post-repoll, un nuevo móvil en el
  // universo haría fallar la check y nunca se auto-agregaría en modo Todos.
  const cleanPrevSet = new Set(cleanPrev);
  const allPrevVisiblesSelected = prevVisibleIds.every(id => cleanPrevSet.has(id));
  if (!allPrevVisiblesSelected) {
    // Selección custom: solo limpiar huérfanos, no agregar nuevos.
    if (orphanCount === 0) return prev;
    return cleanPrev;
  }

  if (missing.length === 0 && orphanCount === 0) return prev;
  return visibleIds;
}

/** Réplica del reducer §4.1 (USE_NEW) — con fix prevVisibleIdsRef (iteración 2). */
function reconcileSelectedMovilesNew(
  prev: number[],
  visibleIds: number[],
  userExplicitlyCleared: boolean,
  prevVisibleIds: number[] = [],
): number[] {
  if (prev.length === 0) {
    if (userExplicitlyCleared) return prev;
    return visibleIds;
  }
  if (userExplicitlyCleared) return prev;

  // FIX iter2: comparar prev contra el universo ANTERIOR (prevVisibleIds), no contra
  // visibleIds post-repoll, para detectar correctamente "modo Todos" cuando llega un móvil nuevo.
  const prevSet = new Set(prev);
  const allPrevVisiblesSelected = prevVisibleIds.every(id => prevSet.has(id));
  if (!allPrevVisiblesSelected) return prev; // selección custom — no tocar

  const newIds = visibleIds.filter(id => !prevSet.has(id));
  if (newIds.length === 0) return prev;
  return [...prev, ...newIds];
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica del guard de preFilterMovil (PedidosTableModal.tsx)
//
// La lógica de estado se simula con objetos mutables (refs) en vez de hooks.
// ─────────────────────────────────────────────────────────────────────────────

interface PreFilterModalState {
  preFilterApplied: boolean;
  prevIsOpen: boolean;
  filtersMovil: number[];
  page: number;
}

/**
 * Simula la ejecución del useEffect de preFilterMovil del modal.
 * Devuelve el nuevo estado (réplica inmutable del reducer de efectos).
 */
function runPreFilterEffect(
  state: PreFilterModalState,
  isOpen: boolean,
  preFilterMovil: number | undefined,
): PreFilterModalState {
  const justOpened = isOpen && !state.prevIsOpen;
  const newPrevIsOpen = isOpen;

  if (!isOpen) {
    return { ...state, prevIsOpen: newPrevIsOpen, preFilterApplied: false };
  }

  if (preFilterMovil && (justOpened || !state.preFilterApplied)) {
    return {
      prevIsOpen: newPrevIsOpen,
      preFilterApplied: true,
      filtersMovil: [preFilterMovil],
      page: 0,
    };
  }

  return { ...state, prevIsOpen: newPrevIsOpen };
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica del guard de contenido showPendientes/showCompletados (page.tsx)
//
// Reproduce la comparación de IDs que evita disparar el reset cuando
// selectedEmpresas cambia de referencia pero tiene el mismo contenido.
// ─────────────────────────────────────────────────────────────────────────────

function empresasChangedByContent(prev: number[], next: number[]): boolean {
  if (prev.length !== next.length) return true;
  const a = [...prev].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  return a.some((v, i) => v !== b[i]);
}

// ═════════════════════════════════════════════════════════════════════════════
// AC3 — selectedMoviles no se pisa con selección custom (subconjunto estricto)
// ═════════════════════════════════════════════════════════════════════════════

describe('AC3 — allVisiblesSelected: subconjunto estricto detectado correctamente', () => {
  it('todos los visibles están en prev (modo Todos) → allVisiblesSelected=true', () => {
    const prev = [1, 2, 3];
    const visibleIds = [1, 2, 3];
    const allVisiblesSelected = visibleIds.every(id => new Set(prev).has(id));
    expect(allVisiblesSelected).toBe(true);
  });

  it('prev es subconjunto estricto de visibleIds → allVisiblesSelected=false (selección custom)', () => {
    const prev = [1, 2]; // usuario deseleccionó el 3
    const visibleIds = [1, 2, 3];
    const allVisiblesSelected = visibleIds.every(id => new Set(prev).has(id));
    expect(allVisiblesSelected).toBe(false);
  });

  it('prev vacío → allVisiblesSelected=false (sin selección = sin modo Todos)', () => {
    const prev: number[] = [];
    const visibleIds = [1, 2, 3];
    const allVisiblesSelected = visibleIds.every(id => new Set(prev).has(id));
    expect(allVisiblesSelected).toBe(false);
  });

  it('prev tiene IDs extra que no están en visibleIds (huérfanos) + todos los visibles → true', () => {
    // Un usuario tenía [1,2,3] y llegó el dato sin el 4 (huérfano). cleanPrev=[1,2,3],
    // visibleIds=[1,2,3] → sigue siendo modo Todos.
    const prev = [1, 2, 3, 4]; // 4 es huérfano
    const visibleIds = [1, 2, 3];
    const cleanPrev = prev.filter(id => new Set(visibleIds).has(id)); // [1,2,3]
    const allVisiblesSelected = visibleIds.every(id => new Set(cleanPrev).has(id));
    expect(allVisiblesSelected).toBe(true);
  });

  it('un solo visible faltante en prev → subconjunto estricto detectado', () => {
    const prev = [1, 3, 5, 7]; // le falta el 2
    const visibleIds = [1, 2, 3, 4, 5, 6, 7];
    const allVisiblesSelected = visibleIds.every(id => new Set(prev).has(id));
    expect(allVisiblesSelected).toBe(false);
  });
});

describe('AC3 — reconcileSelectedMoviles: selección custom no se pisa en repoll (§4 !USE_NEW)', () => {
  it('modo Todos estático: prev=[1,2,3], visibleIds=[1,2,3], prevVisibleIds=[1,2,3] → retorna sin cambios', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).toEqual([1, 2, 3]);
  });

  it('modo Todos — nuevo móvil (4) en visibleIds: SÍ se agrega cuando prevVisibleIds=[1,2,3]', () => {
    // Fix iter2: comparamos prev contra prevVisibleIds (universo anterior = [1,2,3]).
    // prev=[1,2,3] cubre todos los prevVisibles → modo Todos → agrega el nuevo 4.
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2, 3, 4], // nuevo móvil 4 apareció
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3], // universo anterior = prev repoll
    });
    expect(result).toContain(4);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('modo Todos — sin prevVisibleIds (primer render, ref vacío): prev=[1,2,3], nuevo visible=4 → agrega', () => {
    // prevVisibleIds=[] → [].every(...) = true → modo Todos → agrega el nuevo
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2, 3, 4],
      userExplicitlyCleared: false,
      // prevVisibleIds omitido = [] por default
    });
    expect(result).toContain(4);
  });

  it('selección custom (subconjunto estricto): repoll NO agrega nuevos móviles', () => {
    // El usuario tiene [1,2] seleccionados de un universo prevVisible de [1,2,3].
    // prev=[1,2] no cubre todos los prevVisibles=[1,2,3] → subconjunto → no agrega.
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2], // subconjunto estricto de prevVisibleIds → selección custom
      visibleIds: [1, 2, 3, 4],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).toEqual([1, 2]);
    expect(result).not.toContain(3);
    expect(result).not.toContain(4);
  });

  it('selección custom con huérfano: repoll limpia el huérfano pero no agrega nuevos', () => {
    // prev=[1,2,99] donde 99 es huérfano (ya no existe). prevVisibleIds=[1,2,3]
    // cleanPrev=[1,2] (99 eliminado), no cubre todo prevVisibles → subconjunto → no agrega 3 ni 4
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 99],
      visibleIds: [1, 2, 3, 4],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).toEqual([1, 2]);
    expect(result).not.toContain(99);
    expect(result).not.toContain(3);
    expect(result).not.toContain(4);
  });

  it('selección custom sin huérfanos: repoll retorna prev sin cambios (estabilidad)', () => {
    const prev = [2, 5];
    const result = reconcileSelectedMovilesLegacy({
      prev,
      visibleIds: [1, 2, 3, 4, 5],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3, 4, 5],
    });
    // Sin huérfanos y prev no cubre todos los prevVisibles → debe devolver prev sin cambios
    expect(result).toEqual([2, 5]);
  });

  it('userExplicitlyCleared=true: el modo custom por flag no agrega nuevos (comportamiento preexistente)', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2, 3, 4],
      userExplicitlyCleared: true,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).not.toContain(4);
  });
});

describe('AC3 — reconcileSelectedMovilesNew: selección custom no se pisa en repoll (§4.1 USE_NEW)', () => {
  it('modo Todos — nuevo móvil (4): SÍ se agrega cuando prevVisibleIds=[1,2,3] (fix iter2)', () => {
    // prevVisibles=[1,2,3], prev=[1,2,3] → todos cubiertos → modo Todos → agrega el 4
    const result = reconcileSelectedMovilesNew([1, 2, 3], [1, 2, 3, 4], false, [1, 2, 3]);
    expect(result).toContain(4);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('modo Todos — sin prevVisibleIds (primer render, ref vacío): agrega el nuevo', () => {
    // prevVisibleIds=[] → [].every(...) = true → modo Todos → agrega
    const result = reconcileSelectedMovilesNew([1, 2, 3], [1, 2, 3, 4], false);
    expect(result).toContain(4);
  });

  it('selección custom (prev=[1,2], prevVisibleIds=[1,2,3]) → no agrega nada', () => {
    // prev no cubre todos los prevVisibles → subconjunto → no toca
    const result = reconcileSelectedMovilesNew([1, 2], [1, 2, 3, 4], false, [1, 2, 3]);
    expect(result).toEqual([1, 2]);
  });

  it('modo Todos estático: prev=[1,2,3], visibleIds=[1,2,3], prevVisibleIds=[1,2,3] → sin cambios', () => {
    const result = reconcileSelectedMovilesNew([1, 2, 3], [1, 2, 3], false, [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('userExplicitlyCleared=true: devuelve prev sin modificar', () => {
    const result = reconcileSelectedMovilesNew([1], [1, 2, 3], true, [1]);
    expect(result).toEqual([1]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC2 — PedidosTableModal: preFilterMovil NO se aplica en repoll
// ═════════════════════════════════════════════════════════════════════════════

describe('AC2 — preFilterMovil NO se aplica en repoll (solo al abrir)', () => {
  it('al abrir (cerrado→abierto) con preFilterMovil → aplica el filtro', () => {
    const initialState: PreFilterModalState = {
      preFilterApplied: false,
      prevIsOpen: false,
      filtersMovil: [],
      page: 0,
    };
    const state = runPreFilterEffect(initialState, true, 106);
    expect(state.filtersMovil).toEqual([106]);
    expect(state.page).toBe(0);
    expect(state.preFilterApplied).toBe(true);
  });

  it('repoll de datos con modal ya abierto → NO re-aplica el filtro', () => {
    // El efecto no incluye `pedidos` en sus deps → simular que el efecto
    // se ejecuta nuevamente con isOpen=true (no hay transición cerrado→abierto)
    const openState: PreFilterModalState = {
      preFilterApplied: true,
      prevIsOpen: true, // ya estaba abierto
      filtersMovil: [106],
      page: 5, // usuario navegó a la página 5
    };
    // El usuario cambió el filtro manualmente a movil=252
    const stateWithManualFilter = { ...openState, filtersMovil: [252] };

    // Llega repoll: se ejecuta el efecto con isOpen=true (sin transición cerrado→abierto)
    const afterRepoll = runPreFilterEffect(stateWithManualFilter, true, 106);

    // El filtro manual 252 debe permanecer; NO se resetea a 106
    expect(afterRepoll.filtersMovil).toEqual([252]);
    // La paginación tampoco se resetea
    expect(afterRepoll.page).toBe(5);
  });

  it('al cerrar el modal → preFilterApplied se resetea a false', () => {
    const openState: PreFilterModalState = {
      preFilterApplied: true,
      prevIsOpen: true,
      filtersMovil: [106],
      page: 3,
    };
    const closed = runPreFilterEffect(openState, false, 106);
    expect(closed.preFilterApplied).toBe(false);
  });

  it('al reabrir el modal → el filtro se aplica de nuevo (transición cerrado→abierto)', () => {
    // Simula: abrir, cambiar filtro manualmente, cerrar, reabrir
    let state: PreFilterModalState = {
      preFilterApplied: false,
      prevIsOpen: false,
      filtersMovil: [],
      page: 0,
    };

    // 1. Abrir
    state = runPreFilterEffect(state, true, 106);
    expect(state.filtersMovil).toEqual([106]);

    // 2. Cambiar filtro manualmente
    state = { ...state, filtersMovil: [252], page: 3 };

    // 3. Simular múltiples repolls (isOpen sigue true, sin transición)
    state = runPreFilterEffect(state, true, 106);
    expect(state.filtersMovil).toEqual([252]); // no tocado

    state = runPreFilterEffect(state, true, 106);
    expect(state.filtersMovil).toEqual([252]); // no tocado

    // 4. Cerrar
    state = runPreFilterEffect(state, false, 106);
    expect(state.preFilterApplied).toBe(false);

    // 5. Reabrir → ahora SÍ aplica el filtro inicial
    state = runPreFilterEffect(state, true, 106);
    expect(state.filtersMovil).toEqual([106]);
    expect(state.page).toBe(0);
  });

  it('modal sin preFilterMovil (undefined) → no toca filtros aunque se abra', () => {
    const initialState: PreFilterModalState = {
      preFilterApplied: false,
      prevIsOpen: false,
      filtersMovil: [],
      page: 0,
    };
    const state = runPreFilterEffect(initialState, true, undefined);
    expect(state.filtersMovil).toEqual([]);
    expect(state.preFilterApplied).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC4 — Guard de contenido: mismos IDs en nueva referencia → no dispara reset
// ═════════════════════════════════════════════════════════════════════════════

describe('AC4 — guard de contenido en empresas: misma ref vs mismos IDs', () => {
  it('mismos IDs, misma referencia → empresasChanged=false', () => {
    const empresas = [1, 2, 3];
    expect(empresasChangedByContent(empresas, empresas)).toBe(false);
  });

  it('mismos IDs, distinta referencia → empresasChanged=false (el guard lo detecta)', () => {
    const prev = [1, 2, 3];
    const next = [3, 1, 2]; // mismo contenido, distinto orden y referencia
    expect(empresasChangedByContent(prev, next)).toBe(false);
  });

  it('un ID distinto → empresasChanged=true', () => {
    expect(empresasChangedByContent([1, 2, 3], [1, 2, 4])).toBe(true);
  });

  it('distinta longitud → empresasChanged=true', () => {
    expect(empresasChangedByContent([1, 2], [1, 2, 3])).toBe(true);
  });

  it('ambos vacíos → empresasChanged=false', () => {
    expect(empresasChangedByContent([], [])).toBe(false);
  });

  it('prev vacío, next con elementos → empresasChanged=true (primer render)', () => {
    expect(empresasChangedByContent([], [1, 2, 3])).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC5 — Regresiones: auto-selección inicial, modo Todos, handleClearAll
// ═════════════════════════════════════════════════════════════════════════════

describe('AC5 — auto-selección inicial (prev=[]) no rota', () => {
  it('primera carga (prev=[], cleared=false) → selecciona todos los visibles', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [],
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: false,
    });
    expect(result).toEqual([1, 2, 3]);
  });

  it('primera carga (prev=[], cleared=true via handleClearAll) → mantiene vacío', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [],
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: true,
    });
    expect(result).toEqual([]);
  });
});

describe('AC5 — modo Todos: comportamiento en repoll con nuevos visibles', () => {
  it('modo Todos — nuevo visible con prevVisibleIds correcto: SÍ agrega el nuevo móvil (AC5 fix)', () => {
    // Fix iter2: prevVisibleIds=[1,2,3] = universo anterior.
    // prev=[1,2,3] cubre todos los prevVisibles → modo Todos → agrega el 4.
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2, 3, 4],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).toContain(4);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('modo Todos: baja de un móvil lo elimina del selected', () => {
    // prev=[1,2,3], visibleIds=[1,2] (el 3 se dio de baja)
    // prevVisibleIds=[1,2,3] → prev cubre todos → modo Todos → aplica nuevo universo [1,2]
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 3],
      visibleIds: [1, 2],
      userExplicitlyCleared: false,
      prevVisibleIds: [1, 2, 3],
    });
    expect(result).toEqual([1, 2]);
    expect(result).not.toContain(3);
  });
});

describe('AC5 — handleClearAll: userExplicitlyCleared=true bloquea todos los re-adds', () => {
  it('cleared=true: no agrega ningún nuevo visible', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [1],
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: true,
    });
    expect(result).not.toContain(2);
    expect(result).not.toContain(3);
  });

  it('cleared=true con huérfano: limpia el huérfano pero no agrega nada', () => {
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 99],
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: true,
    });
    expect(result).toEqual([1]);
    expect(result).not.toContain(99);
    expect(result).not.toContain(2);
  });
});

describe('AC5 — fechas históricas: inactivos del día preservados', () => {
  it('inactivos del día en prev no se eliminan en selección custom (usuario no tiene todos)', () => {
    // Escenario: prev=[1,2,500] donde 500=inactivo del día. El usuario tiene selección custom
    // porque no tiene el 3 que estaba en el universo previo prevVisibleIds=[1,2,3].
    // Resultado: modo custom (no cubre todos los prevVisibles) → solo limpiar huérfanos →
    // el 500 se preserva porque está en inactivosKnown (no se considera huérfano).
    const result = reconcileSelectedMovilesLegacy({
      prev: [1, 2, 500], // 500 = inactivo del día histórico; 3 no está (selección custom)
      visibleIds: [1, 2, 3],
      userExplicitlyCleared: false,
      inactivosKnown: [500],
      prevVisibleIds: [1, 2, 3], // universo anterior incluía el 3
    });
    expect(result).toContain(500);
    expect(result).toContain(1);
    expect(result).toContain(2);
  });
});
