'use client';

import React, { memo, useMemo } from 'react';
import { Polygon, Marker } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export interface MovilesZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  demora_minutos: number | null;
  escenario_id: number;
}

interface MovilesZonasLayerProps {
  zonas: MovilesZonaData[];
  /** Map from zona_id → count of assigned móviles */
  movilesCount: Map<number, number>;
}

/**
 * Capa de zonas con cantidad de móviles asignados.
 * Muestra cada zona pintada con una etiqueta con el nro de zona y la cantidad de móviles.
 */
const MovilesZonasLayer = memo(function MovilesZonasLayer({ zonas, movilesCount }: MovilesZonasLayerProps) {
  if (!zonas || zonas.length === 0) return null;

  const items = useMemo(() => {
    return zonas.map((zona) => {
      let geo = zona.geojson;
      if (typeof geo === 'string') {
        try { geo = JSON.parse(geo); } catch { return null; }
      }
      if (!Array.isArray(geo) || geo.length < 3) return null;

      const positions: LatLngExpression[] = geo.map((p: any) => [p.lat, p.lng]);

      const latSum = geo.reduce((s: number, p: any) => s + p.lat, 0);
      const lngSum = geo.reduce((s: number, p: any) => s + p.lng, 0);
      const center: [number, number] = [latSum / geo.length, lngSum / geo.length];

      const count = movilesCount.get(zona.zona_id) ?? 0;
      const fillColor = zona.color || '#3b82f6';

      // Intensidad basada en cantidad de móviles
      const fillOpacity = count > 0 ? Math.min(0.15 + (count / 10) * 0.25, 0.50) : 0.08;

      return { zona, positions, center, fillColor, fillOpacity, count };
    }).filter(Boolean) as Array<{
      zona: MovilesZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      count: number;
    }>;
  }, [zonas, movilesCount]);

  return (
    <>
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              color: fillColor,
              fillColor: fillColor,
              fillOpacity,
              weight: 2,
              opacity: 0.8,
            }}
          />
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'moviles-count-label',
              html: `
                <div class="moviles-count-inner">
                  <span class="moviles-count-zona">Z${zona.zona_id}</span>
                  <span class="moviles-count-badge ${count === 0 ? 'count-zero' : ''}">${count} 🚛</span>
                </div>
              `,
              iconSize: [70, 36],
              iconAnchor: [35, 18],
            })}
            interactive={false}
          />
        </React.Fragment>
      ))}
    </>
  );
});

export default MovilesZonasLayer;
