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
}

/**
 * Capa de zonas con información de demoras.
 * Muestra todas las zonas pintadas, con etiqueta de nro de zona y demora en minutos.
 */
const DemorasZonasLayer = memo(function DemorasZonasLayer({ zonas, demoras }: DemorasZonasLayerProps) {
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

      // Calcular centro del polígono para poner la etiqueta
      const latSum = validGeo.reduce((s: number, p: any) => s + p.lat, 0);
      const lngSum = validGeo.reduce((s: number, p: any) => s + p.lng, 0);
      const center: [number, number] = [latSum / validGeo.length, lngSum / validGeo.length];

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
                  <span class="demora-label-zona">Z${zona.zona_id}</span>
                  <span class="demora-label-time ${!demoraActiva ? 'demora-inactive' : ''}">${minutos} min</span>
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
