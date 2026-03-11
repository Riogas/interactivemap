import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/puntos-interes/import-osm
 * Importa puntos de interés desde OpenStreetMap (Overpass API) para Uruguay.
 * 
 * Body: { categorias?: string[], usuario_email: string, boundingBox?: [s, w, n, e] }
 * 
 * Categorías disponibles:
 *   - riogas            → Puntos de venta y plantas Riogas
 *   - estaciones        → Todas las estaciones de servicio
 *   - gobierno          → Edificios gubernamentales, intendencias, ministerios
 *   - hospitales        → Hospitales y sanatorios
 *   - policia           → Comisarías y seccionales
 *   - bomberos          → Estaciones de bomberos
 *   - educacion         → Universidades y escuelas técnicas
 *   - supermercados     → Supermercados y grandes superficies
 *   - correo            → Oficinas de correo
 *   - bancos            → Bancos y cajeros
 * 
 * Si no se especifican categorías, importa TODAS.
 */

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Bounding box de Uruguay completo: [sur, oeste, norte, este]
const URUGUAY_BBOX: [number, number, number, number] = [-35.78, -58.44, -30.08, -53.07];

// Definición de categorías con sus queries Overpass y metadatos
interface OsmCategory {
  key: string;
  label: string;
  icono: string;
  query: (bbox: string) => string;
}

const OSM_CATEGORIES: OsmCategory[] = [
  {
    key: 'riogas',
    label: 'Riogas',
    icono: '🔵',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["name"~"[Rr]iogas"](${bbox});
        way["name"~"[Rr]iogas"](${bbox});
        node["brand"~"[Rr]iogas"](${bbox});
        way["brand"~"[Rr]iogas"](${bbox});
        node["operator"~"[Rr]iogas"](${bbox});
        way["operator"~"[Rr]iogas"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'estaciones',
    label: 'Estación de Servicio',
    icono: '⛽',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="fuel"](${bbox});
        way["amenity"="fuel"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'gobierno',
    label: 'Edificio Gubernamental',
    icono: '🏛️',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["office"="government"](${bbox});
        way["office"="government"](${bbox});
        node["amenity"="townhall"](${bbox});
        way["amenity"="townhall"](${bbox});
        node["government"](${bbox});
        way["government"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'hospitales',
    label: 'Hospital/Sanatorio',
    icono: '🏥',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="hospital"](${bbox});
        way["amenity"="hospital"](${bbox});
        node["amenity"="clinic"](${bbox});
        way["amenity"="clinic"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'policia',
    label: 'Comisaría/Policía',
    icono: '🚔',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="police"](${bbox});
        way["amenity"="police"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'bomberos',
    label: 'Bomberos',
    icono: '🚒',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="fire_station"](${bbox});
        way["amenity"="fire_station"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'educacion',
    label: 'Centro Educativo',
    icono: '🎓',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="university"](${bbox});
        way["amenity"="university"](${bbox});
        node["amenity"="college"](${bbox});
        way["amenity"="college"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'supermercados',
    label: 'Supermercado',
    icono: '🛒',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["shop"="supermarket"](${bbox});
        way["shop"="supermarket"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'correo',
    label: 'Oficina de Correo',
    icono: '📮',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="post_office"](${bbox});
        way["amenity"="post_office"](${bbox});
      );
      out center;
    `,
  },
  {
    key: 'bancos',
    label: 'Banco',
    icono: '🏦',
    query: (bbox) => `
      [out:json][timeout:30];
      (
        node["amenity"="bank"](${bbox});
        way["amenity"="bank"](${bbox});
      );
      out center;
    `,
  },
];

/**
 * Consultar Overpass API y extraer POIs
 */
async function queryOverpass(category: OsmCategory, bbox: [number, number, number, number]): Promise<Array<{
  nombre: string;
  descripcion: string;
  icono: string;
  latitud: number;
  longitud: number;
  categoria: string;
}>> {
  const bboxStr = bbox.join(',');
  const query = category.query(bboxStr);

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const elements: any[] = data.elements || [];

  // Deduplicar por nombre+coordenadas (OSM puede dar duplicados entre node y way)
  const seen = new Set<string>();
  const results: Array<{
    nombre: string;
    descripcion: string;
    icono: string;
    latitud: number;
    longitud: number;
    categoria: string;
  }> = [];

  for (const el of elements) {
    // Para ways, usar center; para nodes, lat/lon directo
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;

    const tags = el.tags || {};
    const nombre = tags.name || tags.brand || tags.operator || `${category.label} (OSM #${el.id})`;
    
    // Deduplicar por nombre redondeado a ~100m
    const dedupeKey = `${nombre}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Construir descripción con tags útiles
    const descParts: string[] = [];
    if (tags['addr:street']) {
      let addr = tags['addr:street'];
      if (tags['addr:housenumber']) addr += ` ${tags['addr:housenumber']}`;
      descParts.push(addr);
    }
    if (tags['addr:city']) descParts.push(tags['addr:city']);
    if (tags.brand && tags.brand !== nombre) descParts.push(`Marca: ${tags.brand}`);
    if (tags.operator && tags.operator !== nombre) descParts.push(`Operador: ${tags.operator}`);
    if (tags.phone) descParts.push(`Tel: ${tags.phone}`);
    if (tags.website) descParts.push(tags.website);
    if (tags.opening_hours) descParts.push(`Horario: ${tags.opening_hours}`);
    
    const descripcion = descParts.length > 0
      ? descParts.join('. ')
      : `${category.label} — importado desde OpenStreetMap`;

    results.push({
      nombre: nombre.substring(0, 100), // Límite de la columna
      descripcion,
      icono: category.icono,
      latitud: parseFloat(lat.toFixed(8)),
      longitud: parseFloat(lon.toFixed(8)),
      categoria: category.key,
    });
  }

  return results;
}

/**
 * GET /api/puntos-interes/import-osm
 * Devuelve las categorías disponibles para importar
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    categorias: OSM_CATEGORIES.map(c => ({
      key: c.key,
      label: c.label,
      icono: c.icono,
    })),
    descripcion: 'Categorías de POIs disponibles para importar desde OpenStreetMap',
    nota: 'Usar POST con { categorias: ["riogas", "gobierno", ...], usuario_email: "..." } para importar',
  });
}

/**
 * POST /api/puntos-interes/import-osm
 * Ejecuta la importación de POIs desde OpenStreetMap
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categorias, usuario_email, boundingBox } = body;

    if (!usuario_email) {
      return NextResponse.json(
        { error: 'usuario_email es requerido' },
        { status: 400 }
      );
    }

    const bbox = boundingBox || URUGUAY_BBOX;
    
    // Determinar qué categorías importar
    const categoriasToImport = categorias && categorias.length > 0
      ? OSM_CATEGORIES.filter(c => categorias.includes(c.key))
      : OSM_CATEGORIES;

    if (categoriasToImport.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron categorías válidas', disponibles: OSM_CATEGORIES.map(c => c.key) },
        { status: 400 }
      );
    }

    console.log(`🗺️ Importando POIs de OSM — categorías: ${categoriasToImport.map(c => c.key).join(', ')}`);

    const supabase = getServerSupabaseClient();
    const resultados: { categoria: string; importados: number; existentes: number; errores: number }[] = [];
    let totalImportados = 0;

    for (const cat of categoriasToImport) {
      try {
        console.log(`  📡 Consultando Overpass API: ${cat.label}...`);
        const pois = await queryOverpass(cat, bbox);
        console.log(`  ✅ ${cat.label}: ${pois.length} POIs encontrados en OSM`);

        if (pois.length === 0) {
          resultados.push({ categoria: cat.key, importados: 0, existentes: 0, errores: 0 });
          continue;
        }

        // Insertar en batch, ignorando duplicados (upsert por nombre+usuario_email)
        let importados = 0;
        let existentes = 0;
        let errores = 0;

        // Insertar de a 50 para no saturar
        const BATCH_SIZE = 50;
        for (let i = 0; i < pois.length; i += BATCH_SIZE) {
          const batch = pois.slice(i, i + BATCH_SIZE).map(poi => ({
            nombre: poi.nombre,
            descripcion: poi.descripcion,
            icono: poi.icono,
            latitud: poi.latitud,
            longitud: poi.longitud,
            tipo: 'osm',
            categoria: poi.categoria,
            visible: true,
            usuario_email,
          }));

          const { data, error } = await (supabase as any)
            .from('puntos_interes')
            .upsert(batch, {
              onConflict: 'usuario_email,nombre',
              ignoreDuplicates: true,
            })
            .select('id');

          if (error) {
            console.error(`  ❌ Error insertando batch ${cat.key}:`, error.message);
            errores += batch.length;
          } else {
            importados += data?.length || 0;
            existentes += batch.length - (data?.length || 0);
          }
        }

        resultados.push({ categoria: cat.key, importados, existentes, errores });
        totalImportados += importados;

        // Cortesía: esperar 1s entre categorías para no abusar de Overpass API
        if (categoriasToImport.indexOf(cat) < categoriasToImport.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }

      } catch (catError: any) {
        console.error(`  ❌ Error en categoría ${cat.key}:`, catError.message);
        resultados.push({ categoria: cat.key, importados: 0, existentes: 0, errores: -1 });
      }
    }

    console.log(`🗺️ Importación OSM finalizada — Total: ${totalImportados} POIs importados`);

    return NextResponse.json({
      success: true,
      total_importados: totalImportados,
      resultados,
    });

  } catch (error: any) {
    console.error('❌ Error inesperado en import-osm:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/puntos-interes/import-osm
 * Elimina todos los POIs importados de OSM (tipo='osm') para un usuario
 * Query: ?usuario_email=xxx&categoria=riogas (categoria opcional, si no se pasa borra todos los osm)
 */
export async function DELETE(request: NextRequest) {
  try {
    const usuario_email = request.nextUrl.searchParams.get('usuario_email');
    const categoria = request.nextUrl.searchParams.get('categoria');

    if (!usuario_email) {
      return NextResponse.json(
        { error: 'usuario_email es requerido' },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();
    let query = (supabase as any)
      .from('puntos_interes')
      .delete()
      .eq('usuario_email', usuario_email)
      .eq('tipo', 'osm');

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    const { data, error } = await query.select('id');

    if (error) {
      console.error('❌ Error eliminando POIs OSM:', error);
      return NextResponse.json(
        { error: 'Error al eliminar POIs', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      eliminados: data?.length || 0,
    });

  } catch (error: any) {
    console.error('❌ Error inesperado en DELETE import-osm:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor', details: error.message },
      { status: 500 }
    );
  }
}
