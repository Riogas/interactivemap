'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
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
    // Definir capas base disponibles
    const baseLayers: { [key: string]: L.TileLayer } = {
      '🗺️ Calles': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }),
      
      '🛰️ Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19,
      }),
      
      '🗻 Terreno': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
        maxZoom: 17,
      }),
      
      '🌊 CartoDB': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd',
      }),
      
      '🌙 Dark Mode': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: 'abcd',
      }),
      
      '🌞 Light Mode': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
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

    // Cleanup: remover control cuando el componente se desmonte
    return () => {
      map.removeControl(layersControl);
      
      // Remover todas las capas del mapa
      Object.values(baseLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    };
  }, [map, defaultLayer]);

  return null; // Este componente no renderiza nada visible, solo agrega funcionalidad
}
