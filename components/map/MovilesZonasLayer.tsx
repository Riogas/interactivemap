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
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
}

/**
 * Capa de zonas con cantidad de móviles asignados.
 * Muestra cada zona pintada con una etiqueta con el nro de zona y la cantidad de móviles.
 */
const MovilesZonasLayer = memo(function MovilesZonasLayer({ zonas, movilesCount, zonaOpacity = 50 }: MovilesZonasLayerProps) {
  const opacityFactor = zonaOpacity / 100;
  const items = useMemo(() => {
    if (!zonas || zonas.length === 0) return [];
    return zonas.map((zona) => {
      let geo: any = zona.geojson;
      if (typeof geo === 'string') {
        try { geo = JSON.parse(geo); } catch { return null; }
      }

      // Si es GeoJSON Feature/Geometry, extraer coordenadas
      if (geo && typeof geo === 'object' && !Array.isArray(geo)) {
        if (geo.type === 'Feature' && geo.geometry) geo = geo.geometry;
        if (geo.type === 'Polygon' && geo.coordinates) {
          geo = geo.coordinates[0]?.map((c: number[]) => ({ lat: c[1], lng: c[0] })) || [];
        } else if (geo.type === 'MultiPolygon' && geo.coordinates) {
          geo = geo.coordinates[0]?.[0]?.map((c: number[]) => ({ lat: c[1], lng: c[0] })) || [];
        }
      }

      if (!Array.isArray(geo) || geo.length < 3) return null;

      // Filtrar puntos válidos (lat/lng pueden venir como string desde la DB)
      const validGeo = geo
        .map((p: any) => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
        .filter((p: any) => isFinite(p.lat) && isFinite(p.lng));
      if (validGeo.length < 3) return null;

      const positions: LatLngExpression[] = validGeo.map((p: any) => [p.lat, p.lng]);

      const latSum = validGeo.reduce((s: number, p: any) => s + p.lat, 0);
      const lngSum = validGeo.reduce((s: number, p: any) => s + p.lng, 0);
      const center: [number, number] = [latSum / validGeo.length, lngSum / validGeo.length];

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

  if (items.length === 0) return null;

  return (
    <>
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              color: fillColor,
              fillColor: fillColor,
              fillOpacity: fillOpacity * opacityFactor,
              weight: 2,
              opacity: 0.8 * opacityFactor,
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
