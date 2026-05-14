'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';

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
  zonaPattern?: ZonaPattern;
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
 * Leyenda de colores de zonas activas como control Leaflet
 */
function ZonasActivasLegend() {
  const map = useMap();
  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">Zonas Activas</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#22c55e"></span><span class="demora-legend-label">Activa</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">No Activa</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#9ca3af"></span><span class="demora-legend-label">Sin dato</span></div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    const legend = new LegendControl({ position: 'bottomleft' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map]);
  return null;
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

        // Verde activa, rojo inactiva, gris sin dato. La capa "Zonas Activas"
        // mantiene siempre relleno solido — su proposito es justamente
        // visualizar el estado activa/inactiva con color (legenda Activa/No
        // Activa/Sin dato), no aplicar el tratamiento transparente+punteado
        // que sí aplica al resto de capas (request 2026-05-07).
        const fillColor = activa === true ? '#22c55e' : activa === false ? '#ef4444' : '#9ca3af';
        // Borde negro fijo en todas las capas de zonas (request 2026-05-06).
        const borderColor = '#000000';

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

      {/* Etiquetas fijas en el centroide (mismo estilo que demoras) */}
      {labels.map((lbl) => (
          <Marker
            key={`label-${lbl.zona_id}`}
            position={lbl.centroid as [number, number]}
            interactive={false}
            icon={L.divIcon({
              className: 'demora-label',
              html: `
                <div class="demora-label-inner">
                  <span class="demora-label-zona">${lbl.zona_id}</span>
                </div>
              `,
              iconSize: [60, 36],
              iconAnchor: [30, 18],
            })}
          />
      ))}

      {/* Leyenda de colores */}
      <ZonasActivasLegend />
    </>
  );
});

export default ZonasActivasLayer;
