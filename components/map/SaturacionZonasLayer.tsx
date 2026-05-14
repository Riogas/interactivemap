'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';
import { isPrivilegedForCapEntrega } from '@/lib/auth-scope';
import { getCapEntregaColor } from '@/lib/cap-entrega-color';
import type { SaturacionZonaStats } from '@/lib/cap-entrega-color';
export type { SaturacionZonaStats } from '@/lib/cap-entrega-color';

// ──────────────────────────── tipos públicos ──────────────────────────────

export interface SaturacionZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  escenario_id: number;
}

/** Subconjunto del shape de usuario que esta capa necesita para el gate de rol. */
interface ScopedUser {
  isRoot?: string;
  roles?: Array<{ RolId: string; RolNombre: string; RolTipo: string }>;
  allowedEmpresas?: number[] | null;
}

interface SaturacionZonasLayerProps {
  zonas: SaturacionZonaData[];
  /** Map de zona_id → estadísticas de saturación */
  saturacionData: Map<number, SaturacionZonaStats>;
  /** Usuario autenticado — se usa para derivar isPrivilegedForCapEntrega y mostrar
      el valor negativo real en lugar de "Sin Cap." para roles operativos. */
  user?: ScopedUser | null;
  /** Filtro por tipo de servicio ('URGENTE' | 'SERVICE' | 'NOCTURNO') */
  serviceFilter?: string;
  /** Callback cambio de filtro */
  onServiceFilterChange?: (f: string) => void;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  /** Callback al hacer click en una zona */
  onZonaClick?: (zonaId: number) => void;
  /** Mapa zona_id → demora info. activa===false → zona transparente con borde
      rojo punteado (request 2026-05-07). */
  demoras?: Map<number, { minutos: number; activa: boolean }>;
  /** Mostrar etiquetas de Cap. Entrega en los marcadores. Por defecto false */
  showLabels?: boolean;
  /** Callback para togglear las etiquetas desde la leyenda del mapa */
  onToggleLabels?: (next: boolean) => void;
  zonaPattern?: ZonaPattern;
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


function getCapEntregaOpacity(capEntrega: number): number {
  if (capEntrega === -999) return 0.70; // sin cobertura
  if (capEntrega === -1000) return 0.15; // gris sin datos
  if (capEntrega < 0)  return 0.70;
  if (capEntrega === 0) return 0.65;
  if (capEntrega === 1) return 0.55;
  if (capEntrega <= 3)  return 0.50;
  return 0.40; // >3 verde claro
}

function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

// ──────────────────────── leyenda (control Leaflet) ──────────────────────

/** Leyenda de Cap. Entrega con toggle opcional "Ver etiqueta" (espejo de DemorasLegend) */
function SaturacionLegend({ showLabels, onToggleLabels }: { showLabels: boolean; onToggleLabels?: (next: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    const showToggle = typeof onToggleLabels === 'function';
    const LegendCtrl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        const toggleHtml = showToggle
          ? `
            <div class="demora-legend-divider"></div>
            <label class="demora-legend-toggle">
              <span class="demora-legend-toggle-label">Ver etiqueta</span>
              <span class="demora-legend-switch ${showLabels ? 'is-on' : ''}" data-sat-toggle role="switch" aria-checked="${showLabels ? 'true' : 'false'}" tabindex="0">
                <span class="demora-legend-switch-thumb"></span>
              </span>
            </label>
          `
          : '';
        div.innerHTML = `
          <div class="demora-legend-title">Cap. Entrega</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#92400e"></span><span class="demora-legend-label">Sin Cap. (&lt; 0)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">0 (capacidad máx.)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#f97316"></span><span class="demora-legend-label">1</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#eab308"></span><span class="demora-legend-label">2 – 3</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#86efac"></span><span class="demora-legend-label">&gt; 3 (sobrante)</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#d1d5db"></span><span class="demora-legend-label">Sin datos</span></div>
          ${toggleHtml}
        `;
        L.DomEvent.disableClickPropagation(div);
        if (showToggle) {
          const toggleEl = div.querySelector<HTMLElement>('[data-sat-toggle]');
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
    const legend = new LegendCtrl({ position: 'bottomleft' });
    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map, showLabels, onToggleLabels]);
  return null;
}

const TIPOS_SERVICIO_SAT = ['URGENTE', 'SERVICE', 'NOCTURNO'] as const;

/** Control Leaflet para filtro por tipo de servicio en Cap. Entrega */
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
  user,
  serviceFilter = 'URGENTE',
  onServiceFilterChange,
  zonaOpacity = 50,
  onZonaClick,
  demoras,
  showLabels = false,
  onToggleLabels,
  zonaPattern = 'liso' as ZonaPattern,
}: SaturacionZonasLayerProps) {
  // Derivar privilegio UNA vez por render de la capa (no por zona).
  const isPrivileged = isPrivilegedForCapEntrega(user ?? null);

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
      const defaultStats: SaturacionZonaStats = { sinAsignar: 0, capacidadTotal: 0, capacidadDisponible: 0, movilesEnZona: 0, movilesCompartidos: 0, asignadosWeight: 0, totalWeight: 0 };
      const s = stats ?? defaultStats;
      const { color, label, capEntrega } = getCapEntregaColor(s, isPrivileged);
      const fillOpacity = getCapEntregaOpacity(capEntrega);

      // Tooltip detallado
      const tooltipLines = [
        `<b>Zona ${zona.zona_id}${zona.nombre ? ` — ${zona.nombre}` : ''}</b>`,
        `Pedidos sin asignar: <b>${s.sinAsignar}</b>`,
        `Móviles en zona: <b>${s.movilesEnZona}</b>${s.movilesCompartidos > 0 ? ` (${s.movilesCompartidos} compartidos)` : ''}`,
        `Cap. total (prorat.): <b>${s.capacidadTotal.toFixed(1)}</b>`,
        `Cap. libre (prorat.): <b>${s.capacidadDisponible.toFixed(1)}</b>`,
        capEntrega === -999 ? '⚠️ Sin cobertura (0 móviles)'
          : capEntrega === -1000 ? '— Sin datos'
          : `Cap. Entrega: <b>${capEntrega < 0 ? capEntrega : capEntrega}</b>`,
        s.movilesCompartidos > 0 ? '<i style="color:#6b7280;font-size:10px">Capacidad con prorrateo por zonas compartidas</i>' : '',
      ].filter(Boolean);

      // Mostrar label siempre excepto para casos sin datos y valores muy positivos (>3 solo número)
      const showLabel = capEntrega !== -1000;

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
  }, [zonas, saturacionData, isPrivileged]);

  if (items.length === 0) return null;

  return (
    <>
      <SaturacionLegend showLabels={showLabels} onToggleLabels={onToggleLabels} />
      {onServiceFilterChange && (
        <SaturacionFilterControl serviceFilter={serviceFilter} onServiceFilterChange={onServiceFilterChange} />
      )}
      {items.map(({ zona, positions, center, color, label, fillOpacity, tooltipHTML }) => {
        const isInactive = demoras?.get(zona.zona_id)?.activa === false;
        return (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              // Inactiva: borde rojo punteado (request 2026-05-07). Activa: borde negro.
              color: isInactive ? '#dc2626' : '#000000',
              fillColor: color,
              fillOpacity: isInactive ? 0 : adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.85, zonaOpacity),
              dashArray: isInactive ? '8, 6' : undefined,
            }}
            eventHandlers={onZonaClick ? { click: () => onZonaClick(zona.zona_id) } : {}}
          >
          </Polygon>
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
              className: 'demora-label',
              html: `
                <div class="demora-label-inner${onZonaClick ? ' demora-label-clickable' : ''}" title="${tooltipHTML.replace(/<[^>]+>/g, '')}">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${showLabels && label ? `<span class="demora-label-time" style="font-size:9px">${label}</span>` : ''}
                </div>
              `,
              iconSize: [64, 36],
              iconAnchor: [32, 18],
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

export default SaturacionZonasLayer;
