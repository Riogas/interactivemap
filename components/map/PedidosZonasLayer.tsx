'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

export type PedidosZonaFilter = 'pendientes' | 'sin_asignar' | 'atrasados';

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
  /** Filtro activo (pendientes totales / sin asignar / atrasados) */
  filter: PedidosZonaFilter;
  /** Callback para cambiar el filtro desde el mapa */
  onFilterChange: (f: PedidosZonaFilter) => void;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Callback al hacer click en una zona (abre modal de móviles en zona) */
  onZonaClick?: (zonaId: number) => void;
  /** Si true, oculta la opción "Sin asignar" del select (distribuidor). */
  hideSinAsignarOption?: boolean;
  /** Mapa zona_id → demora info. activa===false → zona transparente con borde
      negro punteado (request 2026-05-07). */
  demoras?: Map<number, { minutos: number; activa: boolean }>;
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

/** Control Leaflet con combo de filtro (pendientes / sin asignar / atrasados) */
function PedidosZonaFilterControl({ filter, onFilterChange, hideSinAsignarOption = false }: { filter: PedidosZonaFilter; onFilterChange: (f: PedidosZonaFilter) => void; hideSinAsignarOption?: boolean }) {
  const map = useMap();
  useEffect(() => {
    const FilterCtrl = L.Control.extend({
      options: { position: 'bottomleft' as L.ControlPosition },
      onAdd() {
        const container = L.DomUtil.create('div', 'mz-filter-control');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        const sinAsignarOption = hideSinAsignarOption
          ? ''
          : '<option value="sin_asignar">Sin asignar</option>';
        container.innerHTML = `
          <div class="mz-filter-inner">
            <span class="mz-filter-label">Pedidos:</span>
            <select class="mz-filter-select">
              <option value="pendientes">Pendientes</option>
              ${sinAsignarOption}
              <option value="atrasados">Atrasados</option>
            </select>
          </div>
        `;
        const select = container.querySelector('.mz-filter-select') as HTMLSelectElement;
        select.value = filter;
        select.addEventListener('change', () => onFilterChange(select.value as PedidosZonaFilter));
        return container;
      },
    });
    const ctrl = new FilterCtrl();
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map, filter, onFilterChange, hideSinAsignarOption]);
  return null;
}

/** Leyenda de pedidos por zona como control Leaflet (esquina inferior izquierda) */
function PedidosZonasLegend({ filter }: { filter: PedidosZonaFilter }) {
  const map = useMap();
  const label = filter === 'sin_asignar' ? 'Sin asignar / zona' : filter === 'atrasados' ? 'Atrasados / zona' : 'Pendientes / zona';
  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">${label}</div>
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
  }, [map, label]);
  return null;
}

const PedidosZonasLayer = memo(function PedidosZonasLayer({ zonas, pedidosCount, filter, onFilterChange, zonaOpacity = 50, onZonaClick, hideSinAsignarOption = false, demoras }: PedidosZonasLayerProps) {
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
      <PedidosZonaFilterControl filter={filter} onFilterChange={onFilterChange} hideSinAsignarOption={hideSinAsignarOption} />
      <PedidosZonasLegend filter={filter} />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => {
        const isInactive = demoras?.get(zona.zona_id)?.activa === false || zona.activa === false;
        return (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              // Borde negro fijo en todas las capas de zonas (request 2026-05-06).
              color: '#000000',
              fillColor: fillColor,
              fillOpacity: isInactive ? 0 : adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.8, zonaOpacity),
              dashArray: isInactive ? '8, 6' : undefined,
            }}
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          />
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'demora-label',
              html: `
                <div class="demora-label-inner${onZonaClick ? ' demora-label-clickable' : ''}">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${count > 0 ? `<span class="demora-label-time">${count}</span>` : ''}
                </div>
              `,
              iconSize: [60, 36],
              iconAnchor: [30, 18],
            })}
            interactive={!!onZonaClick}
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          />
        </React.Fragment>
        );
      })}
    </>
  );
});

export default PedidosZonasLayer;
