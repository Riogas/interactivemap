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
  address?: {
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    [k: string]: string | undefined;
  };
}

interface StreetSearchControlProps {
  open: boolean;
  onClose: () => void;
}

// Normaliza el nombre de una calle para deduplicar tramos: minúsculas, sin
// acentos y sin espacios redundantes. "Avenida Millán" y "avenida millan"
// colapsan a la misma clave.
function normalizeStreet(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// El nombre "canónico" de calle de un resultado de Nominatim: preferimos
// address.road (exacto); si no, la 1ª parte del display_name.
function streetNameOf(r: NominatimResult): string {
  return (r.address?.road || r.display_name.split(',')[0] || '').trim();
}

// Contexto secundario (ciudad/depto/país) para mostrar bajo el nombre de calle,
// omitiendo el barrio/tramo y los códigos postales que generan el ruido.
function streetContextOf(r: NominatimResult): string {
  const a = r.address;
  if (a) {
    const locality = a.city || a.town || a.village || a.state;
    const parts = [locality, a.country].filter(Boolean) as string[];
    if (parts.length) return parts.join(', ');
  }
  const segs = r.display_name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+$/.test(s));
  return segs.slice(-2).join(', ');
}

/**
 * Deduplica los resultados por nombre de calle. Nominatim devuelve una entrada
 * por cada "tramo" (way) de OSM con el mismo nombre — p.ej. 90 filas de
 * "Avenida Millán" repartidas por barrio. Acá nos quedamos con UNA por calle;
 * al seleccionarla, Overpass pinta todos los tramos de inicio a fin.
 *
 * Se conserva como representante el primer tramo que sea efectivamente una
 * calle (tiene address.road), para que la selección dispare el pintado completo.
 */
function dedupeStreets(list: NominatimResult[]): NominatimResult[] {
  const byKey = new Map<string, NominatimResult>();
  const order: string[] = [];
  for (const r of list) {
    const name = streetNameOf(r);
    if (!name) continue;
    const key = normalizeStreet(name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, r);
      order.push(key);
    } else if (!existing.address?.road && r.address?.road) {
      // Preferir un representante que sea una calle real (con address.road).
      byKey.set(key, r);
    }
  }
  return order.map((k) => byKey.get(k)!);
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
  // Selección de una calle en curso: Overpass puede demorar varios segundos.
  // Mientras dura, mostramos un overlay bloqueante para que el usuario no
  // dispare otra búsqueda ni interactúe con el mapa.
  const [selecting, setSelecting] = useState(false);

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
        // Pedimos muchos candidatos crudos (tramos) y deduplicamos por calle.
        const url = `/api/geocode?q=${encodeURIComponent(q)}&bbox=${encodeURIComponent(bbox)}&limit=40`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('geocode');
        const data = await res.json();
        if (Array.isArray(data)) {
          setResults(dedupeStreets(data).slice(0, 8));
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
    async (r: NominatimResult) => {
      if (selecting) return; // evitar selecciones concurrentes
      clearHighlight();
      // Cerrar el dropdown y reflejar la calle elegida de inmediato; el pintado
      // (Overpass) puede demorar y se cubre con el overlay de carga.
      const streetNameImmediate = streetNameOf(r);
      setQuery(streetNameImmediate || r.display_name.split(',').slice(0, 2).join(', '));
      setShowResults(false);
      setSelecting(true);

      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);

      // Dibuja una geometría GeoJSON resaltada y encuadra el mapa en ella.
      const drawGeometry = (geom: GeoJSON.GeoJsonObject) => {
        const layer = L.geoJSON(geom, {
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
            map.fitBounds(bounds.pad(0.2), { maxZoom: 17, animate: true });
            return;
          }
        } catch { /* ignore */ }
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          map.setView([lat, lon], 17, { animate: true });
        }
      };

      try {
        // Nombre de la calle: preferir address.road (exacto), si no la 1ª parte del display_name.
        const streetName = streetNameImmediate;
        const city = (r.address?.city || r.address?.town || r.address?.village || r.address?.state || '').trim();
        const isStreet = (r.category === 'highway') || (r.type && /^(residential|primary|secondary|tertiary|unclassified|living_street|trunk|road|street)$/.test(r.type)) || !!r.address?.road;

        let drawn = false;

        // 1) Intentar pintar la CALLE COMPLETA via Overpass (todos los tramos por nombre).
        //    Si conocemos la ciudad (ej. Montevideo) consultamos por área administrativa
        //    para traer la calle de inicio a fin, no sólo los tramos del viewport. Si no
        //    hay ciudad, acotamos por el bbox visible (evita homónimos de otras zonas).
        if (isStreet && streetName) {
          try {
            const params = new URLSearchParams({ name: streetName });
            if (city) {
              params.set('city', city);
            } else {
              const b = map.getBounds();
              params.set('bbox', `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
            }
            const res = await fetch(`/api/overpass?${params.toString()}`);
            if (res.ok) {
              const geom = await res.json();
              if (geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
                drawGeometry(geom as GeoJSON.GeoJsonObject);
                drawn = true;
              }
            }
          } catch { /* fallback abajo */ }
        }

        // 2) Fallback: geometría que devolvió Nominatim (segmento), o un punto.
        if (!drawn) {
          if (r.geojson) {
            drawGeometry(r.geojson as GeoJSON.GeoJsonObject);
          } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
            drawGeometry({ type: 'Point', coordinates: [lon, lat] } as GeoJSON.Point);
          }
        }
      } finally {
        setSelecting(false);
      }
    },
    [map, clearHighlight, selecting],
  );

  const handleClose = useCallback(() => {
    if (selecting) return; // no cerrar mientras se está pintando la calle
    clearHighlight();
    setQuery('');
    setResults([]);
    setError(null);
    setShowResults(false);
    onClose();
  }, [clearHighlight, onClose, selecting]);

  // Limpiar la geometría al desmontar.
  useEffect(() => () => clearHighlight(), [clearHighlight]);

  if (!open) return null;

  const container = map.getContainer();

  return createPortal(
    <>
      {selecting && (
        <div
          className="absolute inset-0 z-[1500] flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.35)', pointerEvents: 'auto', cursor: 'wait' }}
          onClick={(e) => { e.stopPropagation(); }}
          onWheelCapture={(e) => { e.stopPropagation(); }}
        >
          <div className="flex items-center gap-2 bg-white/95 rounded-xl shadow-2xl ring-1 ring-black/10 px-4 py-3">
            <svg className="w-5 h-5 text-sky-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-gray-700">Cargando calle…</span>
          </div>
        </div>
      )}
      <div
        ref={panelRef}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[1600] w-[min(92vw,420px)]"
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
              if (e.key === 'Enter' && results.length > 0 && !selecting) handleSelect(results[0]);
            }}
            disabled={selecting}
            placeholder="Buscar calle en el área visible…"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent disabled:opacity-60"
          />
          {(loading || selecting) && (
            <svg className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {hasHighlight && !loading && !selecting && (
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
            disabled={selecting}
            title="Cerrar buscador"
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {selecting && (
          <div className="border-t border-gray-100 px-3 py-2.5 flex items-center gap-2 bg-sky-50">
            <svg className="w-4 h-4 text-sky-500 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-sky-700">Cargando calle completa…</span>
          </div>
        )}

        {!selecting && showResults && (results.length > 0 || error || (query.trim().length >= 2 && !loading)) && (
          <div className="border-t border-gray-100 max-h-72 overflow-y-auto">
            {error && <div className="px-3 py-2 text-sm text-red-500">{error}</div>}
            {!error && results.length === 0 && !loading && query.trim().length >= 2 && (
              <div className="px-3 py-2 text-sm text-gray-400">Sin resultados en el área visible.</div>
            )}
            {results.map((r) => (
              <button
                key={r.place_id}
                onClick={() => handleSelect(r)}
                disabled={selecting}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-2 border-b border-gray-50 last:border-0 disabled:opacity-60"
              >
                <svg className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="min-w-0 leading-tight">
                  <span className="block text-sm text-gray-800 font-medium truncate">{streetNameOf(r)}</span>
                  {streetContextOf(r) && (
                    <span className="block text-xs text-gray-400 truncate">{streetContextOf(r)}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </>,
    container,
  );
}
