'use client';

import React, { memo, useMemo } from 'react';
import { Polygon, Marker } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export interface DistribucionZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  escenario_id: number;
}

interface DistribucionZonasLayerProps {
  zonas: DistribucionZonaData[];
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
}

/**
 * Calcula el centroide de un polígono usando la fórmula del área con signo.
 */
function polygonCentroid(pts: Array<{ lat: number; lng: number }>): [number, number] {
  if (pts.length < 3) {
    const latS = pts.reduce((s, p) => s + p.lat, 0);
    const lngS = pts.reduce((s, p) => s + p.lng, 0);
    return [latS / pts.length, lngS / pts.length];
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng, yi = pts[i].lat;
    const xj = pts[j].lng, yj = pts[j].lat;
    const cross = xi * yj - xj * yi;
    area += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    const latS = pts.reduce((s, p) => s + p.lat, 0);
    const lngS = pts.reduce((s, p) => s + p.lng, 0);
    return [latS / pts.length, lngS / pts.length];
  }
  const factor = 1 / (6 * area);
  return [cy * factor, cx * factor];
}

/**
 * Capa de zonas para la vista Distribución.
 * Muestra todas las zonas pintadas con su color de la tabla y el identificador de zona.
 */
// Ajusta opacidad base: 50%=valor original, 100%=sólido (1.0), <50%=más transparente
function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

const DistribucionZonasLayer = memo(function DistribucionZonasLayer({ zonas, zonaOpacity = 50 }: DistribucionZonasLayerProps) {
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

      const validGeo = geo
        .map((p: any) => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
        .filter((p: any) => isFinite(p.lat) && isFinite(p.lng));
      if (validGeo.length < 3) return null;

      const positions: LatLngExpression[] = validGeo.map((p: any) => [p.lat, p.lng]);
      const center: [number, number] = polygonCentroid(validGeo);
      const fillColor = zona.color || '#3b82f6';

      return { zona, positions, center, fillColor };
    }).filter(Boolean) as Array<{
      zona: DistribucionZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
    }>;
  }, [zonas]);

  if (items.length === 0) return null;

  return (
    <>
      {items.map(({ zona, positions, center, fillColor }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              // Borde negro fijo en todas las capas de zonas (request 2026-05-06).
              color: '#000000',
              fillColor: fillColor,
              fillOpacity: adjustOpacity(0.35, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.85, zonaOpacity),
            }}
          />
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'distribucion-label',
              html: `
                <div class="distribucion-label-inner">
                  <span class="distribucion-label-zona">${zona.zona_id}</span>
                </div>
              `,
              iconSize: [40, 24],
              iconAnchor: [20, 12],
            })}
            interactive={false}
          />
        </React.Fragment>
      ))}
    </>
  );
});

export default DistribucionZonasLayer;
