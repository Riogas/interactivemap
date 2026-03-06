'use client';

import React, { memo } from 'react';
import { Polygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

export interface ZonaMapData {
  zona_id: number;
  nombre: string | null;
  color: string | null;
  geojson: Array<{ lat: number; lng: number }> | null;
  demora_minutos: number | null;
  escenario_id: number;
}

interface ZonasMapLayerProps {
  zonas: ZonaMapData[];
}

/**
 * Capa del mapa que dibuja polígonos de zonas.
 * Cada zona se pinta con su color y muestra el nombre como tooltip.
 */
const ZonasMapLayer = memo(function ZonasMapLayer({ zonas }: ZonasMapLayerProps) {
  if (!zonas || zonas.length === 0) return null;

  return (
    <>
      {zonas.map((zona) => {
        // Solo dibujar si tiene geojson con al menos 3 puntos (triángulo mínimo)
        if (!zona.geojson || zona.geojson.length < 3) return null;

        const positions: LatLngExpression[] = zona.geojson.map((p) => [p.lat, p.lng]);
        const fillColor = zona.color || '#3b82f6';

        return (
          <Polygon
            key={zona.zona_id}
            positions={positions}
            pathOptions={{
              color: fillColor,
              fillColor: fillColor,
              fillOpacity: 0.20,
              weight: 2,
              opacity: 0.7,
              dashArray: '5, 5',
            }}
          >
            <Tooltip sticky direction="center" className="zona-tooltip">
              <div className="text-center">
                <span className="font-bold text-sm">{zona.nombre || `Zona ${zona.zona_id}`}</span>
                {zona.demora_minutos != null && zona.demora_minutos > 0 && (
                  <span className="block text-xs text-gray-500">⏱ {zona.demora_minutos} min</span>
                )}
              </div>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
});

export default ZonasMapLayer;
