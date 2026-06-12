'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Buscador de calles tipo "Google" sobre el mapa.
 *
 * - Se abre desde un botón en la botonera de acciones rápidas del navbar
 *   (estado controlado por la prop `open`).
 * - Sugiere mientras se escribe (debounce ~350ms) consultando /api/geocode,
 *   que a su vez pega al Nominatim self-hosted de Riogas.
 * - Restringe los resultados al viewport visible (bbox del mapa) — no busca a
 *   nivel país.
 * - Al elegir un resultado pinta la geometría de la calle sobre el mapa y
 *   encuadra la vista en ella.
 *
 * Se renderiza via portal dentro del contenedor del mapa para quedar por encima
 * de los tiles sin verse afectado por las transformaciones de los panes Leaflet.
 */

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  category?: string;
  geojson?: GeoJSON.Geometry;
  boundingbox?: [string, string, string, string];
}

interface StreetSearchControlProps {
  open: boolean;
  onClose: () => void;
}

const HIGHLIGHT_STYLE: L.PathOptions = {
  color: '#ff3b30',
  weight: 6,
  opacity: 0.9,
  fillColor: '#ff3b30',
  fillOpacity: 0.25,
};

export default function StreetSearchControl({ open, onClose }: StreetSearchControlProps) {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [hasHighlight, setHasHighlight] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<L.GeoJSON | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearHighlight = useCallback(() => {
    if (highlightRef.current) {
      highlightRef.current.remove();
      highlightRef.current = null;
    }
    setHasHighlight(false);
  }, []);

  // Evitar que las interacciones con el panel (drag/scroll/click) lleguen al mapa.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, [open]);

  // Foco automático al abrir.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounce de la búsqueda contra /api/geocode con bbox del viewport.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    const handle = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        const url = `/api/geocode?q=${encodeURIComponent(q)}&bbox=${encodeURIComponent(bbox)}&limit=8`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('geocode');
        const data = await res.json();
        if (Array.isArray(data)) {
          setResults(data);
          setShowResults(true);
        } else {
          setResults([]);
          setError('No se pudo buscar');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setResults([]);
          setError('No se pudo buscar');
        }
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [query, open, map]);

  const handleSelect = useCallback(
    (r: NominatimResult) => {
      clearHighlight();

      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);

      if (r.geojson) {
        const layer = L.geoJSON(r.geojson as GeoJSON.GeoJsonObject, {
          style: () => HIGHLIGHT_STYLE,
          pointToLayer: (_feat, latlng) =>
            L.circleMarker(latlng, { radius: 9, ...HIGHLIGHT_STYLE }),
        });
        layer.addTo(map);
        highlightRef.current = layer;
        setHasHighlight(true);
        try {
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.3), { maxZoom: 18, animate: true });
          } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
            map.setView([lat, lon], 17, { animate: true });
          }
        } catch {
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            map.setView([lat, lon], 17, { animate: true });
          }
        }
      } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const marker = L.geoJSON(
          { type: 'Point', coordinates: [lon, lat] } as GeoJSON.Point,
          {
            pointToLayer: (_feat, latlng) =>
              L.circleMarker(latlng, { radius: 9, ...HIGHLIGHT_STYLE }),
          },
        );
        marker.addTo(map);
        highlightRef.current = marker;
        setHasHighlight(true);
        map.setView([lat, lon], 17, { animate: true });
      }

      // Mostrar el nombre elegido y cerrar el dropdown.
      setQuery(r.display_name.split(',').slice(0, 2).join(', '));
      setShowResults(false);
    },
    [map, clearHighlight],
  );

  const handleClose = useCallback(() => {
    clearHighlight();
    setQuery('');
    setResults([]);
    setError(null);
    setShowResults(false);
    onClose();
  }, [clearHighlight, onClose]);

  // Limpiar la geometría al desmontar.
  useEffect(() => () => clearHighlight(), [clearHighlight]);

  if (!open) return null;

  const container = map.getContainer();

  return createPortal(
    <div
      ref={panelRef}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] w-[min(92vw,420px)]"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="bg-white rounded-xl shadow-2xl ring-1 ring-black/10 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClose();
              if (e.key === 'Enter' && results.length > 0) handleSelect(results[0]);
            }}
            placeholder="Buscar calle en el área visible…"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
          {loading && (
            <svg className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {hasHighlight && !loading && (
            <button
              onClick={() => { clearHighlight(); setShowResults(false); }}
              title="Limpiar resaltado"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13H5" />
              </svg>
            </button>
          )}
          <button
            onClick={handleClose}
            title="Cerrar buscador"
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {showResults && (results.length > 0 || error || (query.trim().length >= 2 && !loading)) && (
          <div className="border-t border-gray-100 max-h-72 overflow-y-auto">
            {error && <div className="px-3 py-2 text-sm text-red-500">{error}</div>}
            {!error && results.length === 0 && !loading && query.trim().length >= 2 && (
              <div className="px-3 py-2 text-sm text-gray-400">Sin resultados en el área visible.</div>
            )}
            {results.map((r) => (
              <button
                key={r.place_id}
                onClick={() => handleSelect(r)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-2 border-b border-gray-50 last:border-0"
              >
                <svg className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm text-gray-700 leading-tight">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    container,
  );
}
