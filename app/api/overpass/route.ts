/**
 * GET /api/overpass
 *
 * Devuelve la geometría COMPLETA de una calle (todos sus tramos/ways de OSM
 * unidos), no solo el segmento que matcheó Nominatim. Esto permite "pintar la
 * calle de principio a fin" en el mapa.
 *
 * En OSM una calle suele estar partida en muchos `way` con el mismo `name`.
 * Nominatim devuelve uno solo; Overpass los junta todos.
 *
 * Query params:
 *   - name (requerido) nombre exacto de la calle (ej. "Avenida Millán")
 *   - bbox (opcional)  "lonMin,latMin,lonMax,latMax" para acotar la búsqueda
 *                      (evita traer calles homónimas de otras ciudades).
 *   - city (opcional)  nombre de ciudad/localidad para acotar por área admin.
 *
 * Respuesta: { type: 'MultiLineString', coordinates: [[[lon,lat],...],...] }
 * o { error } si falla. El cliente cae al segmento de Nominatim si esto falla.
 *
 * Config: OVERPASS_URL (default público overpass-api.de). Cuando exista un
 * Overpass self-hosted interno, solo cambiar esta env.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OVERPASS_URL = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter').replace(/\/$/, '');

function escapeOverpassValue(v: string): string {
  // Escapar comillas dobles y backslashes para el string entre comillas de Overpass QL.
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || '').trim();
  const bbox = (searchParams.get('bbox') || '').trim();
  const city = (searchParams.get('city') || '').trim();

  if (name.length < 2) {
    return NextResponse.json({ error: 'name requerido' }, { status: 400 });
  }

  const safeName = escapeOverpassValue(name);

  // Construir el filtro de área: por bbox (Overpass usa "south,west,north,east")
  // o por área administrativa (nombre de ciudad). Preferimos bbox cuando viene.
  let areaClause = '';
  let bboxSetting = '';
  if (bbox) {
    const parts = bbox.split(',').map((s) => Number(s.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [lonMin, latMin, lonMax, latMax] = parts;
      // Expandir el bbox un poco para capturar tramos que salen del viewport.
      const padLat = (latMax - latMin) * 0.5 || 0.05;
      const padLon = (lonMax - lonMin) * 0.5 || 0.05;
      const s = latMin - padLat;
      const w = lonMin - padLon;
      const n = latMax + padLat;
      const e = lonMax + padLon;
      bboxSetting = `[bbox:${s},${w},${n},${e}]`;
    }
  }

  if (!bboxSetting && city) {
    const safeCity = escapeOverpassValue(city);
    areaClause = `area["name"="${safeCity}"]["boundary"="administrative"]->.searchArea;`;
  }

  const areaFilter = areaClause ? '(area.searchArea)' : '';

  const query = `
    [out:json][timeout:25]${bboxSetting};
    ${areaClause}
    way["highway"]["name"="${safeName}"]${areaFilter};
    out geom;
  `.trim();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TrackMovil/1.0 (Riogas interactive map)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: `Overpass respondió ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const elements: Array<{ type: string; geometry?: Array<{ lat: number; lon: number }> }> =
      data?.elements ?? [];

    const coordinates: number[][][] = [];
    for (const el of elements) {
      if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
        coordinates.push(el.geometry.map((p) => [p.lon, p.lat]));
      }
    }

    if (coordinates.length === 0) {
      return NextResponse.json({ error: 'sin geometría' }, { status: 404 });
    }

    return NextResponse.json({ type: 'MultiLineString', coordinates }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout de Overpass' : 'Error al consultar Overpass';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
