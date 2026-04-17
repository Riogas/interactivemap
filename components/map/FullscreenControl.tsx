'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const ICON_EXPAND = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
       fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
    <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
    <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
  </svg>`;

const ICON_COMPRESS = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
       fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
    <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
    <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
    <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
  </svg>`;

/**
 * Botón Leaflet en bottomright que activa/desactiva pantalla completa del navegador.
 */
export default function FullscreenControl() {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!map) return;

    const updateIcon = () => {
      if (!anchorRef.current) return;
      anchorRef.current.innerHTML = document.fullscreenElement ? ICON_COMPRESS : ICON_EXPAND;
      anchorRef.current.title = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
    };

    const FullscreenCtrl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },

      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control fullscreen-map-control');
        const a = L.DomUtil.create('a', '', container) as HTMLAnchorElement;
        a.href = '#';
        a.role = 'button';
        a.setAttribute('aria-label', 'Pantalla completa');
        a.style.cssText = 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;cursor:pointer;color:#374151;text-decoration:none;';
        a.innerHTML = ICON_EXPAND;
        a.title = 'Pantalla completa';
        anchorRef.current = a;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        container.addEventListener('click', (e) => {
          e.preventDefault();
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        });

        return container;
      },
    });

    const ctrl = new FullscreenCtrl();
    ctrl.addTo(map);
    controlRef.current = ctrl;

    document.addEventListener('fullscreenchange', updateIcon);

    return () => {
      document.removeEventListener('fullscreenchange', updateIcon);
      if (controlRef.current) {
        try { map.removeControl(controlRef.current); } catch { /* */ }
        controlRef.current = null;
      }
    };
  }, [map]);

  return null;
}
