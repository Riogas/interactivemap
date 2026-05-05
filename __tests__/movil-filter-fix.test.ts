/**
 * Tests de regresión para el fix del filtro de móviles en MovilSelector.tsx
 * (run 20260430-162700-tm1 — diff.1.patch).
 *
 * El componente usa lógica encapsulada en useMemo que no puede instanciarse
 * sin @testing-library/react (ausente en este repo). Replicamos las funciones
 * puras afectadas por el diff exactamente como lo hacen los tests existentes
 * en distribuidor-scope-ui.test.ts.
 *
 * Funciones replicadas (de components/ui/MovilSelector.tsx):
 *  - filterPedidosByMovil  → useMemo filteredPedidos (bloque selectedMoviles > 0)
 *  - filterServicesByMovil → useMemo filteredServices (bloque selectedMoviles > 0)
 *  - computeBadgeLabel     → lógica del badge de móviles (líneas 651-665)
 *  - computeAllSelected    → allSelected (línea 293)
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos mínimos (mirrors de PedidoSupabase / ServiceSupabase)
// ─────────────────────────────────────────────────────────────────────────────

interface MinPedido {
  id: number;
  movil?: number | string | null;
  estado_nro?: number | null;
}

interface MinService {
  id: number;
  movil?: number | string | null;
  estado_nro?: number | null;
}

interface MinMovil {
  id: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica exacta del filtro de pedidos (MovilSelector.tsx:314-321 post-fix)
// ─────────────────────────────────────────────────────────────────────────────

function filterPedidosByMovil(
  pedidos: MinPedido[],
  selectedMoviles: number[],
  hiddenMovilIds?: Set<number>
): MinPedido[] {
  if (selectedMoviles.length === 0) return pedidos;
  return pedidos.filter(pedido => {
    // Sin asignar: nunca pasan cuando hay filtro de móviles activo (AC1 / fix bug 1)
    if (!pedido.movil || Number(pedido.movil) === 0) return false;
    // Móviles ocultos-pero-operativos siempre pasan
    if (hiddenMovilIds && hiddenMovilIds.has(Number(pedido.movil))) return true;
    return selectedMoviles.some(id => Number(id) === Number(pedido.movil));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica exacta del filtro de services (MovilSelector.tsx:438-443 post-fix)
// ─────────────────────────────────────────────────────────────────────────────

function filterServicesByMovil(
  services: MinService[],
  selectedMoviles: number[],
  hiddenMovilIds?: Set<number>
): MinService[] {
  if (selectedMoviles.length === 0) return services;
  return services.filter(service => {
    // Sin asignar: nunca pasan cuando hay filtro de móviles activo (AC2 / fix bug 1)
    if (!service.movil || Number(service.movil) === 0) return false;
    // Móviles ocultos-pero-operativos siempre pasan
    if (hiddenMovilIds && hiddenMovilIds.has(Number(service.movil))) return true;
    return selectedMoviles.some(id => Number(id) === Number(service.movil));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica de allSelected (MovilSelector.tsx) — alcance COLAPSABLE.
// Se usa para el botón "Seleccionar/Deseleccionar todos" del panel.
// Compara contra filteredMoviles (visibles en el colapsable después de search
// + filtros locales).
// ─────────────────────────────────────────────────────────────────────────────

function computeAllSelected(
  filteredMoviles: MinMovil[],
  selectedMoviles: number[]
): boolean {
  return filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica de allMovilesSelected (MovilSelector.tsx) — alcance HEADER BADGE.
// Compara contra TODOS los móviles operativos (prop `moviles`, ya filtrada
// por scope/empresa desde el dashboard, excluyendo ocultos). NO aplica search
// local. Si filtrás a 1 móvil por search y lo seleccionás, el badge muestra
// el ID en vez de "Todos".
// ─────────────────────────────────────────────────────────────────────────────

function computeAllMovilesSelected(
  moviles: MinMovil[],
  selectedMoviles: number[],
  hiddenMovilIds?: Set<number>
): boolean {
  const operativos = hiddenMovilIds && hiddenMovilIds.size > 0
    ? moviles.filter(m => !hiddenMovilIds.has(m.id))
    : moviles;
  return operativos.length > 0 && operativos.every(m => selectedMoviles.includes(m.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica exacta del badge label (MovilSelector.tsx:651-662 post-fix)
// ─────────────────────────────────────────────────────────────────────────────

const VISIBLE_IDS = 5;

function computeBadgeLabel(
  allSelected: boolean,
  selectedMoviles: number[]
): string {
  const noneSelected = selectedMoviles.length === 0;
  if (allSelected) return 'Móviles: Todos';
  if (noneSelected) return 'Móviles: Ninguno';
  return selectedMoviles.length <= VISIBLE_IDS
    ? selectedMoviles.join(', ')
    : `${selectedMoviles.slice(0, VISIBLE_IDS).join(', ')} +${selectedMoviles.length - VISIBLE_IDS}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const pedidoConMovil106: MinPedido = { id: 1, movil: 106, estado_nro: 1 };
const pedidoConMovil252: MinPedido = { id: 2, movil: 252, estado_nro: 1 };
const pedidoSinMovilNull: MinPedido = { id: 3, movil: null, estado_nro: 1 };
const pedidoSinMovilCero: MinPedido = { id: 4, movil: 0, estado_nro: 1 };
const pedidoSinMovilUndefined: MinPedido = { id: 5, movil: undefined, estado_nro: 1 };
const pedidoMovilInactivo330: MinPedido = { id: 6, movil: 330, estado_nro: 1 };

const servicioConMovil106: MinService = { id: 10, movil: 106, estado_nro: 1 };
const servicioConMovil252: MinService = { id: 11, movil: 252, estado_nro: 1 };
const servicioSinMovil: MinService = { id: 12, movil: null, estado_nro: 1 };
const servicioSinMovilCero: MinService = { id: 13, movil: 0, estado_nro: 1 };

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — filtro de pedidos cuando hay móviles seleccionados
// ─────────────────────────────────────────────────────────────────────────────

describe('AC1 - filtro pedidos con móviles seleccionados', () => {
  it('con 1 móvil seleccionado, solo pasan pedidos de ese móvil', () => {
    const pedidos = [pedidoConMovil106, pedidoConMovil252, pedidoSinMovilNull];
    const result = filterPedidosByMovil(pedidos, [106]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('pedido sin móvil (null) NO pasa cuando hay filtro de móviles activo', () => {
    const result = filterPedidosByMovil([pedidoSinMovilNull], [106]);
    expect(result).toHaveLength(0);
  });

  it('pedido sin móvil (movil=0) NO pasa cuando hay filtro de móviles activo', () => {
    const result = filterPedidosByMovil([pedidoSinMovilCero], [106]);
    expect(result).toHaveLength(0);
  });

  it('pedido sin móvil (movil=undefined) NO pasa cuando hay filtro de móviles activo', () => {
    const result = filterPedidosByMovil([pedidoSinMovilUndefined], [106]);
    expect(result).toHaveLength(0);
  });

  it('pedido de móvil no seleccionado NO pasa', () => {
    const result = filterPedidosByMovil([pedidoConMovil252], [106]);
    expect(result).toHaveLength(0);
  });

  it('sin móviles seleccionados, todos los pedidos pasan (sin filtro activo — EC5)', () => {
    const pedidos = [pedidoConMovil106, pedidoConMovil252, pedidoSinMovilNull];
    const result = filterPedidosByMovil(pedidos, []);
    expect(result).toHaveLength(3);
  });

  it('móvil de pedido como string coincide con selectedMoviles numérico', () => {
    const pedidoMovilString: MinPedido = { id: 99, movil: '106', estado_nro: 1 };
    const result = filterPedidosByMovil([pedidoMovilString], [106]);
    expect(result).toHaveLength(1);
  });

  it('móvil oculto-pero-operativo pasa aunque no esté seleccionado', () => {
    const hiddenMovilIds = new Set<number>([330]);
    const result = filterPedidosByMovil([pedidoMovilInactivo330], [106], hiddenMovilIds);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(6);
  });

  it('sin asignar no pasa aunque hideUnassigned=false (regresión del bug original)', () => {
    // Antes del fix, return !isPartialEmpresa hacía que con isPartialEmpresa=false
    // (usuario root) los sin asignar pasaran. El fix cambia a return false siempre.
    // Esta prueba verifica que la condición sin asignar es ahora incondicional.
    const result = filterPedidosByMovil([pedidoSinMovilNull, pedidoSinMovilCero], [106]);
    expect(result).toHaveLength(0);
  });

  it('multiples móviles seleccionados — solo pasan pedidos de esos móviles', () => {
    const pedidos = [pedidoConMovil106, pedidoConMovil252, pedidoMovilInactivo330, pedidoSinMovilNull];
    const result = filterPedidosByMovil(pedidos, [106, 252]);
    expect(result).toHaveLength(2);
    const ids = result.map(p => p.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — filtro de services cuando hay móviles seleccionados
// ─────────────────────────────────────────────────────────────────────────────

describe('AC2 - filtro services con móviles seleccionados', () => {
  it('con 1 móvil seleccionado, solo pasan services de ese móvil', () => {
    const services = [servicioConMovil106, servicioConMovil252, servicioSinMovil];
    const result = filterServicesByMovil(services, [106]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
  });

  it('service sin móvil (null) NO pasa cuando hay filtro de móviles activo', () => {
    const result = filterServicesByMovil([servicioSinMovil], [106]);
    expect(result).toHaveLength(0);
  });

  it('service sin móvil (movil=0) NO pasa cuando hay filtro de móviles activo', () => {
    const result = filterServicesByMovil([servicioSinMovilCero], [106]);
    expect(result).toHaveLength(0);
  });

  it('service de móvil no seleccionado NO pasa', () => {
    const result = filterServicesByMovil([servicioConMovil252], [106]);
    expect(result).toHaveLength(0);
  });

  it('sin móviles seleccionados, todos los services pasan (sin filtro activo — EC5)', () => {
    const services = [servicioConMovil106, servicioConMovil252, servicioSinMovil];
    const result = filterServicesByMovil(services, []);
    expect(result).toHaveLength(3);
  });

  it('servicio sin asignar no pasa aunque hideUnassigned=false (regresión del bug original)', () => {
    const result = filterServicesByMovil([servicioSinMovil, servicioSinMovilCero], [106]);
    expect(result).toHaveLength(0);
  });

  it('móvil oculto-pero-operativo en service pasa aunque no esté seleccionado', () => {
    const servicioMovilHidden: MinService = { id: 99, movil: 330, estado_nro: 1 };
    const hiddenMovilIds = new Set<number>([330]);
    const result = filterServicesByMovil([servicioMovilHidden], [106], hiddenMovilIds);
    expect(result).toHaveLength(1);
  });

  it('filtros de pedidos y services son simétricos — misma lógica para ambos tipos', () => {
    const selectedMoviles = [106, 252];
    const hiddenMovilIds = new Set<number>([330]);
    const pedidos: MinPedido[] = [
      { id: 1, movil: 106 }, { id: 2, movil: 330 }, { id: 3, movil: null },
    ];
    const services: MinService[] = [
      { id: 10, movil: 106 }, { id: 11, movil: 330 }, { id: 12, movil: null },
    ];
    const filteredP = filterPedidosByMovil(pedidos, selectedMoviles, hiddenMovilIds);
    const filteredS = filterServicesByMovil(services, selectedMoviles, hiddenMovilIds);
    // Ambos deben tener 2: movil 106 (seleccionado) + movil 330 (oculto-operativo)
    expect(filteredP).toHaveLength(2);
    expect(filteredS).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 + AC6 — badge muestra "Todos" cuando todos los filteredMoviles están seleccionados
// ─────────────────────────────────────────────────────────────────────────────

describe('AC3/AC6 - badge "Todos" con filteredMoviles', () => {
  it('todos los móviles del colapsable seleccionados → allSelected=true → badge "Todos"', () => {
    const filteredMoviles: MinMovil[] = [{ id: 106 }, { id: 252 }, { id: 250 }];
    const selectedMoviles = [106, 252, 250];
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(true);
    expect(computeBadgeLabel(allSelected, selectedMoviles)).toBe('Móviles: Todos');
  });

  it('con 80 móviles en colapsable y 80 seleccionados → badge "Todos" (caso del usuario)', () => {
    const filteredMoviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = filteredMoviles.map(m => m.id);
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(true);
    expect(computeBadgeLabel(allSelected, selectedMoviles)).toBe('Móviles: Todos');
  });

  it('todos los visibles del colapsable seleccionados → allSelected=true (botón "Deseleccionar Todos")', () => {
    // Este test cubre el botón del colapsable (alcance "filteredMoviles").
    // El badge del header tiene OTRA lógica — ver describe AC7 más abajo.
    const filteredMoviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = filteredMoviles.map(m => m.id);
    expect(computeAllSelected(filteredMoviles, selectedMoviles)).toBe(true);
  });

  it('solo algunos móviles del colapsable seleccionados → allSelected=false', () => {
    const filteredMoviles: MinMovil[] = [{ id: 106 }, { id: 252 }, { id: 250 }];
    const selectedMoviles = [106]; // solo 1 de 3
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(false);
  });

  it('filteredMoviles vacío → allSelected=false (EC1: empresa sin móviles)', () => {
    const allSelected = computeAllSelected([], []);
    expect(allSelected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — badge parcial: contador "+N" usa rebalse de visibles, no universo global
// ─────────────────────────────────────────────────────────────────────────────

describe('AC5 - badge parcial: +N es rebalse de VISIBLE_IDS (5), no universo global', () => {
  it('5 o menos seleccionados → muestra IDs sin +N', () => {
    const allSelected = false;
    expect(computeBadgeLabel(allSelected, [106, 252, 250])).toBe('106, 252, 250');
    expect(computeBadgeLabel(allSelected, [106, 252, 250, 147, 136])).toBe('106, 252, 250, 147, 136');
  });

  it('6 seleccionados → muestra 5 IDs + "+1" (rebalse, no total global)', () => {
    const allSelected = false;
    const selected = [106, 252, 250, 147, 136, 333];
    const label = computeBadgeLabel(allSelected, selected);
    expect(label).toBe('106, 252, 250, 147, 136 +1');
  });

  it('205 seleccionados → muestra 5 IDs + "+200" (rebalse de 5 visibles, coincide con captura)', () => {
    // Este es exactamente el caso que reportó el usuario:
    // "Badge top: Móviles: 106, 252, 250, 147, 136 +200"
    // pero en ese momento era por el bug de allMovilesSelected falso.
    // Post-fix: si son realmente 205 seleccionados con allSelected=false,
    // el +200 es correcto porque es el rebalse real.
    const allSelected = false;
    const selected = Array.from({ length: 205 }, (_, i) => i + 1);
    const label = computeBadgeLabel(allSelected, selected);
    expect(label).toBe('1, 2, 3, 4, 5 +200');
  });

  it('80 seleccionados de 80 → allSelected=true → badge "Todos" (NO "+75")', () => {
    const filteredMoviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = filteredMoviles.map(m => m.id);
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    // Verificamos que con allSelected=true no entra al branch de parcial
    expect(computeBadgeLabel(allSelected, selectedMoviles)).toBe('Móviles: Todos');
    // Verificamos que tampoco genera +75 (80 - VISIBLE_IDS)
    expect(computeBadgeLabel(allSelected, selectedMoviles)).not.toContain('+75');
  });

  it('badge "Ninguno" cuando selectedMoviles está vacío', () => {
    expect(computeBadgeLabel(false, [])).toBe('Móviles: Ninguno');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EC3 — búsqueda local activa: allSelected y badge respetan solo los visibles
// ─────────────────────────────────────────────────────────────────────────────

describe('EC3 - búsqueda local: allSelected evalúa contra filteredMoviles (visibles)', () => {
  it('con búsqueda activa que filtra a 3 de 80 → allSelected si los 3 están seleccionados', () => {
    // El usuario escribe "10" en el buscador → filteredMoviles = [10, 100, 101, ...]
    // Simulamos que solo 3 móviles son visibles tras la búsqueda.
    const filteredMoviles: MinMovil[] = [{ id: 10 }, { id: 100 }, { id: 101 }];
    // Solo esos 3 están seleccionados
    const selectedMoviles = [10, 100, 101];
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(true);
    expect(computeBadgeLabel(allSelected, selectedMoviles)).toBe('Móviles: Todos');
  });

  it('con búsqueda activa, un visible no seleccionado → allSelected=false', () => {
    const filteredMoviles: MinMovil[] = [{ id: 10 }, { id: 100 }, { id: 101 }];
    const selectedMoviles = [10, 100]; // 101 no está seleccionado
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(false);
  });

  it('filteredMoviles vacío por búsqueda sin resultados → allSelected=false (EC1)', () => {
    const filteredMoviles: MinMovil[] = [];
    const selectedMoviles = [106, 252]; // había seleccionados previos
    const allSelected = computeAllSelected(filteredMoviles, selectedMoviles);
    expect(allSelected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EC5 — deseleccionar todo → comportamiento idéntico a sin filtro
// ─────────────────────────────────────────────────────────────────────────────

describe('EC5 - deselect all: sin móviles seleccionados = vista sin filtro', () => {
  it('con selectedMoviles vacío, filterPedidosByMovil no filtra nada', () => {
    const pedidos = [pedidoConMovil106, pedidoSinMovilNull, pedidoSinMovilCero, pedidoMovilInactivo330];
    const result = filterPedidosByMovil(pedidos, []);
    // Sin filtro activo, todos pasan (igual que primer login)
    expect(result).toHaveLength(4);
  });

  it('con selectedMoviles vacío, filterServicesByMovil no filtra nada', () => {
    const services = [servicioConMovil106, servicioSinMovil, servicioSinMovilCero];
    const result = filterServicesByMovil(services, []);
    expect(result).toHaveLength(3);
  });

  it('badge con selectedMoviles vacío → "Ninguno"', () => {
    const allSelected = computeAllSelected([{ id: 106 }], []);
    expect(allSelected).toBe(false);
    expect(computeBadgeLabel(false, [])).toBe('Móviles: Ninguno');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC7 — badge del header usa allMovilesSelected (universo operativo, no
// filteredMoviles). Bug reportado: deseleccionar todo, filtrar 1 móvil por
// search y seleccionarlo hacía que el badge dijera "Todos" cuando debería
// decir el ID del móvil seleccionado.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC7 - badge usa universo operativo (no filteredMoviles)', () => {
  it('search filtra a 1 móvil de 80, ese 1 seleccionado → badge muestra ID, NO "Todos"', () => {
    const moviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = [42]; // solo el móvil 42 seleccionado
    const allMovilesSelected = computeAllMovilesSelected(moviles, selectedMoviles);
    expect(allMovilesSelected).toBe(false);
    expect(computeBadgeLabel(allMovilesSelected, selectedMoviles)).toBe('42');
  });

  it('los 80 móviles operativos seleccionados → badge "Todos"', () => {
    const moviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = moviles.map(m => m.id);
    const allMovilesSelected = computeAllMovilesSelected(moviles, selectedMoviles);
    expect(allMovilesSelected).toBe(true);
    expect(computeBadgeLabel(allMovilesSelected, selectedMoviles)).toBe('Móviles: Todos');
  });

  it('80 visibles pero solo 1 seleccionado → badge muestra ID (caso del bug reportado)', () => {
    const moviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const selectedMoviles = [1];
    const allMovilesSelected = computeAllMovilesSelected(moviles, selectedMoviles);
    expect(allMovilesSelected).toBe(false);
    expect(computeBadgeLabel(allMovilesSelected, selectedMoviles)).toBe('1');
  });

  it('hiddenMovilIds excluidos del cálculo del badge', () => {
    // 80 móviles totales, 5 ocultos-pero-operativos. selectedMoviles cubre los 75
    // visibles → debe ser allMovilesSelected=true (los hidden no cuentan).
    const moviles: MinMovil[] = Array.from({ length: 80 }, (_, i) => ({ id: i + 1 }));
    const hiddenMovilIds = new Set<number>([76, 77, 78, 79, 80]);
    const selectedMoviles = moviles.filter(m => !hiddenMovilIds.has(m.id)).map(m => m.id);
    const allMovilesSelected = computeAllMovilesSelected(moviles, selectedMoviles, hiddenMovilIds);
    expect(allMovilesSelected).toBe(true);
  });

  it('moviles vacío → allMovilesSelected=false (no hay nada que llamar "Todos")', () => {
    expect(computeAllMovilesSelected([], [])).toBe(false);
    expect(computeAllMovilesSelected([], [106])).toBe(false);
  });

  it('selectedMoviles incluye IDs huérfanos que no están en moviles → no afecta', () => {
    // Un ID seleccionado que ya no existe en moviles (móvil dado de baja).
    // El badge debe basarse solo en si todos los moviles actuales están seleccionados.
    const moviles: MinMovil[] = [{ id: 1 }, { id: 2 }];
    const selectedMoviles = [1, 2, 99]; // 99 ya no existe
    const allMovilesSelected = computeAllMovilesSelected(moviles, selectedMoviles);
    expect(allMovilesSelected).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EC1 — empresa fletera con 0 móviles disponibles
// ─────────────────────────────────────────────────────────────────────────────

describe('EC1 - empresa con 0 móviles disponibles', () => {
  it('filteredMoviles vacío → allSelected=false (no puede ser "Todos")', () => {
    expect(computeAllSelected([], [])).toBe(false);
  });

  it('filteredMoviles vacío + selectedMoviles vacío → badge "Ninguno"', () => {
    const allSelected = computeAllSelected([], []);
    expect(computeBadgeLabel(allSelected, [])).toBe('Móviles: Ninguno');
  });

  it('filteredMoviles vacío + selectedMoviles con IDs (estado extraño) → badge parcial, no "Todos"', () => {
    const allSelected = computeAllSelected([], [106]);
    expect(allSelected).toBe(false);
    // No debería mostrar "Todos" en ningún caso con filteredMoviles vacío
    expect(computeBadgeLabel(allSelected, [106])).not.toBe('Móviles: Todos');
  });
});
