'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export type DataViewMode = 'normal' | 'distribucion' | 'demoras' | 'moviles-zonas' | 'zonas-activas' | 'pedidos-zona' | 'saturacion';

interface DataViewControlProps {
  value: DataViewMode;
  onChange: (mode: DataViewMode) => void;
  /** Si false, las capas dependientes de datos en vivo (demoras/saturación/distribución/pedidos-zona/móviles-zonas) se deshabilitan. */
  isToday?: boolean;
}

const DATE_DEPENDENT_MODES: DataViewMode[] = ['distribucion', 'demoras', 'moviles-zonas', 'pedidos-zona', 'saturacion'];

/**
 * Control del mapa estilo Leaflet para seleccionar la Capas de Información:
 * - Normal (vista actual)
 * - Demoras (zonas pintadas con demora en minutos)
 * - Cant Móviles en Zonas
 * Se posiciona arriba del control de capas (bottomright).
 */
export default function DataViewControl({ value, onChange, isToday = true }: DataViewControlProps) {
  const map = useMap();
  const controlRef = useRef<L.Control | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Si el modo activo depende de la fecha y no estamos en hoy, forzar 'normal'.
  useEffect(() => {
    if (!isToday && DATE_DEPENDENT_MODES.includes(value)) {
      onChange('normal');
    }
  }, [isToday, value, onChange]);

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
          <div class="dv-toggle" title="Capas de Información">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
          </div>
          <div class="dv-panel" style="display:none;">
            <div class="dv-title">Capas de Información</div>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="normal" />
              <span class="dv-icon">🗺️</span> Sin Zona
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="distribucion" />
              <span class="dv-icon">🏘️</span> Distribución
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="demoras" />
              <span class="dv-icon">⏱️</span> Demoras
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="moviles-zonas" />
              <span class="dv-icon">🚛</span> Móviles en Zonas
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="zonas-activas" />
              <span class="dv-icon">✅</span> Zonas Activas
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="pedidos-zona" />
              <span class="dv-icon">📦</span> Pedidos/Zona
            </label>
            <label class="dv-option">
              <input type="radio" name="dv-mode" value="saturacion" />
              <span class="dv-icon">🟥</span> Saturación
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

  // Sync external value changes to the DOM radios + apply disabled state
  useEffect(() => {
    if (!containerRef.current) return;
    const radio = containerRef.current.querySelector<HTMLInputElement>(`input[value="${value}"]`);
    if (radio && !radio.checked) radio.checked = true;

    // Update toggle icon visual
    const toggle = containerRef.current.querySelector('.dv-toggle') as HTMLElement | null;
    if (toggle) {
      toggle.classList.toggle('dv-active', value !== 'normal');
    }

    // Aplicar disabled visual + funcional a las opciones dependientes de fecha
    const radios = containerRef.current.querySelectorAll<HTMLInputElement>('input[name="dv-mode"]');
    radios.forEach((r) => {
      const isDateDependent = DATE_DEPENDENT_MODES.includes(r.value as DataViewMode);
      const shouldDisable = !isToday && isDateDependent;
      r.disabled = shouldDisable;
      const label = r.closest('label.dv-option') as HTMLElement | null;
      if (label) {
        label.classList.toggle('dv-disabled', shouldDisable);
        label.title = shouldDisable ? 'Solo disponible para la fecha de hoy' : '';
      }
    });
  }, [value, isToday]);

  return null;
}
