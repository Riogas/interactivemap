'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface CenterMapControlProps {
  /**
   * Callback que devuelve los puntos [lat, lng] de todo el contenido visible.
   * Si no se provee o devuelve null, vuelve al centro fijo de Montevideo.
   */
  getBounds?: () => [number, number][] | null;
  /** Centro de fallback cuando no hay getBounds o devuelve vacío. */
  fallbackCenter?: [number, number];
  fallbackZoom?: number;
}

/**
 * Botón Leaflet en bottomright que hace fitBounds sobre todo el contenido visible.
 */
export default function CenterMapControl({
  getBounds,
  fallbackCenter = [-34.9011, -56.1645],
  fallbackZoom = 13,
}: CenterMapControlProps) {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);
  const getBoundsRef = useRef(getBounds);
  getBoundsRef.current = getBounds;

  useEffect(() => {
    if (!map) return;

    const CenterCtrl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },

      onAdd() {
        const btn = L.DomUtil.create(
          'div',
          'leaflet-bar leaflet-control center-map-control',
        );
        btn.title = 'Centrar mapa en todo el contenido';
        btn.innerHTML = `
          <a href="#" role="button" aria-label="Centrar mapa"
             style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;cursor:pointer;color:#374151;text-decoration:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
            </svg>
          </a>
        `;

        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.disableScrollPropagation(btn);

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const points = getBoundsRef.current?.();
          if (points && points.length > 0) {
            map.fitBounds(points, { padding: [60, 60], maxZoom: 15, animate: true });
          } else {
            map.flyTo(fallbackCenter, fallbackZoom, { animate: true, duration: 0.8 });
          }
        });

        return btn;
      },
    });

    const ctrl = new CenterCtrl();
    ctrl.addTo(map);
    controlRef.current = ctrl;

    return () => {
      if (controlRef.current) {
        try { map.removeControl(controlRef.current); } catch { /* */ }
        controlRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
