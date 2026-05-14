'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';

/**
 * Color por cantidad de móviles EN PRIORIDAD en la zona.
 * 0 = rojo, 1 = verde claro, 2 = verde fuerte, 3 = celeste, 4+ = violeta
 */
function getColorByPrioridad(prioridadCount: number): string {
  switch (prioridadCount) {
    case 0: return '#ef4444'; // rojo
    case 1: return '#86efac'; // verde claro
    case 2: return '#22c55e'; // verde fuerte
    case 3: return '#06b6d4'; // celeste
    default: return '#8b5cf6'; // violeta (4+)
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

interface MovilesZonasLayerProps {
  zonas: MovilesZonaData[];
  /** Registros crudos de moviles_zonas */
  movilesZonasData: MovilZonaRecord[];
  /** Filtro por tipo de servicio (valor de servicio_nombre o 'all') */
  serviceFilter: MovilesZonasServiceFilter;
  /** Callback para cambiar filtro */
  onServiceFilterChange: (f: MovilesZonasServiceFilter) => void;
  /** Mostrar etiquetas de cantidad pr/tr en zonas con diferencia */
  showCountLabels?: boolean;
  /** Callback para cambiar showCountLabels */
  onShowCountLabelsChange?: (v: boolean) => void;
  /** Valores distintos de servicio_nombre cargados dinámicamente */
  tiposServicioDisponibles?: string[];
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Mapa de movil_id → estadoNro para excluir móviles inactivos del conteo */
  movilEstados?: Map<string, number>;
  /** IDs crudos de móviles "ocultos pero operativos" — se excluyen del conteo de zonas. */
  hiddenMovilIds?: Set<string>;
  /** Callback al hacer click en una zona */
  onZonaClick?: (zonaId: number) => void;
  /** Mapa zona_id → demora info. activa===false → zona transparente con borde
      negro punteado (request 2026-05-07). */
  demoras?: Map<number, { minutos: number; activa: boolean }>;
  zonaPattern?: ZonaPattern;
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
function MovilesZonasFilterControl({
  serviceFilter,
  onServiceFilterChange,
  showCountLabels,
  onShowCountLabelsChange,
}: {
  serviceFilter: MovilesZonasServiceFilter;
  onServiceFilterChange: (f: MovilesZonasServiceFilter) => void;
  showCountLabels: boolean;
  onShowCountLabelsChange: (v: boolean) => void;
}) {
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
            <label class="mz-toggle-label" title="Mostrar/ocultar conteo de móviles">
              <input type="checkbox" class="mz-toggle-check" ${showCountLabels ? 'checked' : ''} />
              <span class="mz-toggle-track"><span class="mz-toggle-thumb"></span></span>
              <span class="mz-filter-label" style="margin-left:4px">Cant.</span>
            </label>
          </div>
        `;

        const select = container.querySelector('.mz-filter-select') as HTMLSelectElement;
        select.value = serviceFilter;
        select.addEventListener('change', () => {
          onServiceFilterChange(select.value);
        });

        const checkbox = container.querySelector('.mz-toggle-check') as HTMLInputElement;
        checkbox.addEventListener('change', () => {
          onShowCountLabelsChange(checkbox.checked);
        });

        return container;
      },
    });

    const ctrl = new FilterCtrl();
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map, serviceFilter, onServiceFilterChange, showCountLabels, onShowCountLabelsChange]);

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
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#86efac"></span><span class="demora-legend-label">1 móvil</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#22c55e"></span><span class="demora-legend-label">2 móviles</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#06b6d4"></span><span class="demora-legend-label">3 móviles</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#8b5cf6"></span><span class="demora-legend-label">4+ móviles</span></div>
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
  showCountLabels = false,
  onShowCountLabelsChange,
  tiposServicioDisponibles = [],
  zonaOpacity = 50, zonaPattern = 'liso' as ZonaPattern,
  movilEstados,
  hiddenMovilIds,
  onZonaClick,
  demoras,
}: MovilesZonasLayerProps) {
  // Filtrar registros de moviles_zonas según tipo de servicio seleccionado.
  // Excluir móviles no-activos (estado ≠ 0/1/2) y los ocultos-pero-operativos.
  const filteredData = useMemo(() => {
    let data = movilesZonasData.filter(mz => (mz.tipo_de_servicio || '').toUpperCase() === serviceFilter.toUpperCase());
    if ((movilEstados && movilEstados.size > 0) || (hiddenMovilIds && hiddenMovilIds.size > 0)) {
      data = data.filter(mz => {
        const key = String(mz.movil_id);
        if (hiddenMovilIds && hiddenMovilIds.has(key)) return false;
        if (movilEstados) {
          const estado = movilEstados.get(key);
          if (estado !== undefined && !isMovilActiveForUI(estado)) return false;
        }
        return true;
      });
    }
    return data;
  }, [movilesZonasData, serviceFilter, movilEstados, hiddenMovilIds]);

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
      <MovilesZonasFilterControl
        serviceFilter={serviceFilter}
        onServiceFilterChange={onServiceFilterChange}
        showCountLabels={showCountLabels}
        onShowCountLabelsChange={onShowCountLabelsChange ?? (() => {})}
      />
      <MovilesZonasLegend />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, counts, total }) => {
        const isInactive = demoras?.get(zona.zona_id)?.activa === false;
        return (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              // Inactiva: borde rojo punteado (request 2026-05-07). Activa: borde negro.
              color: isInactive ? '#dc2626' : '#000000',
              fillColor: fillColor,
              fillOpacity: isInactive ? 0 : adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.8, zonaOpacity),
              dashArray: isInactive ? '8, 6' : undefined,
            }}
            eventHandlers={onZonaClick ? {
              click: () => onZonaClick(zona.zona_id),
            } : undefined}
          />
          {!isInactive && zonaPattern !== 'liso' && getPatternFillUrl(zonaPattern) && (
            <Polygon
              positions={positions}
              renderer={L.svg()}
              pathOptions={{
                fillColor: getPatternFillUrl(zonaPattern)!,
                fillOpacity: 0.85,
                stroke: false,
                color: 'transparent',
                weight: 0,
              }}
            />
          )}
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'mz-label',
              html: `
                <div class="mz-label-inner">
                  <span class="mz-label-zona">${zona.zona_id}</span>
                  ${showCountLabels && counts.prioridad !== counts.transito ? `<span class="mz-label-counts ${total === 0 ? 'mz-counts-zero' : ''}">${counts.prioridad}/${counts.transito}</span>` : ''}
                </div>
              `,
              iconSize: [60, 40],
              iconAnchor: [30, 20],
            })}
            interactive={false}
          />
        </React.Fragment>
        );
      })}
    </>
  );
});

export default MovilesZonasLayer;
