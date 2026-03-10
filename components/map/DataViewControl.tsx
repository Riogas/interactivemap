'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export type DataViewMode = 'normal' | 'demoras' | 'moviles-zonas';

interface DataViewControlProps {
  value: DataViewMode;
  onChange: (mode: DataViewMode) => void;
}

/**
 * Control del mapa estilo Leaflet para seleccionar la vista de datos:
 * - Normal (vista actual)
 * - Demoras (zonas pintadas con demora en minutos)
 * - Cant Móviles en Zonas
 * Se posiciona arriba del control de capas (bottomright).
 */
export default function DataViewControl({ value, onChange }: DataViewControlProps) {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map) return;

    const DataViewCtrl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },

      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control data-view-control');
        containerRef.current = container;

        // Evitar que clicks/scroll propaguen al mapa
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        container.innerHTML = `
          <div class="dv-toggle" title="Vista de datos">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
          </div>
          <div class="dv-panel" style="display:none;">
            <div class="dv-title">Vista de datos</div>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="normal" />
              <span class="dv-icon">🗺️</span> Normal
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="demoras" />
              <span class="dv-icon">⏱️</span> Demoras
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="moviles-zonas" />
              <span class="dv-icon">🚛</span> Móviles en Zonas
            </label>
          </div>
        `;

        // Toggle panel on click
        const toggle = container.querySelector('.dv-toggle') as HTMLElement;
        const panel = container.querySelector('.dv-panel') as HTMLElement;

        toggle.addEventListener('click', () => {
          const isOpen = panel.style.display !== 'none';
          panel.style.display = isOpen ? 'none' : 'block';
          toggle.classList.toggle('dv-active', !isOpen);
        });

        // Radio change handler — close panel on selection
        const radios = container.querySelectorAll<HTMLInputElement>('input[name="dv-mode"]');
        radios.forEach((radio) => {
          radio.addEventListener('change', () => {
            if (radio.checked) {
              onChange(radio.value as DataViewMode);
              // Cerrar panel después de seleccionar
              panel.style.display = 'none';
              toggle.classList.toggle('dv-active', radio.value !== 'normal');
            }
          });
        });

        // Set initial checked
        const initialRadio = container.querySelector<HTMLInputElement>(`input[value="${value}"]`);
        if (initialRadio) initialRadio.checked = true;

        return container;
      },

      onRemove() {
        containerRef.current = null;
      },
    });

    const ctrl = new DataViewCtrl();
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

  // Sync external value changes to the DOM radios
  useEffect(() => {
    if (!containerRef.current) return;
    const radio = containerRef.current.querySelector<HTMLInputElement>(`input[value="${value}"]`);
    if (radio && !radio.checked) radio.checked = true;

    // Update toggle icon visual
    const toggle = containerRef.current.querySelector('.dv-toggle') as HTMLElement | null;
    if (toggle) {
      toggle.classList.toggle('dv-active', value !== 'normal');
    }
  }, [value]);

  return null;
}
