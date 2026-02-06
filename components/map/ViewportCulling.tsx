'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';

/**
 * 🚀 VIEWPORT CULLING HOOK
 * 
 * Solo renderiza marcadores que están dentro del viewport actual del mapa + un margen.
 * Con 600 pedidos, si el usuario está viendo un zoom alto, quizás solo se renderizan 30-50
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
 * Hook que filtra items por viewport del mapa con margen configurable.
 * Perfecto para filtrar pedidos, servicios y puntos de interés visibles.
 * 
 * @param items Array de items con lat/lng
 * @param getCoords Función que extrae lat/lng de cada item
 * @param marginFactor Factor de margen extra (1.5 = 50% extra en cada dirección)
 * @returns Items que están dentro del viewport
 */
export function useViewportCulling<T>(
  items: T[],
  getCoords: (item: T) => GeoItem | null,
  marginFactor: number = 1.3
): T[] {
  const map = useMap();
  const [visibleItems, setVisibleItems] = useState<T[]>(items);
  const boundsRef = useRef<ViewportBounds | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const getCoordsRef = useRef(getCoords);
  getCoordsRef.current = getCoords;

  const filterByViewport = useCallback(() => {
    const bounds = map.getBounds();
    const latDiff = (bounds.getNorth() - bounds.getSouth()) * (marginFactor - 1);
    const lngDiff = (bounds.getEast() - bounds.getWest()) * (marginFactor - 1);

    const expandedBounds: ViewportBounds = {
      north: bounds.getNorth() + latDiff,
      south: bounds.getSouth() - latDiff,
      east: bounds.getEast() + lngDiff,
      west: bounds.getWest() - lngDiff,
    };

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

  // Throttled update on map move
  const throttledFilter = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = setTimeout(filterByViewport, 150);
  }, [filterByViewport]);

  useEffect(() => {
    // Initial filter
    filterByViewport();

    // Listen to map movements
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

  // Re-filter when items change
  useEffect(() => {
    filterByViewport();
  }, [items.length, filterByViewport]);

  return visibleItems;
}

/**
 * 🚀 COMPONENT: ViewportCullingLayer
 * 
 * Componente que envuelve marcadores y solo renderiza los visibles en el viewport.
 * Uso: <ViewportCullingLayer> dentro de MapContainer.
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

  // Solo mostrar en desarrollo
  if (process.env.NODE_ENV !== 'development') return null;

  return null; // No mostrar nada visualmente, solo para debug interno
}
