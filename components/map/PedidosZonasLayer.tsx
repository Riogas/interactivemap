'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export interface PedidoZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  activa?: boolean;
  escenario_id: number;
}

interface PedidosZonasLayerProps {
  zonas: PedidoZonaData[];
  /** Map from zona_id → cantidad de pedidos */
  pedidosCount: Map<number, number>;
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

/**
 * Devuelve el color de relleno según la cantidad de pedidos.
 * 0        → verde muy claro
 * 1 – 3    → verde fuerte
 * 4 – 7    → amarillo
 * 8 – 11   → naranja
 * 12+      → rojo
 */
function getPedidosColor(count: number): string {
  if (count >= 12) return '#ef4444'; // rojo
  if (count >= 8)  return '#f97316'; // naranja
  if (count >= 4)  return '#eab308'; // amarillo
  if (count >= 1)  return '#16a34a'; // verde fuerte
  return '#bbf7d0';                  // verde muy claro (0)
}

function getPedidosOpacity(count: number): number {
  if (count >= 12) return 0.60;
  if (count >= 8)  return 0.55;
  if (count >= 4)  return 0.50;
  if (count >= 1)  return 0.50;
  return 0.25; // muy leve para zonas vacías
}

function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

/** Leyenda de pedidos por zona como control Leaflet (esquina inferior izquierda) */
function PedidosZonasLegend() {
  const map = useMap();
  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">Pedidos / zona</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#bbf7d0"></span><span class="demora-legend-label">0</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#16a34a"></span><span class="demora-legend-label">1 – 3</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#eab308"></span><span class="demora-legend-label">4 – 7</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#f97316"></span><span class="demora-legend-label">8 – 11</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">12+</span></div>
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

const PedidosZonasLayer = memo(function PedidosZonasLayer({ zonas, pedidosCount, zonaOpacity = 50 }: PedidosZonasLayerProps) {
  const items = useMemo(() => {
    if (!zonas || zonas.length === 0) return [];
    return zonas.map((zona) => {
      let geo: any = zona.geojson;

      if (typeof geo === 'string') {
        try { geo = JSON.parse(geo); } catch { return null; }
      }

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
      const count = pedidosCount.get(zona.zona_id) ?? 0;
      const fillColor = getPedidosColor(count);
      const fillOpacity = getPedidosOpacity(count);

      return { zona, positions, center, fillColor, fillOpacity, count };
    }).filter(Boolean) as Array<{
      zona: PedidoZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      count: number;
    }>;
  }, [zonas, pedidosCount]);

  if (items.length === 0) return null;

  return (
    <>
      <PedidosZonasLegend />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              color: fillColor,
              fillColor: fillColor,
              fillOpacity: adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.8, zonaOpacity),
            }}
          />
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'demora-label',
              html: `
                <div class="demora-label-inner">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  <span class="demora-label-time">${count}</span>
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

export default PedidosZonasLayer;
