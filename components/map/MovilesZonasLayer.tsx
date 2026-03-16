'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

/**
 * Color por cantidad de móviles EN PRIORIDAD en la zona.
 * 0 = rojo, 1 = rosa, 2 = amarillo, 3 = verde, 4+ = verde claro
 */
function getColorByPrioridad(prioridadCount: number): string {
  switch (prioridadCount) {
    case 0: return '#ef4444'; // rojo
    case 1: return '#ec4899'; // rosa
    case 2: return '#eab308'; // amarillo
    case 3: return '#22c55e'; // verde
    default: return '#86efac'; // verde claro (4+)
  }
}

export interface MovilesZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  demora_minutos: number | null;
  escenario_id: number;
}

/** Registro crudo de la tabla moviles_zonas */
export interface MovilZonaRecord {
  movil_id: string;
  zona_id: number;
  prioridad_o_transito: number; // 1=prioridad, 2=tránsito
  tipo_de_servicio: string; // 'NOCTURNO', 'URGENTE', 'SERVICE', etc.
  escenario_id: number;
  activa: boolean;
}

/** Filtro: 'all' = sin filtro, o un valor de servicio_nombre concreto */
export type MovilesZonasServiceFilter = string; // 'all' | 'URGENTE' | 'SERVICE' | etc.

/** Estados de móvil que se excluyen del conteo en zonas */
const EXCLUDED_ESTADOS = new Set([3, 5, 15]);

interface MovilesZonasLayerProps {
  zonas: MovilesZonaData[];
  /** Registros crudos de moviles_zonas */
  movilesZonasData: MovilZonaRecord[];
  /** Filtro por tipo de servicio (valor de servicio_nombre o 'all') */
  serviceFilter: MovilesZonasServiceFilter;
  /** Callback para cambiar filtro */
  onServiceFilterChange: (f: MovilesZonasServiceFilter) => void;
  /** Valores distintos de servicio_nombre cargados dinámicamente */
  tiposServicioDisponibles?: string[];
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Mapa de movil_id → estadoNro para excluir móviles inactivos del conteo */
  movilEstados?: Map<string, number>;
  /** Callback al hacer click en una zona */
  onZonaClick?: (zonaId: number) => void;
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

// Ajusta opacidad base: 50%=valor original, 100%=sólido (1.0), <50%=más transparente
function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

/** Opciones fijas de tipo de servicio */
const TIPOS_SERVICIO_FIJOS = ['URGENTE', 'SERVICE', 'NOCTURNO'] as const;

/** Control Leaflet para filtro por tipo de servicio */
function MovilesZonasFilterControl({ serviceFilter, onServiceFilterChange }: { serviceFilter: MovilesZonasServiceFilter; onServiceFilterChange: (f: MovilesZonasServiceFilter) => void }) {
  const map = useMap();

  useEffect(() => {
    const FilterCtrl = L.Control.extend({
      options: { position: 'bottomleft' as L.ControlPosition },
      onAdd() {
        const container = L.DomUtil.create('div', 'mz-filter-control');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        container.innerHTML = `
          <div class="mz-filter-inner">
            <span class="mz-filter-label">Tipo Servicio:</span>
            <select class="mz-filter-select">
              ${TIPOS_SERVICIO_FIJOS.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()}</option>`).join('')}
            </select>
          </div>
        `;

        const select = container.querySelector('.mz-filter-select') as HTMLSelectElement;
        select.value = serviceFilter;
        select.addEventListener('change', () => {
          onServiceFilterChange(select.value);
        });

        return container;
      },
    });

    const ctrl = new FilterCtrl();
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map, serviceFilter, onServiceFilterChange]);

  return null;
}

/** Leyenda de colores de móviles-zonas (prioridad) como control Leaflet */
function MovilesZonasLegend() {
  const map = useMap();
  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">Móviles prioridad</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">0 móviles</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ec4899"></span><span class="demora-legend-label">1 móvil</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#eab308"></span><span class="demora-legend-label">2 móviles</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#22c55e"></span><span class="demora-legend-label">3 móviles</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#86efac"></span><span class="demora-legend-label">4+ móviles</span></div>
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

const MovilesZonasLayer = memo(function MovilesZonasLayer({
  zonas,
  movilesZonasData,
  serviceFilter,
  onServiceFilterChange,
  tiposServicioDisponibles = [],
  zonaOpacity = 50,
  movilEstados,
  onZonaClick,
}: MovilesZonasLayerProps) {

  // Filtrar registros de moviles_zonas según tipo de servicio seleccionado
  // y excluir móviles con estado_nro 3, 5 o 15
  const filteredData = useMemo(() => {
    let data = movilesZonasData.filter(mz => (mz.tipo_de_servicio || '').toUpperCase() === serviceFilter.toUpperCase());
    // Excluir móviles con estados inactivos (3=no activo, 5, 15)
    if (movilEstados && movilEstados.size > 0) {
      data = data.filter(mz => {
        const estado = movilEstados.get(String(mz.movil_id));
        return estado === undefined || !EXCLUDED_ESTADOS.has(estado);
      });
    }
    return data;
  }, [movilesZonasData, serviceFilter, movilEstados]);

  // Computar conteos por zona: { prioridad, transito }
  const zonaCounts = useMemo(() => {
    const map = new Map<number, { prioridad: number; transito: number }>();
    for (const mz of filteredData) {
      const existing = map.get(mz.zona_id) || { prioridad: 0, transito: 0 };
      if (mz.prioridad_o_transito === 1) {
        existing.prioridad++;
      } else {
        existing.transito++;
      }
      map.set(mz.zona_id, existing);
    }
    return map;
  }, [filteredData]);

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

      const counts = zonaCounts.get(zona.zona_id) || { prioridad: 0, transito: 0 };
      const total = counts.prioridad + counts.transito;
      const fillColor = getColorByPrioridad(counts.prioridad);

      // Opacidad fija para que los colores sean bien visibles
      const fillOpacity = 0.45;

      return { zona, positions, center, fillColor, fillOpacity, counts, total };
    }).filter(Boolean) as Array<{
      zona: MovilesZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      counts: { prioridad: number; transito: number };
      total: number;
    }>;
  }, [zonas, zonaCounts]);

  if (items.length === 0) return null;

  return (
    <>
      <MovilesZonasFilterControl serviceFilter={serviceFilter} onServiceFilterChange={onServiceFilterChange} />
      <MovilesZonasLegend />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, counts, total }) => (
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
            eventHandlers={onZonaClick ? {
              click: () => onZonaClick(zona.zona_id),
            } : undefined}
          />
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'mz-label',
              html: `
                <div class="mz-label-inner">
                  <span class="mz-label-zona">${zona.zona_id}</span>
                  <span class="mz-label-counts ${total === 0 ? 'mz-counts-zero' : ''}">${counts.prioridad}/${counts.transito}</span>
                </div>
              `,
              iconSize: [60, 40],
              iconAnchor: [30, 20],
            })}
            interactive={false}
          />
        </React.Fragment>
      ))}
    </>
  );
});

export default MovilesZonasLayer;
