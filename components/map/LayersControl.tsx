'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { configureTileCache } from './TileCacheConfig';
import 'leaflet/dist/leaflet.css';

interface LayersControlProps {
  defaultLayer?: 'streets' | 'satellite' | 'terrain' | 'cartodb' | 'dark' | 'light';
}

/**
 * Componente que agrega control de capas base al mapa
 * Permite cambiar entre vista de calles, satelital, terreno, etc.
 */
export default function LayersControl({ defaultLayer = 'streets' }: LayersControlProps) {
  const map = useMap();

  useEffect(() => {
    // ✅ Esperar a que el mapa esté completamente inicializado
    if (!map || !map.getContainer()) {
      return;
    }

    // 🚀 Obtener configuración optimizada de cache
    const tileOptions = configureTileCache();

    // Definir capas base disponibles con configuración de cache
    const baseLayers: { [key: string]: L.TileLayer } = {
      '🗺️ Calles': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        ...tileOptions,
      }),
      
      '🛰️ Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        ...tileOptions,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      }),
      
      '🗻 Terreno': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        ...tileOptions,
        maxNativeZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      }),
      
      '🌊 CartoDB': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        ...tileOptions,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
      }),
      
      '🌙 Dark Mode': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        ...tileOptions,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
      }),
      
      '🌞 Light Mode': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        ...tileOptions,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
      }),
    };

    // Mapeo de defaultLayer prop a nombre de capa
    const layerMap: { [key: string]: string } = {
      'streets': '🗺️ Calles',
      'satellite': '🛰️ Satélite',
      'terrain': '🗻 Terreno',
      'cartodb': '🌊 CartoDB',
      'dark': '🌙 Dark Mode',
      'light': '🌞 Light Mode',
    };

    // ✅ Usar setTimeout para asegurar que el mapa esté completamente renderizado
    const timeoutId = setTimeout(() => {
      try {
        // Agregar la capa por defecto según preferencia
        const defaultLayerName = layerMap[defaultLayer] || '🗺️ Calles';
        baseLayers[defaultLayerName].addTo(map);

        // Crear control de capas
        const layersControl = L.control.layers(baseLayers, undefined, {
          position: 'bottomright',
          collapsed: true,
        });

        // Agregar control al mapa
        layersControl.addTo(map);

        // Agregar título "Tipo de mapa" al panel del control
        const container = layersControl.getContainer();
        if (container) {
          const form = container.querySelector('.leaflet-control-layers-list');
          if (form) {
            const title = document.createElement('div');
            title.className = 'leaflet-layers-title';
            title.textContent = 'Tipo de mapa';
            form.insertBefore(title, form.firstChild);
          }
        }

        // Guardar referencia para cleanup
        (map as any)._layersControl = layersControl;
      } catch (error) {
        console.error('Error al agregar control de capas:', error);
      }
    }, 100);

    // Cleanup: remover control cuando el componente se desmonte
    return () => {
      clearTimeout(timeoutId);
      
      const layersControl = (map as any)._layersControl;
      if (layersControl) {
        try {
          map.removeControl(layersControl);
        } catch (e) {
          // El control ya fue removido
        }
      }
      
      // Remover todas las capas del mapa
      Object.values(baseLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
          try {
            map.removeLayer(layer);
          } catch (e) {
            // La capa ya fue removida
          }
        }
      });
    };
  }, [map, defaultLayer]);

  return null; // Este componente no renderiza nada visible, solo agrega funcionalidad
}
