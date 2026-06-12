/**
 * GET /api/geocode
 *
 * Proxy server-side hacia el Nominatim self-hosted de Riogas.
 * Resuelve dos problemas del cliente:
 *   - Mixed-content: la app corre en https y Nominatim es http interno.
 *   - CORS: el navegador no puede pegarle directo al host interno.
 *
 * Query params:
 *   - q     (requerido) texto a buscar (nombre de calle, dirección, etc.)
 *   - bbox  (opcional)  viewport actual del mapa como "lonMin,latMin,lonMax,latMax".
 *                       Si viene, se restringe la búsqueda a ese recuadro (bounded=1).
 *   - limit (opcional)  máximo de resultados (default 8, máx 15).
 *
 * Devuelve el JSON crudo de Nominatim (format=jsonv2 + polygon_geojson=1),
 * de modo que el cliente pueda pintar la geometría de la calle encontrada.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOMINATIM_BASE = (process.env.NOMINATIM_URL || 'http://nominatim.riogas.uy').replace(/\/$/, '');

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const bbox = (searchParams.get('bbox') || '').trim();
  const limitRaw = parseInt(searchParams.get('limit') || '8', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 15) : 8;

  if (q.length < 2) {
    return NextResponse.json([], { status: 200 });
  }

  const upstream = new URL(`${NOMINATIM_BASE}/search`);
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('format', 'jsonv2');
  upstream.searchParams.set('addressdetails', '1');
  upstream.searchParams.set('polygon_geojson', '1');
  upstream.searchParams.set('limit', String(limit));

  // Restringir al viewport visible (lo que el usuario está mirando), no a nivel país.
  if (bbox) {
    const parts = bbox.split(',').map((s) => Number(s.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [lonMin, latMin, lonMax, latMax] = parts;
      // Nominatim espera viewbox=x1,y1,x2,y2 (lon,lat de dos esquinas opuestas).
      upstream.searchParams.set('viewbox', `${lonMin},${latMin},${lonMax},${latMax}`);
      upstream.searchParams.set('bounded', '1');
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(upstream.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'TrackMovil/1.0 (Riogas interactive map)',
        'Accept-Language': 'es',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Geocoder respondió ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout del geocoder' : 'Error al consultar el geocoder';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
