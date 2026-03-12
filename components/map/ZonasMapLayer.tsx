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
  zonaOpacity?: number; // 0-100, default 50
}

/**
 * Capa del mapa que dibuja polígonos de zonas.
 * Cada zona se pinta con su color y muestra el nombre como tooltip.
 */
// Ajusta opacidad base: 50%=valor original, 100%=sólido (1.0), <50%=más transparente
function adjustOpacity(base: number, zonaOpacity: number): number {
  const f = zonaOpacity / 50;
  if (f <= 1) return base * f;
  return Math.min(1, base + (1 - base) * (f - 1));
}

const ZonasMapLayer = memo(function ZonasMapLayer({ zonas, zonaOpacity = 50 }: ZonasMapLayerProps) {
  if (!zonas || zonas.length === 0) return null;

  return (
    <>
      {zonas.map((zona) => {
        // Parsear geojson si viene como string
        let geo = zona.geojson;
        if (typeof geo === 'string') {
          try { geo = JSON.parse(geo); } catch { return null; }
        }

        // Solo dibujar si tiene geojson como array con al menos 3 puntos
        if (!Array.isArray(geo) || geo.length < 3) return null;

        const positions: LatLngExpression[] = geo.map((p: any) => [p.lat, p.lng]);
        const fillColor = zona.color || '#3b82f6';

        return (
          <Polygon
            key={zona.zona_id}
            positions={positions}
            pathOptions={{
              color: fillColor,
              fillColor: fillColor,
              fillOpacity: adjustOpacity(0.20, zonaOpacity),
              weight: 2,
              opacity: adjustOpacity(0.7, zonaOpacity),
              dashArray: '5, 5',
            }}
          >
            <Tooltip sticky direction="top" offset={[0, -20]} className="zona-tooltip">
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
