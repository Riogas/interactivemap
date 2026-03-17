'use client';

import React, { memo, useMemo } from 'react';
import { Polygon, Marker } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export interface ZonaActivaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  escenario_id: number;
}

interface ZonasActivasLayerProps {
  zonas: ZonaActivaData[];
  /** Map from zona_id → { minutos, activa } */
  demoras: Map<number, { minutos: number; activa: boolean }>;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
}

/** Centroide del polígono (área con signo) */
function polygonCentroid(pts: Array<{ lat: number; lng: number }>): [number, number] {
  if (pts.length < 3) {
    const latS = pts.reduce((s, p) => s + p.lat, 0);
    const lngS = pts.reduce((s, p) => s + p.lng, 0);
    return [latS / pts.length, lngS / pts.length];
  }
  let area = 0, cx = 0, cy = 0;
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

function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

/** Valida y normaliza geojson: soporta [{lat,lng}], Feature, Polygon, MultiPolygon */
function parseGeo(raw: any): Array<{ lat: number; lng: number }> | null {
  let geo = raw;
  if (typeof geo === 'string') { try { geo = JSON.parse(geo); } catch { return null; } }

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

  // parseFloat para soportar strings desde la DB
  const valid = geo
    .map((p: any) => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
    .filter((p: any) => isFinite(p.lat) && isFinite(p.lng));
  return valid.length >= 3 ? valid : null;
}

/**
 * Capa "Zonas Activas": dibuja polígonos de zonas coloreados según el campo
 * `activa` de la tabla demoras.  Verde = activa, Rojo = inactiva.
 * Las zonas sin registro en demoras se muestran en gris.
 * Etiqueta fija: nro de zona + "Activa" / "Inactiva".
 */
const ZonasActivasLayer = memo(function ZonasActivasLayer({
  zonas,
  demoras,
  zonaOpacity = 50,
}: ZonasActivasLayerProps) {
  // Pre-calcular etiquetas
  const labels = useMemo(() => {
    return zonas
      .map((z) => {
        const geo = parseGeo(z.geojson);
        if (!geo) return null;
        const centroid = polygonCentroid(geo);
        if (!isFinite(centroid[0]) || !isFinite(centroid[1])) return null;
        const info = demoras.get(z.zona_id);
        const activa = info?.activa ?? null;
        return { zona_id: z.zona_id, nombre: z.nombre, centroid, activa, minutos: info?.minutos ?? null };
      })
      .filter(Boolean) as Array<{ zona_id: number; nombre: string | null; centroid: [number, number]; activa: boolean | null; minutos: number | null }>;
  }, [zonas, demoras]);

  if (!zonas || zonas.length === 0) return null;

  return (
    <>
      {zonas.map((zona) => {
        const geo = parseGeo(zona.geojson);
        if (!geo) return null;

        const positions: LatLngExpression[] = geo.map((p) => [p.lat, p.lng]);
        const info = demoras.get(zona.zona_id);
        const activa = info?.activa ?? null;

        // Verde activa, rojo inactiva, gris sin dato
        const fillColor = activa === true ? '#22c55e' : activa === false ? '#ef4444' : '#9ca3af';
        const borderColor = activa === true ? '#16a34a' : activa === false ? '#dc2626' : '#6b7280';

        return (
          <Polygon
            key={zona.zona_id}
            positions={positions}
            pathOptions={{
              color: borderColor,
              fillColor,
              fillOpacity: adjustOpacity(0.35, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.8, zonaOpacity),
            }}
          />
        );
      })}

      {/* Etiquetas fijas en el centroide */}
      {labels.map((lbl) => {
        const bgColor = lbl.activa === true ? '#22c55e' : lbl.activa === false ? '#ef4444' : '#9ca3af';
        const text = lbl.activa === true ? 'Activa' : lbl.activa === false ? 'Inactiva' : 'Sin dato';

        return (
          <Marker
            key={`label-${lbl.zona_id}`}
            position={lbl.centroid as [number, number]}
            interactive={false}
            icon={L.divIcon({
              className: '',
              html: `<div style="
                display:flex; flex-direction:column; align-items:center; gap:1px;
                transform:translate(-50%,-50%); pointer-events:none;
              ">
                <div style="
                  background:rgba(0,0,0,0.75); color:white;
                  font-size:11px; font-weight:700;
                  padding:2px 6px; border-radius:4px; white-space:nowrap;
                ">${lbl.nombre || `Zona ${lbl.zona_id}`}</div>
                <div style="
                  background:${bgColor}; color:white;
                  font-size:10px; font-weight:600;
                  padding:1px 6px; border-radius:3px; white-space:nowrap;
                ">${text}${lbl.minutos != null ? ` · ${lbl.minutos} min` : ''}</div>
              </div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            })}
          />
        );
      })}
    </>
  );
});

export default ZonasActivasLayer;
