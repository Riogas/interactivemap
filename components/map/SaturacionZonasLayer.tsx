'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';

// ──────────────────────────── tipos públicos ──────────────────────────────

export interface SaturacionZonaStats {
  /** Pedidos pendientes sin asignar en la zona */
  sinAsignar: number;
  /** Suma PRORRATEADA de tamanoLote (capacidad total / nZones por móvil compartido) */
  capacidadTotal: number;
  /** Suma PRORRATEADA de espacios libres (max(0, lote-asignados) / nZones) */
  capacidadDisponible: number;
  /** Cantidad total de móviles con prioridad en esta zona */
  movilesEnZona: number;
  /** Cuántos de esos móviles tienen prioridad en más de una zona */
  movilesCompartidos: number;
}

export interface SaturacionZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  escenario_id: number;
}

interface SaturacionZonasLayerProps {
  zonas: SaturacionZonaData[];
  /** Map de zona_id → estadísticas de saturación */
  saturacionData: Map<number, SaturacionZonaStats>;
  /** Filtro por tipo de servicio ('URGENTE' | 'SERVICE' | 'NOCTURNO') */
  serviceFilter?: string;
  /** Callback cambio de filtro */
  onServiceFilterChange?: (f: string) => void;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Callback al hacer click en una zona */
  onZonaClick?: (zonaId: number) => void;
}

// ──────────────────────────── helpers ────────────────────────────────────

/** Centroide de polígono */
function polygonCentroid(pts: Array<{ lat: number; lng: number }>): [number, number] {
  if (pts.length < 3) {
    return [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lng, 0) / pts.length];
  }
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[i].lng * pts[j].lat - pts[j].lng * pts[i].lat;
    area += cross;
    cx += (pts[i].lng + pts[j].lng) * cross;
    cy += (pts[i].lat + pts[j].lat) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    return [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lng, 0) / pts.length];
  }
  const f = 1 / (6 * area);
  return [cy * f, cx * f];
}

/**
 * Calcula el porcentaje de saturación y devuelve color + texto de etiqueta.
 *
 * Criterios:
 *  - Sin móviles + pedidos sin asignar > 0  → "Sin cobertura" (rojo oscuro crítico)
 *  - sat > 100%   → rojo fuerte (sobresaturado)
 *  - sat 75-100%  → rojo
 *  - sat 50-75%   → naranja
 *  - sat 25-50%   → amarillo
 *  - sat 1-25%    → verde claro (casi libre)
 *  - sat = 0 + hay móviles → verde (sobrante)
 *  - sin pedidos + sin móviles → gris (inactiva)
 */
function getSaturacionColor(stats: SaturacionZonaStats): { color: string; label: string; pct: number } {
  const { sinAsignar, capacidadDisponible, capacidadTotal, movilesEnZona } = stats;

  if (movilesEnZona === 0 && sinAsignar > 0) {
    return { color: '#7f1d1d', label: 'Sin cob.', pct: 999 }; // crítico
  }
  if (movilesEnZona === 0 && sinAsignar === 0) {
    return { color: '#d1d5db', label: '—', pct: -1 }; // zona sin datos
  }

  const pct = capacidadTotal === 0 ? (sinAsignar > 0 ? 999 : 0) : (sinAsignar / capacidadDisponible) * 100;

  if (pct === 0 || sinAsignar === 0) return { color: '#22c55e', label: '0%', pct: 0 };   // verde sobrante
  if (pct <= 25)  return { color: '#86efac', label: `${Math.round(pct)}%`, pct };         // verde claro
  if (pct <= 50)  return { color: '#eab308', label: `${Math.round(pct)}%`, pct };         // amarillo
  if (pct <= 75)  return { color: '#f97316', label: `${Math.round(pct)}%`, pct };         // naranja
  if (pct <= 100) return { color: '#ef4444', label: `${Math.round(pct)}%`, pct };         // rojo
  return { color: '#dc2626', label: `${Math.round(pct)}%`, pct };                          // rojo fuerte >100%
}

function getSaturacionOpacity(pct: number): number {
  if (pct === 999) return 0.70;
  if (pct > 100)   return 0.65;
  if (pct > 75)    return 0.60;
  if (pct > 50)    return 0.55;
  if (pct > 25)    return 0.50;
  if (pct > 0)     return 0.45;
  if (pct === 0)   return 0.35;
  return 0.15; // gris
}

function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

// ──────────────────────── leyenda (control Leaflet) ──────────────────────

function SaturacionLegend() {
  const map = useMap();
  useEffect(() => {
    const LegendCtrl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        div.innerHTML = `
          <div class="demora-legend-title">Saturación</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#7f1d1d"></span><span class="demora-legend-label">Sin cobertura</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">75 – 100%</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#f97316"></span><span class="demora-legend-label">50 – 75%</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#eab308"></span><span class="demora-legend-label">25 – 50% (sin etiqueta)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#86efac"></span><span class="demora-legend-label">1 – 25% (sin etiqueta)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#22c55e"></span><span class="demora-legend-label">Sobrante (sin etiqueta)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#d1d5db"></span><span class="demora-legend-label">Sin datos</span></div>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    const legend = new LegendCtrl({ position: 'bottomleft' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map]);
  return null;
}

const TIPOS_SERVICIO_SAT = ['URGENTE', 'SERVICE', 'NOCTURNO'] as const;

/** Control Leaflet para filtro por tipo de servicio en saturación */
function SaturacionFilterControl({ serviceFilter, onServiceFilterChange }: { serviceFilter: string; onServiceFilterChange: (f: string) => void }) {
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
              ${TIPOS_SERVICIO_SAT.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()}</option>`).join('')}
            </select>
          </div>
        `;
        const select = container.querySelector('.mz-filter-select') as HTMLSelectElement;
        select.value = serviceFilter;
        select.addEventListener('change', () => { onServiceFilterChange(select.value); });
        return container;
      },
    });
    const ctrl = new FilterCtrl();
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map, serviceFilter, onServiceFilterChange]);
  return null;
}

// ─────────────────────────────── layer ──────────────────────────────────

const SaturacionZonasLayer = memo(function SaturacionZonasLayer({
  zonas,
  saturacionData,
  serviceFilter = 'URGENTE',
  onServiceFilterChange,
  zonaOpacity = 50,
  onZonaClick,
}: SaturacionZonasLayerProps) {
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

      const stats = saturacionData.get(zona.zona_id);
      // Zona sin ningún registro: grey
      const defaultStats: SaturacionZonaStats = { sinAsignar: 0, capacidadTotal: 0, capacidadDisponible: 0, movilesEnZona: 0, movilesCompartidos: 0 };
      const s = stats ?? defaultStats;
      const { color, label, pct } = getSaturacionColor(s);
      const fillOpacity = getSaturacionOpacity(pct);

      // Tooltip detallado
      const satPct = s.capacidadDisponible > 0 ? Math.round((s.sinAsignar / s.capacidadDisponible) * 100) : 0;
      const tooltipLines = [
        `<b>Zona ${zona.zona_id}${zona.nombre ? ` — ${zona.nombre}` : ''}</b>`,
        `Pedidos sin asignar: <b>${s.sinAsignar}</b>`,
        `Móviles en zona: <b>${s.movilesEnZona}</b>${s.movilesCompartidos > 0 ? ` (${s.movilesCompartidos} compartidos)` : ''}`,
        `Cap. total (prorat.): <b>${s.capacidadTotal.toFixed(1)}</b>`,
        `Espacios libres (prorat.): <b>${s.capacidadDisponible.toFixed(1)}</b>`,
        pct === 999 ? '⚠️ Sin cobertura (0 móviles)'
          : `Saturación: <b>${satPct}%</b>`,
        s.movilesCompartidos > 0 ? '<i style="color:#6b7280;font-size:10px">Capacidad con prorrateo por zonas compartidas</i>' : '',
      ].filter(Boolean);

      // Only show label for pct >= 50 (or critical 999 = sin cobertura)
      const showLabel = pct === 999 || pct >= 50;

      return { zona, positions, center, color, label: showLabel ? label : '', fillOpacity, tooltipHTML: tooltipLines.join('<br/>') };
    }).filter(Boolean) as Array<{
      zona: SaturacionZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      color: string;
      label: string;
      fillOpacity: number;
      tooltipHTML: string;
    }>;
  }, [zonas, saturacionData]);

  if (items.length === 0) return null;

  return (
    <>
      <SaturacionLegend />
      {onServiceFilterChange && (
        <SaturacionFilterControl serviceFilter={serviceFilter} onServiceFilterChange={onServiceFilterChange} />
      )}
      {items.map(({ zona, positions, center, color, label, fillOpacity, tooltipHTML }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.85, zonaOpacity),
            }}
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          >
          </Polygon>
          <Marker
            position={center}
            icon={L.divIcon({
              className: 'demora-label',
              html: `
                <div class="demora-label-inner${onZonaClick ? ' demora-label-clickable' : ''}" title="${tooltipHTML.replace(/<[^>]+>/g, '')}">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${label ? `<span class="demora-label-time" style="font-size:9px">${label}</span>` : ''}
                </div>
              `,
              iconSize: [64, 36],
              iconAnchor: [32, 18],
            })}
            interactive={!!onZonaClick}
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          />
        </React.Fragment>
      ))}
    </>
  );
});

export default SaturacionZonasLayer;
