/**
 * Tests de regresión: los markers de móviles no se movían en vivo al llegar
 * una coordenada realtime, aunque el estado sí se actualizaba (el registro
 * del último GPS se veía bien).
 *
 * Causa raíz — DOS compuertas en serie que ignoraban la posición:
 *  1) arePropsEqual (components/map/MapView.tsx, React.memo de MapView)
 *     comparaba móviles solo por length + id + history.length; nunca miraba
 *     currentPosition → un GPS (mismo length, mismos ids) devolvía "equal"
 *     y React salteaba el render completo del mapa.
 *  2) useViewportCulling (components/map/ViewportCulling.tsx) guardaba los
 *     móviles visibles en useState y solo re-filtraba cuando cambiaba
 *     items.length (o en moveend/zoomend fuera de tolerancia) → aun con el
 *     memo arreglado, visibleItems retenía las referencias VIEJAS.
 *
 * Pedidos/services sí funcionaban porque al cumplirse SALEN del array:
 * cambia el length y eso atraviesa ambas compuertas.
 *
 * Los componentes no pueden instanciarse en env node (react-leaflet requiere
 * DOM), así que — como en movil-filter-fix.test.ts — replicamos la lógica
 * pura afectada y validamos los call sites reales leyendo el fuente.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos mínimos (mirror de MovilData / currentPosition)
// ─────────────────────────────────────────────────────────────────────────────

interface MinPosition {
  identificador?: number;
  coordX: number;
  coordY: number;
  fechaInsLog?: string;
}

interface MinMovil {
  id: number;
  currentPosition?: MinPosition;
  history?: MinPosition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica exacta de la sección de móviles de arePropsEqual (MapView.tsx, post-fix)
// ─────────────────────────────────────────────────────────────────────────────

function movilesSectionPropsEqual(prev: MinMovil[], next: MinMovil[]): boolean {
  return (
    prev.length === next.length &&
    // Comparación de IDs de móviles (más barato que deep equal)
    prev.every((m, i) => m.id === next[i]?.id) &&
    // Detectar cuando se carga el historial de un móvil
    prev.every((m, i) => (m.history?.length ?? 0) === (next[i]?.history?.length ?? 0)) &&
    // Detectar movimiento: el dashboard recrea currentPosition inmutablemente
    // en cada GPS, así que basta comparar la referencia
    prev.every((m, i) => m.currentPosition === next[i]?.currentPosition)
  );
}

/** Réplica del comparador PRE-fix (documentación del bug). */
function movilesSectionPropsEqualLegacy(prev: MinMovil[], next: MinMovil[]): boolean {
  return (
    prev.length === next.length &&
    prev.every((m, i) => m.id === next[i]?.id) &&
    prev.every((m, i) => (m.history?.length ?? 0) === (next[i]?.history?.length ?? 0))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Réplica exacta del update de GPS del dashboard (app/dashboard/page.tsx,
// setMoviles del handler realtime): objeto posición nuevo, misma referencia
// para los móviles no tocados.
// ─────────────────────────────────────────────────────────────────────────────

function applyGpsUpdate(moviles: MinMovil[], movilId: number, pos: MinPosition): MinMovil[] {
  return moviles.map(movil => {
    if (movil.id !== movilId) return movil; // misma referencia, no toca
    return {
      ...movil,
      currentPosition: pos,
      history: movil.history ? [pos, ...movil.history] : undefined,
    };
  });
}

/**
 * Réplica del patrón de movilesFilteredMarked (page.tsx): clona los móviles
 * con spread (objetos nuevos) pero conserva la referencia de currentPosition.
 */
function spreadCloneKeepingPositions(moviles: MinMovil[]): MinMovil[] {
  return moviles.map(m => ({ ...m }));
}

const baseMoviles = (): MinMovil[] => [
  { id: 101, currentPosition: { identificador: 1, coordX: -34.90, coordY: -56.16, fechaInsLog: '2026-07-15T10:00:00Z' } },
  { id: 205, currentPosition: { identificador: 2, coordX: -34.85, coordY: -56.20, fechaInsLog: '2026-07-15T10:00:05Z' } },
  { id: 310, currentPosition: { identificador: 3, coordX: -34.88, coordY: -56.10, fechaInsLog: '2026-07-15T10:00:07Z' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Compuerta 1: React.memo de MapView
// ─────────────────────────────────────────────────────────────────────────────

describe('arePropsEqual (sección móviles) — compuerta React.memo', () => {
  it('un GPS nuevo invalida el memo aunque length e ids no cambien (el marker debe moverse)', () => {
    const prev = baseMoviles();
    const next = applyGpsUpdate(prev, 205, {
      identificador: 4, coordX: -34.86, coordY: -56.21, fechaInsLog: '2026-07-15T10:00:12Z',
    });

    // Precondiciones del bug: mismo length, mismos ids, history sin cambios
    expect(next.length).toBe(prev.length);
    expect(next.every((m, i) => m.id === prev[i].id)).toBe(true);

    // Post-fix: el memo debe fallar → MapView re-renderiza → marker se mueve
    expect(movilesSectionPropsEqual(prev, next)).toBe(false);
  });

  it('sin GPS nuevo el memo se sostiene (no hay re-renders de más)', () => {
    const prev = baseMoviles();
    // Mismo array
    expect(movilesSectionPropsEqual(prev, prev)).toBe(true);
    // Array nuevo + objetos clonados con spread (patrón movilesFilteredMarked):
    // currentPosition conserva la referencia → sigue siendo "equal"
    expect(movilesSectionPropsEqual(prev, spreadCloneKeepingPositions(prev))).toBe(true);
  });

  it('sigue detectando altas/bajas de móviles y carga de history', () => {
    const prev = baseMoviles();
    expect(movilesSectionPropsEqual(prev, prev.slice(0, 2))).toBe(false); // baja
    const conHistory = prev.map((m, i) =>
      i === 0 ? { ...m, history: [m.currentPosition!] } : m
    );
    expect(movilesSectionPropsEqual(prev, conHistory)).toBe(false); // history cargado
  });

  it('documenta el bug: el comparador viejo NO detectaba el movimiento', () => {
    const prev = baseMoviles();
    const next = applyGpsUpdate(prev, 205, {
      identificador: 4, coordX: -34.86, coordY: -56.21, fechaInsLog: '2026-07-15T10:00:12Z',
    });
    // El comparador legacy devolvía true → React.memo salteaba el render
    expect(movilesSectionPropsEqualLegacy(prev, next)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Call sites reales: el fix tiene que estar en el fuente (las réplicas de
// arriba no protegen contra regresiones del archivo real)
// ─────────────────────────────────────────────────────────────────────────────

describe('call sites reales del fix', () => {
  const mapViewSrc = readFileSync(
    resolve(__dirname, '../components/map/MapView.tsx'),
    'utf-8'
  );
  const cullingSrc = readFileSync(
    resolve(__dirname, '../components/map/ViewportCulling.tsx'),
    'utf-8'
  );

  it('MapView.tsx: arePropsEqual compara currentPosition por referencia', () => {
    expect(mapViewSrc).toContain(
      'prev.moviles.every((m, i) => m.currentPosition === next.moviles[i]?.currentPosition)'
    );
  });

  it('ViewportCulling.tsx: el re-filtro depende de la referencia de items (no solo del length)', () => {
    // El effect de re-filtrado por datos debe reaccionar al array nuevo que
    // produce cada GPS (posiciones nuevas), no solo a altas/bajas.
    expect(cullingSrc).toContain('}, [items, filterByViewport]);');
    expect(cullingSrc).not.toContain('}, [items.length, filterByViewport]);');
  });
});
