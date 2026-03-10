'use client';

import React, { memo, useMemo } from 'react';
import { Polygon, Marker } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export interface DemoraZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  demora_minutos: number | null;
  activa: boolean;
  escenario_id: number;
}

interface DemorasZonasLayerProps {
  zonas: DemoraZonaData[];
  /** Map from zona_id → demora minutos (from demoras table) */
  demoras: Map<number, { minutos: number; activa: boolean }>;
  /** Mostrar etiquetas de demora (minutos). Por defecto false */
  showLabels?: boolean;
}

/**
 * Calcula el centroide de un polígono usando la fórmula del área con signo.
 * Mucho más preciso que el promedio simple para formas complejas / irregulares.
 */
function polygonCentroid(pts: Array<{ lat: number; lng: number }>): [number, number] {
  if (pts.length < 3) {
    // fallback: promedio simple
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
    // Polígono degenerado, usar promedio
    const latS = pts.reduce((s, p) => s + p.lat, 0);
    const lngS = pts.reduce((s, p) => s + p.lng, 0);
    return [latS / pts.length, lngS / pts.length];
  }
  const factor = 1 / (6 * area);
  return [cy * factor, cx * factor];
}

/**
 * Capa de zonas con información de demoras.
 * Muestra todas las zonas pintadas, con etiqueta de nro de zona y demora en minutos.
 */
const DemorasZonasLayer = memo(function DemorasZonasLayer({ zonas, demoras, showLabels = false }: DemorasZonasLayerProps) {
  const items = useMemo(() => {
    if (!zonas || zonas.length === 0) return [];
    const result = zonas.map((zona) => {
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

      // Calcular centroide del polígono (fórmula del área con signo)
      const center: [number, number] = polygonCentroid(validGeo);

      // Demora: primero buscar en tabla demoras, sino usar demora_minutos de la zona
      const demoraInfo = demoras.get(zona.zona_id);
      const minutos = demoraInfo?.minutos ?? zona.demora_minutos ?? 0;
      const demoraActiva = demoraInfo?.activa ?? true;

      const fillColor = zona.color || '#3b82f6';

      // Intensidad del fill basada en minutos de demora (más demora → más opaco)
      const fillOpacity = minutos > 0 ? Math.min(0.15 + (minutos / 120) * 0.35, 0.50) : 0.10;

      return { zona, positions, center, fillColor, fillOpacity, minutos, demoraActiva };
    }).filter(Boolean) as Array<{
      zona: DemoraZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      minutos: number;
      demoraActiva: boolean;
    }>;
    return result;
  }, [zonas, demoras]);

  if (items.length === 0) return null;

  return (
    <>
      {items.map(({ zona, positions, center, fillColor, fillOpacity, minutos, demoraActiva }) => (
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
              className: 'demora-label',
              html: `
                <div class="demora-label-inner">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${showLabels ? `<span class="demora-label-time ${!demoraActiva ? 'demora-inactive' : ''}">${minutos} min</span>` : ''}
                </div>
              `,
              iconSize: [60, 36],
              iconAnchor: [30, 18],
            })}
            interactive={false}
          />
        </React.Fragment>
      ))}
    </>
  );
});

export default DemorasZonasLayer;
