'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';
import { getRefColor } from '@/lib/visual-refs-catalog';

export type PedidosZonaFilter = 'pendientes' | 'sin_asignar' | 'atrasados';

/**
 * Tipo de la capa: pedidos o services.
 * Controla la fuente de datos que se muestra en la capa de zonas.
 */
export type ZonaLayerTipo = 'URGENTE' | 'NOCTURNO' | 'OTROS' | 'SERVICE' | 'TODOS';

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
  /** Map from zona_id → cantidad de pedidos o services */
  pedidosCount: Map<number, number>;
  /** Filtro de estado activo (pendientes totales / sin asignar / atrasados) */
  filter: PedidosZonaFilter;
  /** Callback para cambiar el filtro de estado */
  onFilterChange: (f: PedidosZonaFilter) => void;
  /** Tipo de la capa: pedidos (default) o services */
  tipo?: ZonaLayerTipo;
  /** Callback para cambiar el tipo de la capa */
  onTipoChange?: (t: ZonaLayerTipo) => void;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Callback al hacer click en una zona (abre modal de moviles en zona) */
  onZonaClick?: (zonaId: number) => void;
  /** Si true, oculta la opcion "Sin asignar" del select (distribuidor). */
  hideSinAsignarOption?: boolean;
  /** Mapa zona_id → demora info. activa===false → zona transparente con borde
      negro punteado (request 2026-05-07). */
  demoras?: Map<number, { minutos: number; activa: boolean }>;
  /** Mostrar etiquetas de Pedidos en Zona en los marcadores. Por defecto false */
  showLabels?: boolean;
  /** Callback para togglear las etiquetas desde la leyenda del mapa */
  onToggleLabels?: (next: boolean) => void;
  zonaPattern?: ZonaPattern;
  /** Overrides de colores del usuario (de UserPreferences.visualRefs) */
  visualRefs?: Record<string, string> | null;
}

/**
 * Calcula el centroide de un poligono usando la formula del area con signo.
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
 * Devuelve el color de relleno segun la cantidad de pedidos.
 */
function getPedidosColor(count: number, visualRefs?: Record<string, string> | null): string {
  if (count >= 12) return getRefColor('Ref#20', visualRefs);
  if (count >= 8)  return getRefColor('Ref#19', visualRefs);
  if (count >= 4)  return getRefColor('Ref#18', visualRefs);
  if (count >= 1)  return getRefColor('Ref#17', visualRefs);
  return getRefColor('Ref#16', visualRefs);
}

function getPedidosOpacity(count: number): number {
  if (count >= 12) return 0.60;
  if (count >= 8)  return 0.55;
  if (count >= 4)  return 0.50;
  if (count >= 1)  return 0.50;
  return 0.25; // muy leve para zonas vacias
}

function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

/** Control Leaflet con combo "Tipo:" (pedidos/services) + combo "Estado:" (pendientes/sin asignar/atrasados) */
function PedidosZonaFilterControl({
  filter,
  onFilterChange,
  tipo = 'TODOS',
  onTipoChange,
  hideSinAsignarOption = false,
}: {
  filter: PedidosZonaFilter;
  onFilterChange: (f: PedidosZonaFilter) => void;
  tipo?: ZonaLayerTipo;
  onTipoChange?: (t: ZonaLayerTipo) => void;
  hideSinAsignarOption?: boolean;
}) {
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
            <span class="mz-filter-label">Tipo:</span>
            <select class="mz-filter-select mz-tipo-select">
              <option value="URGENTE">Urgente</option>
              <option value="NOCTURNO">Nocturno</option>
              <option value="OTROS">Otros Servicios</option>
              <option value="TODOS">Todos los pedidos</option>
              <option value="SERVICE">Servicios Técnicos</option>
            </select>
            <span class="mz-filter-label" style="margin-top:4px">Estado:</span>
            <select class="mz-filter-select mz-estado-select">
              <option value="pendientes">Pendientes</option>
              ${sinAsignarOption}
              <option value="atrasados">Atrasados</option>
            </select>
          </div>
        `;
        const tipoSelect = container.querySelector('.mz-tipo-select') as HTMLSelectElement;
        tipoSelect.value = tipo;
        tipoSelect.addEventListener('change', () => {
          if (onTipoChange) onTipoChange(tipoSelect.value as ZonaLayerTipo);
        });

        const estadoSelect = container.querySelector('.mz-estado-select') as HTMLSelectElement;
        estadoSelect.value = filter;
        estadoSelect.addEventListener('change', () => onFilterChange(estadoSelect.value as PedidosZonaFilter));
        return container;
      },
    });
    const ctrl = new FilterCtrl();
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map, filter, onFilterChange, tipo, onTipoChange, hideSinAsignarOption]);
  return null;
}

/** Leyenda de pedidos por zona como control Leaflet (esquina inferior izquierda) */
function PedidosZonasLegend({
  filter,
  showLabels,
  onToggleLabels,
  visualRefs,
}: {
  filter: PedidosZonaFilter;
  showLabels: boolean;
  onToggleLabels?: (next: boolean) => void;
  visualRefs?: Record<string, string> | null;
}) {
  const map = useMap();
  const label = filter === 'sin_asignar' ? 'Sin asignar / zona' : filter === 'atrasados' ? 'Atrasados / zona' : 'Pendientes / zona';
  useEffect(() => {
    const showToggle = typeof onToggleLabels === 'function';
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        const toggleHtml = showToggle
          ? `
            <div class="demora-legend-divider"></div>
            <label class="demora-legend-toggle">
              <span class="demora-legend-toggle-label">Ver etiqueta</span>
              <span class="demora-legend-switch ${showLabels ? 'is-on' : ''}" data-pedidos-toggle role="switch" aria-checked="${showLabels ? 'true' : 'false'}" tabindex="0">
                <span class="demora-legend-switch-thumb"></span>
              </span>
            </label>
          `
          : '';
        div.innerHTML = `
          <div class="demora-legend-title">${label}</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#16', visualRefs)}"></span><span class="demora-legend-label">0</span><span class="demora-legend-ref" title="Click para editar este color">Ref#16</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#17', visualRefs)}"></span><span class="demora-legend-label">1 – 3</span><span class="demora-legend-ref" title="Click para editar este color">Ref#17</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#18', visualRefs)}"></span><span class="demora-legend-label">4 – 7</span><span class="demora-legend-ref" title="Click para editar este color">Ref#18</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#19', visualRefs)}"></span><span class="demora-legend-label">8 – 11</span><span class="demora-legend-ref" title="Click para editar este color">Ref#19</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#20', visualRefs)}"></span><span class="demora-legend-label">12+</span><span class="demora-legend-ref" title="Click para editar este color">Ref#20</span></div>
          ${toggleHtml}
        `;
        L.DomEvent.disableClickPropagation(div);
        if (showToggle) {
          const toggleEl = div.querySelector<HTMLElement>('[data-pedidos-toggle]');
          if (toggleEl) {
            const handler = (e: Event) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleLabels!(!showLabels);
            };
            toggleEl.addEventListener('click', handler);
            toggleEl.addEventListener('keydown', (e) => {
              const ke = e as KeyboardEvent;
              if (ke.key === ' ' || ke.key === 'Enter') handler(e);
            });
          }
        }
        return div;
      },
    });
    const legend = new LegendControl({ position: 'bottomleft' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map, label, showLabels, onToggleLabels, visualRefs]);
  return null;
}

const PedidosZonasLayer = memo(function PedidosZonasLayer({
  zonas,
  pedidosCount,
  filter,
  onFilterChange,
  tipo = 'TODOS',
  onTipoChange,
  zonaOpacity = 50,
  onZonaClick,
  hideSinAsignarOption = false,
  demoras,
  showLabels = false,
  onToggleLabels,
  zonaPattern = 'liso',
  visualRefs,
}: PedidosZonasLayerProps) {
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
      const fillColor = getPedidosColor(count, visualRefs);
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
  }, [zonas, pedidosCount, visualRefs]);

  if (items.length === 0) return null;

  return (
    <>
      <PedidosZonaFilterControl
        filter={filter}
        onFilterChange={onFilterChange}
        tipo={tipo}
        onTipoChange={onTipoChange}
        hideSinAsignarOption={hideSinAsignarOption}
      />
      <PedidosZonasLegend filter={filter} showLabels={showLabels} onToggleLabels={onToggleLabels} visualRefs={visualRefs} />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => {
        const isInactive = demoras?.get(zona.zona_id)?.activa === false || zona.activa === false;
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
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          />
          {!isInactive && zonaPattern !== 'liso' && getPatternFillUrl(zonaPattern) && (
            <Polygon
              positions={positions}
              renderer={L.svg()}
              interactive={false}
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
              className: 'demora-label',
              html: `
                <div class="demora-label-inner${onZonaClick ? ' demora-label-clickable' : ''}">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${showLabels && count > 0 ? `<span class="demora-label-time">${count}</span>` : ''}
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
