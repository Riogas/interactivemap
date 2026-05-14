'use client';

import React, { memo, useMemo, useEffect } from 'react';
import { Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { ZonaPattern, getPatternFillUrl } from '@/lib/zona-patterns';

export interface DemoraZonaData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  demora_minutos: number | null;
  activa: boolean;
  escenario_id: number;
}

interface DemorasZonasLayerProps {
  zonas: DemoraZonaData[];
  /** Map from zona_id → demora minutos (from demoras table) */
  demoras: Map<number, { minutos: number; activa: boolean }>;
  /** Mostrar etiquetas de demora (minutos). Por defecto false */
  showLabels?: boolean;
  /** Callback para togglear las etiquetas desde la leyenda del mapa. */
  onToggleLabels?: (next: boolean) => void;
  /** Opacidad global de zonas (0-100). Por defecto 50 */
  zonaOpacity?: number;
  zonaPattern?: ZonaPattern;
}

/**
 * Calcula el centroide de un polígono usando la fórmula del área con signo.
 * Mucho más preciso que el promedio simple para formas complejas / irregulares.
 */
function polygonCentroid(pts: Array<{ lat: number; lng: number }>): [number, number] {
  if (pts.length < 3) {
    // fallback: promedio simple
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
    // Polígono degenerado, usar promedio
    const latS = pts.reduce((s, p) => s + p.lat, 0);
    const lngS = pts.reduce((s, p) => s + p.lng, 0);
    return [latS / pts.length, lngS / pts.length];
  }
  const factor = 1 / (6 * area);
  return [cy * factor, cx * factor];
}

/**
 * Devuelve el color de relleno según los minutos de demora.
 */
function getDemoraColor(minutos: number): string {
  if (minutos >= 151) return '#ef4444';   // rojo
  if (minutos >= 91)  return '#f97316';   // naranja
  if (minutos >= 61)  return '#eab308';   // amarillo fuerte
  if (minutos >= 46)  return '#fde047';   // amarillo claro
  if (minutos >= 31)  return '#16a34a';   // verde fuerte
  if (minutos >= 1)   return '#86efac';   // verde claro
  return '#9ca3af';                       // gris medio punteado (0 min)
}

function getDemoraOpacity(minutos: number): number {
  if (minutos >= 151) return 0.55;
  if (minutos >= 91)  return 0.50;
  if (minutos >= 61)  return 0.50;
  if (minutos >= 46)  return 0.45;
  if (minutos >= 31)  return 0.55;
  if (minutos >= 1)   return 0.45;
  return 0.12; // bajo pero visible, el patrón SVG da el efecto punteado
}

/** Inyecta un SVG <pattern> en el mapa para el relleno punteado de zonas con 0 min */
function useDottedPattern() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const patternId = 'demora-dotted-pattern';
    if (container.querySelector(`#${patternId}`)) return; // ya existe
    let svg = container.querySelector('svg.demora-patterns') as SVGSVGElement | null;
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.setAttribute('class', 'demora-patterns');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      container.appendChild(svg);
    }
    const defs = document.createElementNS(SVG_NS, 'defs');
    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', patternId);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '8');
    pattern.setAttribute('height', '8');
    // Fondo blanco translúcido
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '8');
    rect.setAttribute('height', '8');
    rect.setAttribute('fill', 'rgba(226,232,240,0.35)');
    pattern.appendChild(rect);
    // Punto
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '4');
    circle.setAttribute('cy', '4');
    circle.setAttribute('r', '1.2');
    circle.setAttribute('fill', 'rgba(100,116,139,0.55)');
    pattern.appendChild(circle);
    defs.appendChild(pattern);
    svg.appendChild(defs);
    return () => { svg?.remove(); };
  }, [map]);
}

/** Leyenda de colores de demoras como control Leaflet (esquina inferior izquierda) */
function DemorasLegend({ showLabels, onToggleLabels }: { showLabels: boolean; onToggleLabels?: (next: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    const showToggle = typeof onToggleLabels === 'function';
    const LegendControl = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demora-legend');
        const toggleHtml = showToggle
          ? `
            <div class="demora-legend-divider"></div>
            <label class="demora-legend-toggle">
              <span class="demora-legend-toggle-label">Mostrar etiquetas</span>
              <span class="demora-legend-switch ${showLabels ? 'is-on' : ''}" data-demora-toggle role="switch" aria-checked="${showLabels ? 'true' : 'false'}" tabindex="0">
                <span class="demora-legend-switch-thumb"></span>
              </span>
            </label>
          `
          : '';
        div.innerHTML = `
          <div class="demora-legend-title">Demoras (min)</div>
          <div class="demora-legend-row"><span class="demora-legend-swatch dotted"></span><span class="demora-legend-label">0</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#86efac"></span><span class="demora-legend-label">1 – 30</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#16a34a"></span><span class="demora-legend-label">31 – 45</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#fde047"></span><span class="demora-legend-label">46 – 60</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#eab308"></span><span class="demora-legend-label">61 – 90</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#f97316"></span><span class="demora-legend-label">91 – 150</span></div>
          <div class="demora-legend-row"><span class="demora-legend-swatch" style="background:#ef4444"></span><span class="demora-legend-label">151+</span></div>
          ${toggleHtml}
        `;
        L.DomEvent.disableClickPropagation(div);
        if (showToggle) {
          const toggleEl = div.querySelector<HTMLElement>('[data-demora-toggle]');
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
  }, [map, showLabels, onToggleLabels]);
  return null;
}

/**
 * Capa de zonas con información de demoras.
 * Muestra todas las zonas pintadas según minutos, con etiqueta de nro de zona y demora.
 */
// Ajusta opacidad base: 50%=valor original, 100%=sólido (1.0), <50%=más transparente
function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

const DemorasZonasLayer = memo(function DemorasZonasLayer({ zonas, demoras, showLabels = false, onToggleLabels, zonaOpacity = 50, zonaPattern = 'liso' }: DemorasZonasLayerProps) {
  // Inyectar patrón SVG para zonas con 0 minutos
  useDottedPattern();
  const items = useMemo(() => {
    if (!zonas || zonas.length === 0) return [];
    const result = zonas.map((zona) => {
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

      // Filtrar puntos válidos (lat/lng pueden venir como string desde la DB)
      const validGeo = geo
        .map((p: any) => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
        .filter((p: any) => isFinite(p.lat) && isFinite(p.lng));
      if (validGeo.length < 3) return null;

      const positions: LatLngExpression[] = validGeo.map((p: any) => [p.lat, p.lng]);

      // Calcular centroide del polígono (fórmula del área con signo)
      const center: [number, number] = polygonCentroid(validGeo);

      // Demora: primero buscar en tabla demoras, sino usar demora_minutos de la zona
      const demoraInfo = demoras.get(zona.zona_id);
      const minutos = demoraInfo?.minutos ?? zona.demora_minutos ?? 0;
      const demoraActiva = demoraInfo?.activa ?? true;

      const fillColor = getDemoraColor(minutos);
      const fillOpacity = getDemoraOpacity(minutos);
      const isDotted = minutos === 0;

      return { zona, positions, center, fillColor, fillOpacity, minutos, demoraActiva, isDotted };
    }).filter(Boolean) as Array<{
      zona: DemoraZonaData;
      positions: LatLngExpression[];
      center: [number, number];
      fillColor: string;
      fillOpacity: number;
      minutos: number;
      demoraActiva: boolean;
      isDotted: boolean;
    }>;
    return result;
  }, [zonas, demoras]);

  if (items.length === 0) return null;

  return (
    <>
      <DemorasLegend showLabels={showLabels} onToggleLabels={onToggleLabels} />
      {items.map(({ zona, positions, center, fillColor, fillOpacity, minutos, demoraActiva, isDotted }) => (
        <React.Fragment key={zona.zona_id}>
          <Polygon
            positions={positions}
            pathOptions={{
              // Inactiva: borde rojo punteado (request 2026-05-07). Activa: borde negro.
              // Las zonas isDotted conservan el dashArray para diferenciar.
              // Inactivas (demoraActiva=false): transparente + borde negro punteado (request 2026-05-07).
              color: !demoraActiva ? '#dc2626' : '#000000',
              fillColor: fillColor,
              fillOpacity: !demoraActiva ? 0 : adjustOpacity(fillOpacity, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(isDotted ? 0.7 : 0.8, zonaOpacity),
              dashArray: !demoraActiva ? '8, 6' : (isDotted ? '4 4' : undefined),
              className: !demoraActiva ? undefined : (isDotted ? 'demora-zona-dotted' : undefined),
            }}
          />
          {demoraActiva && zonaPattern !== 'liso' && getPatternFillUrl(zonaPattern) && (
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
                <div class="demora-label-inner">
                  <span class="demora-label-zona">${zona.zona_id}</span>
                  ${showLabels ? `<span class="demora-label-time ${!demoraActiva ? 'demora-inactive' : ''}">${minutos} min</span>` : ''}
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

export default DemorasZonasLayer;
