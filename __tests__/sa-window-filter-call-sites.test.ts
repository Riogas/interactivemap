/**
 * Tests para los call sites de isWithinSaWindow en dashboard/page.tsx
 * y ZonaEstadisticasModal.tsx.
 *
 * Valida la LOGICA de filtrado aplicada en cada superficie (no los componentes React
 * completos — eso requiere una suite de integración con React Testing Library).
 *
 * Cada describe corresponde a una superficie de computo de SA.
 */

import { describe, it, expect } from 'vitest';
import { isWithinSaWindow } from '../lib/sa-window-filter';

const now = new Date('2026-05-11T14:00:00.000Z');
const minutosAntes = 30;

// ────────────────────────────────────────────────────────────────────────────
// Helpers que replican la logica de filtrado de cada superficie
// ────────────────────────────────────────────────────────────────────────────

type PedidoLike = {
  estado_nro: number;
  movil?: string | number | null;
  fch_hora_para?: string | null;
  zona_nro?: number | null;
};

/**
 * Replica la logica de pendientesList en ZonaEstadisticasModal.tsx.
 * hideSinAsignar=false (root/despacho), serverNow y minutosAntesSa variables.
 */
function computePendientesList(
  pedidosZona: PedidoLike[],
  hideSinAsignar: boolean,
  serverNow: Date | undefined,
  minutosAntesSa: number | null,
): PedidoLike[] {
  return pedidosZona.filter(p => {
    if (Number(p.estado_nro) !== 1) return false;
    const isSinAsignar = !p.movil || Number(p.movil) === 0;
    if (hideSinAsignar && isSinAsignar) return false;
    // SA fuera de ventana temporal: excluir de TODO computo (no solo visibilidad).
    if (isSinAsignar && serverNow && !isWithinSaWindow(p.fch_hora_para ?? null, serverNow, minutosAntesSa)) return false;
    return true;
  });
}

function computeSinAsignar(pendientesList: PedidoLike[]): number {
  return pendientesList.filter(p => !p.movil || Number(p.movil) === 0).length;
}

/**
 * Replica la logica de filtrado de pedidosZonaData en dashboard/page.tsx
 * para el caso filter === 'sin_asignar'.
 */
function filterPedidosParaZonaSinAsignar(
  pedidos: PedidoLike[],
  serverNow: Date,
  minutosAntesSa: number | null,
): PedidoLike[] {
  return pedidos.filter(p => {
    const estado = Number(p.estado_nro);
    const tieneMovil = p.movil != null && Number(p.movil) !== 0;
    // sin asignar = estado 1 sin movil asignado
    if (!(estado === 1 && !tieneMovil)) return false;
    // SA fuera de ventana temporal: excluir de todo computo.
    if (serverNow && !isWithinSaWindow(p.fch_hora_para ?? null, serverNow, minutosAntesSa)) return false;
    return true;
  });
}

/**
 * Replica el filtro de sinAsignarList para SaturacionZonaModal en dashboard/page.tsx.
 */
function filterSinAsignarList(
  pedidos: PedidoLike[],
  zonaId: number,
  serverNow: Date,
  minutosAntesSa: number | null,
): PedidoLike[] {
  return pedidos.filter(p =>
    Number(p.estado_nro) === 1 &&
    (p.movil == null || Number(p.movil) === 0) &&
    Number(p.zona_nro) === zonaId &&
    // SA fuera de ventana temporal: excluir de TODO computo.
    (!serverNow || isWithinSaWindow(p.fch_hora_para ?? null, serverNow, minutosAntesSa)),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Datos de prueba
// ────────────────────────────────────────────────────────────────────────────

const saEnVentana: PedidoLike = { estado_nro: 1, movil: null, fch_hora_para: '2026-05-11T14:15:00.000Z', zona_nro: 5 }; // dentro de ventana (now + 15min)
const saFueraVentana: PedidoLike = { estado_nro: 1, movil: null, fch_hora_para: '2026-05-11T13:00:00.000Z', zona_nro: 5 }; // pasado, fuera de ventana
const saFuturoLejano: PedidoLike = { estado_nro: 1, movil: null, fch_hora_para: '2026-05-11T18:00:00.000Z', zona_nro: 5 }; // futuro lejano, fuera de ventana
const saConHoraNula: PedidoLike = { estado_nro: 1, movil: null, fch_hora_para: null, zona_nro: 5 };           // sin hora: siempre cuenta (backwards-compat)
const pedidoAsignado: PedidoLike = { estado_nro: 1, movil: '42', fch_hora_para: '2026-05-11T13:00:00.000Z', zona_nro: 5 }; // asignado: no aplica filtro de ventana
const pedidoEntregado: PedidoLike = { estado_nro: 2, movil: null, fch_hora_para: '2026-05-11T14:15:00.000Z', zona_nro: 5 };

// ────────────────────────────────────────────────────────────────────────────
// 1. ZonaEstadisticasModal — pendientesList y sinAsignar
// ────────────────────────────────────────────────────────────────────────────

describe('ZonaEstadisticasModal — pendientesList y sinAsignar con isWithinSaWindow', () => {
  it('SA dentro de ventana: cuenta como pendiente y como sinAsignar', () => {
    const list = computePendientesList([saEnVentana], false, now, minutosAntes);
    expect(list).toHaveLength(1);
    expect(computeSinAsignar(list)).toBe(1);
  });

  it('SA fuera de ventana (pasado): excluido de pendientesList y sinAsignar', () => {
    const list = computePendientesList([saFueraVentana], false, now, minutosAntes);
    expect(list).toHaveLength(0);
    expect(computeSinAsignar(list)).toBe(0);
  });

  it('SA futuro lejano (> now + minutosAntes): excluido de pendientesList y sinAsignar', () => {
    const list = computePendientesList([saFuturoLejano], false, now, minutosAntes);
    expect(list).toHaveLength(0);
    expect(computeSinAsignar(list)).toBe(0);
  });

  it('SA con fch_hora_para null: siempre cuenta (backwards-compat falta de dato)', () => {
    const list = computePendientesList([saConHoraNula], false, now, minutosAntes);
    expect(list).toHaveLength(1);
    expect(computeSinAsignar(list)).toBe(1);
  });

  it('pedido asignado fuera de ventana: cuenta igual (filtro solo aplica a SA)', () => {
    const list = computePendientesList([pedidoAsignado], false, now, minutosAntes);
    expect(list).toHaveLength(1); // asignado con movil, no le aplica el filtro de ventana
  });

  it('pedido entregado: nunca cuenta (estado_nro !== 1)', () => {
    const list = computePendientesList([pedidoEntregado], false, now, minutosAntes);
    expect(list).toHaveLength(0);
  });

  it('minutosAntes=null: sin filtro, SA fuera de ventana igual cuenta (backwards-compat)', () => {
    const list = computePendientesList([saFueraVentana], false, now, null);
    expect(list).toHaveLength(1);
    expect(computeSinAsignar(list)).toBe(1);
  });

  it('serverNow=undefined: sin filtro, SA fuera de ventana igual cuenta', () => {
    const list = computePendientesList([saFueraVentana], false, undefined, minutosAntes);
    expect(list).toHaveLength(1);
  });

  it('mezcla de SA en ventana, fuera y asignados: solo cuenta correctos', () => {
    const all = [saEnVentana, saFueraVentana, saFuturoLejano, pedidoAsignado, saConHoraNula];
    const list = computePendientesList(all, false, now, minutosAntes);
    // en ventana + con hora nula + asignado = 3
    expect(list).toHaveLength(3);
    // sinAsignar: en ventana + con hora nula = 2
    expect(computeSinAsignar(list)).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. dashboard/page.tsx — pedidosZonaData (rama sin_asignar)
// ────────────────────────────────────────────────────────────────────────────

describe('dashboard pedidosZonaData — capa sin_asignar con isWithinSaWindow', () => {
  it('SA en ventana: incluido en conteo de la capa', () => {
    const result = filterPedidosParaZonaSinAsignar([saEnVentana], now, minutosAntes);
    expect(result).toHaveLength(1);
  });

  it('SA fuera de ventana: excluido del conteo de la capa', () => {
    const result = filterPedidosParaZonaSinAsignar([saFueraVentana], now, minutosAntes);
    expect(result).toHaveLength(0);
  });

  it('SA con fch_hora_para null: siempre incluido (backwards-compat)', () => {
    const result = filterPedidosParaZonaSinAsignar([saConHoraNula], now, minutosAntes);
    expect(result).toHaveLength(1);
  });

  it('pedido asignado: no se incluye en capa sin_asignar', () => {
    const result = filterPedidosParaZonaSinAsignar([pedidoAsignado], now, minutosAntes);
    expect(result).toHaveLength(0);
  });

  it('minutosAntes=null: sin filtro (backwards-compat)', () => {
    const result = filterPedidosParaZonaSinAsignar([saFueraVentana], now, null);
    expect(result).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. dashboard/page.tsx — sinAsignarList para SaturacionZonaModal
// ────────────────────────────────────────────────────────────────────────────

describe('dashboard sinAsignarList para SaturacionZonaModal con isWithinSaWindow', () => {
  it('SA en ventana y misma zona: incluido en la lista del modal', () => {
    const result = filterSinAsignarList([saEnVentana], 5, now, minutosAntes);
    expect(result).toHaveLength(1);
  });

  it('SA fuera de ventana: excluido de la lista del modal', () => {
    const result = filterSinAsignarList([saFueraVentana], 5, now, minutosAntes);
    expect(result).toHaveLength(0);
  });

  it('SA en ventana pero zona diferente: excluido (zona_nro no coincide)', () => {
    const saOtraZona: PedidoLike = { ...saEnVentana, zona_nro: 9 };
    const result = filterSinAsignarList([saOtraZona], 5, now, minutosAntes);
    expect(result).toHaveLength(0);
  });

  it('SA con fch_hora_para null: siempre incluido (backwards-compat)', () => {
    const result = filterSinAsignarList([saConHoraNula], 5, now, minutosAntes);
    expect(result).toHaveLength(1);
  });

  it('minutosAntes=null: sin filtro, SA fuera de ventana igual se lista', () => {
    const result = filterSinAsignarList([saFueraVentana], 5, now, null);
    expect(result).toHaveLength(1);
  });

  it('pedido asignado: no se incluye (tiene movil)', () => {
    const result = filterSinAsignarList([pedidoAsignado], 5, now, minutosAntes);
    expect(result).toHaveLength(0);
  });
});
