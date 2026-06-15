'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useMap } from 'react-leaflet';

/**
 * VIEWPORT CULLING HOOK
 *
 * Solo renderiza marcadores que estan dentro del viewport actual del mapa + un margen.
 * Con 600 pedidos, si el usuario esta viendo un zoom alto, quizas solo se renderizan 30-50
 * en lugar de los 600, ahorrando enormes cantidades de CPU y memoria DOM.
 */

interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface GeoItem {
  lat: number;
  lng: number;
}

/**
 * Verifica si un bounding box nuevo esta dentro del bounding box viejo con tolerancia.
 * Devuelve true si el viewport nuevo esta "contenido" en el anterior (con tolerancia del 5%),
 * lo que significa que no hace falta recalcular los items visibles.
 */
function isWithinTolerance(prev: ViewportBounds, next: ViewportBounds, tolerance: number = 0.05): boolean {
  const latSpan = prev.north - prev.south;
  const lngSpan = prev.east - prev.west;
  const latTol = latSpan * tolerance;
  const lngTol = lngSpan * tolerance;
  return (
    next.south >= prev.south - latTol &&
    next.north <= prev.north + latTol &&
    next.west >= prev.west - lngTol &&
    next.east <= prev.east + lngTol
  );
}

/**
 * Hook que filtra items por viewport del mapa con margen configurable.
 * Perfecto para filtrar pedidos, servicios y puntos de interes visibles.
 *
 * @param items Array de items con lat/lng
 * @param getCoords Funcion que extrae lat/lng de cada item
 * @param marginFactor Factor de margen extra expresado como fraccion del viewport
 *   (0.25 = 25% extra en cada direccion, equivalente a Leaflet bounds.pad(0.25))
 * @returns Items que estan dentro del viewport
 */
export function useViewportCulling<T>(
  items: T[],
  getCoords: (item: T) => GeoItem | null,
  marginFactor: number = 0.25
): T[] {
  const map = useMap();
  const [visibleItems, setVisibleItems] = useState<T[]>(items);
  const boundsRef = useRef<ViewportBounds | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const getCoordsRef = useRef(getCoords);
  getCoordsRef.current = getCoords;

  const filterByViewport = useCallback(() => {
    const bounds = map.getBounds();

    // Calcular viewport expandido con margen (equivalente a Leaflet bounds.pad(marginFactor))
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const latPad = latSpan * marginFactor;
    const lngPad = lngSpan * marginFactor;

    const expandedBounds: ViewportBounds = {
      north: bounds.getNorth() + latPad,
      south: bounds.getSouth() - latPad,
      east: bounds.getEast() + lngPad,
      west: bounds.getWest() - lngPad,
    };

    // Optimizacion: si el viewport nuevo esta dentro del anterior con tolerancia del 5%,
    // no recalcular los items — el subset ya es correcto.
    if (boundsRef.current && isWithinTolerance(boundsRef.current, expandedBounds, 0.05)) {
      return;
    }

    boundsRef.current = expandedBounds;

    const filtered = itemsRef.current.filter(item => {
      const coords = getCoordsRef.current(item);
      if (!coords) return false;
      return (
        coords.lat >= expandedBounds.south &&
        coords.lat <= expandedBounds.north &&
        coords.lng >= expandedBounds.west &&
        coords.lng <= expandedBounds.east
      );
    });

    setVisibleItems(filtered);
  }, [map, marginFactor]);

  // Throttled update on map move — 150ms para coalescer eventos durante pan continuo
  const throttledFilter = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = setTimeout(filterByViewport, 150);
  }, [filterByViewport]);

  useEffect(() => {
    // Filtro inicial
    filterByViewport();

    // Escuchar movimientos del mapa
    map.on('moveend', throttledFilter);
    map.on('zoomend', throttledFilter);

    return () => {
      map.off('moveend', throttledFilter);
      map.off('zoomend', throttledFilter);
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [map, filterByViewport, throttledFilter]);

  // Re-filtrar cuando cambia la cantidad de items (entrada o salida de datos en tiempo real)
  useEffect(() => {
    // Invalidar boundsRef para forzar recalculo cuando los items cambian
    boundsRef.current = null;
    filterByViewport();
  }, [items.length, filterByViewport]);

  return visibleItems;
}

/**
 * Hook extendido de viewport culling con soporte para items "siempre visibles".
 *
 * Los items en alwaysVisibleIds NUNCA son culled, aunque esten fuera del viewport.
 * Usar para: movil con popup abierto, pedido seleccionado, service con popup abierto.
 *
 * @param items Array de items con lat/lng
 * @param getCoords Funcion que extrae lat/lng de cada item
 * @param getId Funcion que extrae el ID unico de cada item
 * @param alwaysVisibleIds Set de IDs que nunca deben ser culled
 * @param marginFactor Factor de margen (default 0.25 = 25%)
 */
export function useViewportCullingWithAlwaysVisible<T>(
  items: T[],
  getCoords: (item: T) => GeoItem | null,
  getId: (item: T) => string | number,
  alwaysVisibleIds: Set<string | number>,
  marginFactor: number = 0.25
): T[] {
  const culled = useViewportCulling(items, getCoords, marginFactor);

  return useMemo(() => {
    if (alwaysVisibleIds.size === 0) return culled;

    // Agregar items que deben ser siempre visibles y no estan en el resultado culled
    const culledIds = new Set(culled.map(getId));
    const forcedVisible = items.filter(item => {
      const id = getId(item);
      return alwaysVisibleIds.has(id) && !culledIds.has(id);
    });

    if (forcedVisible.length === 0) return culled;
    return [...culled, ...forcedVisible];
  }, [culled, items, alwaysVisibleIds, getId]);
}

/**
 * COMPONENT: ViewportCullingStats
 *
 * Componente de estadisticas para debugging. Solo visible en desarrollo.
 */
export function ViewportCullingStats() {
  const map = useMap();
  const [stats, setStats] = useState({ zoom: 0, markersInView: 0 });

  useEffect(() => {
    const updateStats = () => {
      setStats({
        zoom: map.getZoom(),
        markersInView: 0, // Se actualiza externamente
      });
    };

    map.on('zoomend', updateStats);
    map.on('moveend', updateStats);
    updateStats();

    return () => {
      map.off('zoomend', updateStats);
      map.off('moveend', updateStats);
    };
  }, [map]);

  if (process.env.NODE_ENV !== 'development') return null;

  void stats; // Silenciar linting — la variable se usa internamente para debug
  return null;
}
