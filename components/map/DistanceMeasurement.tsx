'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

/**
 * Calcula la distancia total entre una serie de puntos (en metros).
 */
function totalDistance(points: L.LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i - 1].distanceTo(points[i]);
  }
  return total;
}

/**
 * Formatea metros a texto legible.
 */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Crea un icono para los vértices de medición.
 */
function vertexIcon(isFirst: boolean = false): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: ${isFirst ? 14 : 10}px;
      height: ${isFirst ? 14 : 10}px;
      background: ${isFirst ? '#2563eb' : '#ffffff'};
      border: 2px solid ${isFirst ? '#1d4ed8' : '#2563eb'};
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [isFirst ? 14 : 10, isFirst ? 14 : 10],
    iconAnchor: [isFirst ? 7 : 5, isFirst ? 7 : 5],
  });
}

/**
 * Crea un tooltip con la distancia acumulada.
 */
function distanceLabel(meters: number): L.DivIcon {
  const text = formatDistance(meters);
  return L.divIcon({
    className: '',
    html: `<div style="
      background: rgba(0,0,0,0.75);
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      transform: translate(8px, -20px);
    ">${text}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/**
 * DistanceMeasurement — herramienta de medición por clic derecho.
 *
 * - Clic derecho en el mapa: abre menú "📏 Medir distancia"
 * - Una vez activo, cada clic agrega un punto y dibuja la línea
 * - Muestra la distancia total acumulada
 * - Doble clic o ESC o botón "Finalizar" para terminar
 * - Botón "Limpiar" para borrar medición
 */
export default function DistanceMeasurement() {
  const map = useMap();
  const [measuring, setMeasuring] = useState(false);
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number; latlng: L.LatLng } | null>(null);

  // Refs para las capas de Leaflet
  const polylineRef = useRef<L.Polyline | null>(null);
  const dashedLineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const labelsRef = useRef<L.Marker[]>([]);
  const totalLabelRef = useRef<L.Marker | null>(null);

  // Limpiar todas las capas del mapa
  const clearLayers = useCallback(() => {
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    if (dashedLineRef.current) {
      map.removeLayer(dashedLineRef.current);
      dashedLineRef.current = null;
    }
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    labelsRef.current.forEach(m => map.removeLayer(m));
    labelsRef.current = [];
    if (totalLabelRef.current) {
      map.removeLayer(totalLabelRef.current);
      totalLabelRef.current = null;
    }
  }, [map]);

  // Dibujar las capas cuando cambian los puntos
  useEffect(() => {
    if (!measuring && points.length === 0) return;

    // Limpiar capas previas
    if (polylineRef.current) map.removeLayer(polylineRef.current);
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    labelsRef.current.forEach(m => map.removeLayer(m));
    labelsRef.current = [];

    if (points.length === 0) return;

    // Dibujar polilínea
    polylineRef.current = L.polyline(points, {
      color: '#2563eb',
      weight: 3,
      opacity: 0.8,
      dashArray: '8, 6',
    }).addTo(map);

    // Dibujar vértices y etiquetas de distancia
    let accumulated = 0;
    points.forEach((pt, i) => {
      const marker = L.marker(pt, {
        icon: vertexIcon(i === 0),
        interactive: false,
        zIndexOffset: 10000,
      }).addTo(map);
      markersRef.current.push(marker);

      if (i > 0) {
        accumulated += points[i - 1].distanceTo(pt);
        const label = L.marker(pt, {
          icon: distanceLabel(accumulated),
          interactive: false,
          zIndexOffset: 10001,
        }).addTo(map);
        labelsRef.current.push(label);
      }
    });
  }, [points, measuring, map]);

  // Línea punteada que sigue al cursor
  useEffect(() => {
    if (!measuring || points.length === 0) return;

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (dashedLineRef.current) map.removeLayer(dashedLineRef.current);
      dashedLineRef.current = L.polyline(
        [points[points.length - 1], e.latlng],
        { color: '#93c5fd', weight: 2, opacity: 0.6, dashArray: '4, 4' }
      ).addTo(map);

      // Mostrar distancia total + segmento actual
      const segmentDist = points[points.length - 1].distanceTo(e.latlng);
      const total = totalDistance(points) + segmentDist;
      if (totalLabelRef.current) map.removeLayer(totalLabelRef.current);
      totalLabelRef.current = L.marker(e.latlng, {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            background: rgba(37,99,235,0.85);
            color: white;
            padding: 1px 5px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            transform: translate(12px, -18px);
          ">${formatDistance(total)}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 10002,
      }).addTo(map);
    };

    map.on('mousemove', onMouseMove);
    return () => {
      map.off('mousemove', onMouseMove);
      if (dashedLineRef.current) {
        map.removeLayer(dashedLineRef.current);
        dashedLineRef.current = null;
      }
      if (totalLabelRef.current) {
        map.removeLayer(totalLabelRef.current);
        totalLabelRef.current = null;
      }
    };
  }, [measuring, points, map]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const timer = setTimeout(() => {
      document.addEventListener('click', close, { once: true });
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [menuPos]);

  // ESC para finalizar medición
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && measuring) {
        setMeasuring(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [measuring, map]);

  // Eventos del mapa
  useMapEvents({
    contextmenu: (e) => {
      if (measuring) return; // Si ya está midiendo, no mostrar menú
      L.DomEvent.preventDefault(e.originalEvent);
      const containerPoint = map.latLngToContainerPoint(e.latlng);
      setMenuPos({ x: containerPoint.x, y: containerPoint.y, latlng: e.latlng });
    },
    click: (e) => {
      if (!measuring) return;
      setPoints(prev => [...prev, e.latlng]);
    },
    dblclick: (e) => {
      if (!measuring) return;
      L.DomEvent.stop(e);
      setMeasuring(false);
      map.getContainer().style.cursor = '';
    },
  });

  // Iniciar medición
  const startMeasuring = useCallback(() => {
    clearLayers();
    setPoints([]);
    setMeasuring(true);
    setMenuPos(null);
    // Agregar el punto donde se hizo clic derecho como primer punto
    if (menuPos) {
      setPoints([menuPos.latlng]);
    }
  }, [clearLayers, map, menuPos]);

  // Finalizar medición
  const stopMeasuring = useCallback(() => {
    setMeasuring(false);
  }, []);

  // Limpiar todo
  const clearMeasurement = useCallback(() => {
    setMeasuring(false);
    setPoints([]);
    clearLayers();
  }, [clearLayers]);

  const dist = totalDistance(points);

  return (
    <>
      {/* Menú contextual */}
      {menuPos && (
        <div
          className="absolute z-[20000] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px]"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2"
            onClick={startMeasuring}
          >
            <span>📏</span> Medir distancia
          </button>
        </div>
      )}

      {/* Barra de control cuando está midiendo o hay medición */}
      {(measuring || points.length > 1) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[20000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 text-base">📏</span>
            <span className="text-sm font-bold text-gray-900">
              {points.length <= 1 ? 'Clic para agregar puntos' : formatDistance(dist)}
            </span>
            {points.length > 1 && (
              <span className="text-xs text-gray-500">({points.length} puntos)</span>
            )}
          </div>
          {measuring && (
            <button
              onClick={stopMeasuring}
              className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Finalizar
            </button>
          )}
          <button
            onClick={clearMeasurement}
            className="px-3 py-1 text-xs font-semibold bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
          >
            Limpiar
          </button>
          {measuring && (
            <span className="text-[10px] text-gray-400">ESC para finalizar · Doble clic para terminar</span>
          )}
        </div>
      )}
    </>
  );
}
