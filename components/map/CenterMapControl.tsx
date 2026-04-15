'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface CenterMapControlProps {
  /** Centro al que volver. Por defecto Montevideo. */
  center?: [number, number];
  zoom?: number;
}

/**
 * Botón Leaflet en bottomright que vuela de vuelta al centro por defecto.
 */
export default function CenterMapControl({
  center = [-34.9011, -56.1645],
  zoom = 13,
}: CenterMapControlProps) {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);

  useEffect(() => {
    if (!map) return;

    const CenterCtrl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },

      onAdd() {
        const btn = L.DomUtil.create(
          'div',
          'leaflet-bar leaflet-control center-map-control',
        );
        btn.title = 'Volver al centro';
        btn.innerHTML = `
          <a href="#" role="button" aria-label="Volver al centro"
             style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;cursor:pointer;color:#374151;text-decoration:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
              <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" stroke-opacity="0"/>
            </svg>
          </a>
        `;

        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.disableScrollPropagation(btn);

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          map.flyTo(center, zoom, { animate: true, duration: 0.8 });
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
