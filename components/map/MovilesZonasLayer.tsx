'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';
import { getRefColor } from '@/lib/visual-refs-catalog';

/**
 * Color por cantidad de moviles en el subconjunto elegido (prioridad, transito, o ambos).
 * 0 = rojo, 1 = verde claro, 2 = verde fuerte, 3 = celeste, 4+ = violeta
 * (Antes: getColorByPrioridad — renombrado para reflejar que el conteo ahora puede ser
 *  cualquier subconjunto, no solo prioridad.)
 */
function getColorByCount(count: number, visualRefs?: Record<string, string> | null): string {
  switch (count) {
    case 0: return getRefColor('Ref#8', visualRefs);
    case 1: return getRefColor('Ref#9', visualRefs);
    case 2: return getRefColor('Ref#10', visualRefs);
    case 3: return getRefColor('Ref#11', visualRefs);
    default: return getRefColor('Ref#12', visualRefs);
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
  prioridad_o_transito: number; // 1=prioridad, 2=transito
  tipo_de_servicio: string; // 'NOCTURNO', 'URGENTE', 'SERVICE', etc.
  escenario_id: number;
  activa: boolean;
}

/** Filtro: 'all' = sin filtro, o un valor de servicio_nombre concreto */
export type MovilesZonasServiceFilter = string; // 'all' | 'URGENTE' | 'SERVICE' | etc.

/**
 * Subconjunto de moviles a contar por zona (combo "Moviles").
 * prio_transito = todos (default), prioridad = solo prioridad_o_transito===1,
 * transito = solo prioridad_o_transito!==1.
 */
export type MovilSubset = 'prio_transito' | 'prioridad' | 'transito';

interface MovilesZonasLayerProps {
  zonas: MovilesZonaData[];
  /** Registros crudos de moviles_zonas */
  movilesZonasData: MovilZonaRecord[];
  /** Filtro por tipo de servicio (valor de servicio_nombre o 'all') */
  serviceFilter: MovilesZonasServiceFilter;
  /** Callback para cambiar filtro */
  onServiceFilterChange: (f: MovilesZonasServiceFilter) => void;
  /** Subconjunto de moviles a contar: prio_transito / prioridad / transito */
  movilFilter?: MovilSubset;
  /** Callback para cambiar el subconjunto */
  onMovilFilterChange?: (f: MovilSubset) => void;
  /** Mostrar etiquetas de cantidad en zonas */
  showCountLabels?: boolean;
  /** Callback para cambiar showCountLabels */
  onShowCountLabelsChange?: (v: boolean) => void;
  /** Valores distintos de servicio_nombre cargados dinamicamente */
  tiposServicioDisponibles?: string[];
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Mapa de movil_id → estadoNro para excluir moviles inactivos del conteo */
  movilEstados?: Map<string, number>;
  /** IDs crudos de moviles "ocultos pero operativos" — se excluyen del conteo de zonas. */
  hiddenMovilIds?: Set<string>;
  /** Callback al hacer click en una zona */
  onZonaClick?: (zonaId: number) => void;
  /** Mapa zona_id → demora info. activa===false → zona transparente con borde
      negro punteado (request 2026-05-07). */
  demoras?: Map<number, { minutos: number; activa: boolean }>;
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

// Ajusta opacidad base: 50%=valor original, 100%=solido (1.0), <50%=mas transparente
function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

/** Opciones fijas de tipo de servicio */
const TIPOS_SERVICIO_FIJOS = ['URGENTE', 'SERVICE', 'NOCTURNO'] as const;

/** Control Leaflet para filtro por tipo de servicio + subconjunto de moviles */
function MovilesZonasFilterControl({
  serviceFilter,
  onServiceFilterChange,
  movilFilter,
  onMovilFilterChange,
  showCountLabels,
  onShowCountLabelsChange,
}: {
  serviceFilter: MovilesZonasServiceFilter;
  onServiceFilterChange: (f: MovilesZonasServiceFilter) => void;
  movilFilter: MovilSubset;
  onMovilFilterChange: (f: MovilSubset) => void;
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
            <select class="mz-filter-select mz-service-select">
              ${TIPOS_SERVICIO_FIJOS.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()}</option>`).join('')}
            </select>
            <span class="mz-filter-label" style="margin-top:4px">Moviles:</span>
            <select class="mz-filter-select mz-movil-select">
              <option value="prio_transito">Prioridad + Transito</option>
              <option value="prioridad">Prioridad</option>
              <option value="transito">Transito</option>
            </select>
            <label class="mz-toggle-label" title="Mostrar/ocultar conteo de moviles">
              <input type="checkbox" class="mz-toggle-check" ${showCountLabels ? 'checked' : ''} />
              <span class="mz-toggle-track"><span class="mz-toggle-thumb"></span></span>
              <span class="mz-filter-label" style="margin-left:4px">Cant.</span>
            </label>
          </div>
        `;

        const serviceSelect = container.querySelector('.mz-service-select') as HTMLSelectElement;
        serviceSelect.value = serviceFilter;
        serviceSelect.addEventListener('change', () => {
          onServiceFilterChange(serviceSelect.value);
        });

        const movilSelect = container.querySelector('.mz-movil-select') as HTMLSelectElement;
        movilSelect.value = movilFilter;
        movilSelect.addEventListener('change', () => {
          onMovilFilterChange(movilSelect.value as MovilSubset);
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
  }, [map, serviceFilter, onServiceFilterChange, movilFilter, onMovilFilterChange, showCountLabels, onShowCountLabelsChange]);

  return null;
}

/** Leyenda de colores de moviles-zonas como control Leaflet */
function MovilesZonasLegend({ visualRefs }: { visualRefs?: Record<string, string> | null }) {
  const map = useMap();
  useEffect(() => {
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">Tabla de Ref.</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#8', visualRefs)}"></span><span class="demora-legend-label">0 móviles</span><span class="demora-legend-ref" title="Click para editar este color">Ref#8</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#9', visualRefs)}"></span><span class="demora-legend-label">1 móvil</span><span class="demora-legend-ref" title="Click para editar este color">Ref#9</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#10', visualRefs)}"></span><span class="demora-legend-label">2 móviles</span><span class="demora-legend-ref" title="Click para editar este color">Ref#10</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#11', visualRefs)}"></span><span class="demora-legend-label">3 móviles</span><span class="demora-legend-ref" title="Click para editar este color">Ref#11</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:${getRefColor('Ref#12', visualRefs)}"></span><span class="demora-legend-label">4+ móviles</span><span class="demora-legend-ref" title="Click para editar este color">Ref#12</span></div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    const legend = new LegendControl({ position: 'bottomleft' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map, visualRefs]);
  return null;
}

const MovilesZonasLayer = memo(function MovilesZonasLayer({
  zonas,
  movilesZonasData,
  serviceFilter,
  onServiceFilterChange,
  movilFilter = 'prio_transito',
  onMovilFilterChange,
  showCountLabels = false,
  onShowCountLabelsChange,
  tiposServicioDisponibles = [],
  zonaOpacity = 50, zonaPattern = 'liso' as ZonaPattern,
  movilEstados,
  hiddenMovilIds,
  onZonaClick,
  demoras,
  visualRefs,
}: MovilesZonasLayerProps) {
  // Filtrar registros de moviles_zonas segun tipo de servicio seleccionado.
  // Excluir moviles no-activos (estado !== 0/1/2) y los ocultos-pero-operativos.
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

  // Computar conteo por zona segun el subconjunto elegido (combo "Moviles").
  // Unifica el comportamiento para todos los tipos de servicio (URGENTE/NOCTURNO/SERVICE):
  // el color SIEMPRE refleja el conteo del subconjunto, corrigiendo la rareza anterior
  // donde SERVICE coloreaba solo por prioridad.
  const zonaCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const mz of filteredData) {
      const isPrioridad = mz.prioridad_o_transito === 1;
      const incluir =
        movilFilter === 'prio_transito' ? true
        : movilFilter === 'prioridad'   ? isPrioridad
        : /* 'transito' */                !isPrioridad;
      if (!incluir) continue;
      map.set(mz.zona_id, (map.get(mz.zona_id) ?? 0) + 1);
    }
    return map;
  }, [filteredData, movilFilter]);

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

      const count = zonaCounts.get(zona.zona_id) ?? 0;
      const fillColor = getColorByCount(count, visualRefs);

      // Opacidad fija para que los colores sean bien visibles
      const fillOpacity = 0.45;

      return { zona, positions, center, fillColor, fillOpacity, count };
    }).filter(Boolean) as Array<{
      zona: MovilesZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      count: number;
    }>;
  }, [zonas, zonaCounts, visualRefs]);

  if (items.length === 0) return null;

  return (
    <>
      <MovilesZonasFilterControl
        serviceFilter={serviceFilter}
        onServiceFilterChange={onServiceFilterChange}
        movilFilter={movilFilter}
        onMovilFilterChange={onMovilFilterChange ?? (() => {})}
        showCountLabels={showCountLabels}
        onShowCountLabelsChange={onShowCountLabelsChange ?? (() => {})}
      />
      <MovilesZonasLegend visualRefs={visualRefs} />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, count }) => {
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
              className: 'mz-label',
              html: `
                <div class="mz-label-inner">
                  <span class="mz-label-zona">${zona.zona_id}</span>
                  ${showCountLabels && count > 0 ? `<span class="mz-label-counts">${count}</span>` : ''}
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
