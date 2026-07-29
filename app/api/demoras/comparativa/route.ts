/**
 * GET /api/demoras/comparativa
 *
 * Serie del día y brecha por zona entre la demora que calcula TrackMovil y
 * la que informa el AS400. Lee `demoras_calculadas`, que guarda el snapshot
 * del AS400 en cada corrida — el import del AS400 pisa su propia tabla, así
 * que sin ese snapshot no habría con qué comparar.
 *
 * Query params:
 *   - escenario  (requerido, int)
 *   - fecha      (opcional, YYYY-MM-DD; default hoy en Montevideo)
 *   - tipo       (opcional, URGENTE|NOCTURNO|SERVICE; default URGENTE)
 *   - zona       (opcional, int) — si viene, `serie` es de esa zona
 *   - empresaIds (opcional, CSV de empresa_fletera_id) — scope de zonas del
 *     caller no-root, resuelto vía `fleteras_zonas` (mismo patrón que
 *     app/api/demoras/route.ts y app/api/zonas/route.ts).
 *
 * OJO: el AS400 solo informa URGENTE. Para NOCTURNO y SERVICE `as400` viene
 * null y la brecha no se puede calcular; la UI lo dice explícitamente.
 *
 * Auth-scope (fix round 1 — gap Critical del review: el endpoint no acotaba
 * por empresa y getServerSupabaseClient() usa service_role, bypass total de
 * RLS):
 *   - x-track-isroot : 'S' → sin restricción, ve todas las zonas (mismo
 *     header que app/api/metricas/dashboard/route.ts).
 *   - No-root: requiere `empresaIds` con al menos una empresa cuyo scope en
 *     `fleteras_zonas` resuelva a >=1 zona. Fail-closed: sin empresaIds
 *     válidos, o si el set de zonas resuelto queda vacío, se devuelve
 *     payload vacío SIN tocar `demoras_calculadas` (ni siquiera se pide el
 *     cliente de Supabase). `serie` y `zonas` quedan acotados a ese set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { todayMontevideo, montevideoRangeToUtc } from '@/lib/date-utils';
import { parseZonasJsonb } from '@/lib/auth-scope';
import { TIPOS_DEMORA } from '@/types/demoras-comparativa';
import type { TipoDemora, ComparativaData, PuntoComparativa, ZonaBrecha } from '@/types/demoras-comparativa';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Fila {
  corrida_at: string;
  zona_id: number;
  tipo_servicio: string;
  demora_informada: number;
  demora_as400: number | null;
}

interface ZonaNombreRow {
  zona_id: number;
  nombre: string | null;
}

interface DemorasAs400NombreRow {
  zona_id: number;
  zona_nombre: string | null;
}

const EMPTY_DATA: ComparativaData = { serie: [], zonas: [] };

// ─── Supabase query builder type helper (demoras_calculadas, fleteras_zonas,
// zonas y demoras no están en types/supabase.ts) ────────────────────────────
// Cada método devuelve el propio builder (igual que el cliente real de
// Supabase), así se puede encadenar cualquier combinación en cualquier orden
// sin pelear con TypeScript — mismo patrón que app/api/zonas/capacidad-snapshot/route.ts.
type SQB = {
  select: (cols: string) => SQB;
  eq: (col: string, val: unknown) => SQB;
  in: (col: string, vals: unknown[]) => SQB;
  gte: (col: string, val: unknown) => SQB;
  lt: (col: string, val: unknown) => SQB;
  order: (col: string, opts: { ascending: boolean }) => SQB;
  then: Promise<{ data: unknown[] | null; error: { message: string } | null }>['then'];
};
type SupabaseCompat = { from: (table: string) => SQB };

function prom(xs: number[]): number {
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

/**
 * Ordena de mayor a menor brecha absoluta. Los null (AS400 no informa ese
 * tipo) van SIEMPRE al final: no son "brecha grande", son ausencia de dato.
 * Fix round 1: el `?? -1` original tenía abs=1, que colaba zonas sin dato
 * ANTES de zonas con brecha real menor a 1 minuto.
 */
function compararBrechaDesc(a: ZonaBrecha, b: ZonaBrecha): number {
  if (a.brecha === null && b.brecha === null) return 0;
  if (a.brecha === null) return 1;
  if (b.brecha === null) return -1;
  return Math.abs(b.brecha) - Math.abs(a.brecha);
}

/**
 * Nombre real de zona: `zonas.nombre` primero (fuente canónica, tiene el
 * escenario en el filtro); si viene vacío ('' — no solo null), fallback a
 * `demoras.zona_nombre` (el nombre que informa el AS400 vía
 * app/api/import/demoras, ver transformAS400). Placeholder `Zona N` si
 * ninguna de las dos fuentes tiene nombre. Solo consulta lo que falta.
 */
async function resolverNombresZona(
  db: SupabaseCompat,
  escenario: number,
  zonaIds: number[],
): Promise<Map<number, string>> {
  const nombres = new Map<number, string>();
  if (zonaIds.length === 0) return nombres;

  const { data: zonasData, error: zonasError } = (await db
    .from('zonas')
    .select('zona_id, nombre')
    .eq('escenario_id', escenario)
    .in('zona_id', zonaIds)) as { data: ZonaNombreRow[] | null; error: { message: string } | null };

  if (zonasError) {
    console.error('[demoras/comparativa] error al resolver nombres de zona:', zonasError.message);
  } else {
    for (const row of zonasData ?? []) {
      if (row?.nombre != null && row.nombre.trim() !== '') nombres.set(row.zona_id, row.nombre);
    }
  }

  const faltantes = zonaIds.filter((id) => !nombres.has(id));
  if (faltantes.length === 0) return nombres;

  const { data: as400Data, error: as400Error } = (await db
    .from('demoras')
    .select('zona_id, zona_nombre')
    .eq('escenario_id', escenario)
    .in('zona_id', faltantes)) as { data: DemorasAs400NombreRow[] | null; error: { message: string } | null };

  if (as400Error) {
    console.error('[demoras/comparativa] error al resolver nombres de zona (fallback AS400):', as400Error.message);
    return nombres;
  }
  for (const row of as400Data ?? []) {
    if (row?.zona_nombre != null && row.zona_nombre.trim() !== '' && !nombres.has(row.zona_id)) {
      nombres.set(row.zona_id, row.zona_nombre);
    }
  }

  return nombres;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;

  const escenario = Number.parseInt(sp.get('escenario') ?? '', 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const tipoRaw = sp.get('tipo') ?? 'URGENTE';
  if (!TIPOS_DEMORA.includes(tipoRaw as TipoDemora)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "tipo" inválido: URGENTE | NOCTURNO | SERVICE', code: 'INVALID_TIPO' },
      { status: 400 },
    );
  }
  const tipo = tipoRaw as TipoDemora;

  const fechaRaw = sp.get('fecha');
  if (fechaRaw !== null && !DATE_RE.test(fechaRaw)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "fecha" debe ser YYYY-MM-DD', code: 'INVALID_DATE' },
      { status: 400 },
    );
  }
  const fecha = fechaRaw ?? todayMontevideo();

  const zonaRaw = sp.get('zona');
  const zonaSel = zonaRaw !== null ? Number.parseInt(zonaRaw, 10) : null;

  // ─── Auth-scope: root ve todo; no-root necesita empresaIds cuyo scope en
  // fleteras_zonas resuelva a >=1 zona (fail-closed, sin tocar la base). ────
  const isRootCaller = (request.headers.get('x-track-isroot') ?? '').trim() === 'S';

  let allowedZonaIds: Set<number> | null = null; // null = sin restricción (root)

  if (!isRootCaller) {
    const empresaIds = (sp.get('empresaIds') ?? '')
      .split(',')
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => Number.isFinite(n));

    if (empresaIds.length === 0) {
      return NextResponse.json({ success: true, data: EMPTY_DATA });
    }

    const dbScope = getServerSupabaseClient() as unknown as SupabaseCompat;
    const { data: fzData, error: fzError } = (await dbScope
      .from('fleteras_zonas')
      .select('zonas')
      .eq('escenario_id', escenario)
      .in('empresa_fletera_id', empresaIds)) as {
      data: { zonas: unknown }[] | null;
      error: { message: string } | null;
    };

    if (fzError) {
      console.error('[demoras/comparativa] error al resolver scope de zonas:', fzError.message);
      return NextResponse.json(
        { success: false, error: 'Error al resolver el scope de zonas', details: fzError.message },
        { status: 500 },
      );
    }

    allowedZonaIds = new Set<number>();
    for (const row of fzData ?? []) {
      for (const z of parseZonasJsonb(row?.zonas)) allowedZonaIds.add(z);
    }

    if (allowedZonaIds.size === 0) {
      return NextResponse.json({ success: true, data: EMPTY_DATA });
    }
  }

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;

  const { gte, ltExclusive } = montevideoRangeToUtc(fecha, fecha);

  let query = db
    .from('demoras_calculadas')
    .select('corrida_at, zona_id, tipo_servicio, demora_informada, demora_as400')
    .eq('escenario', escenario)
    .eq('tipo_servicio', tipo)
    .gte('corrida_at', gte)
    .lt('corrida_at', ltExclusive);

  if (allowedZonaIds !== null) {
    query = query.in('zona_id', [...allowedZonaIds]);
  }

  const { data, error } = (await query.order('corrida_at', { ascending: true })) as {
    data: Fila[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[demoras/comparativa] error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la comparativa', details: error.message },
      { status: 500 },
    );
  }

  const filas = data ?? [];

  const zonaIdsPresentes = [...new Set(filas.map((f) => f.zona_id))];
  const nombresPorZona = await resolverNombresZona(db, escenario, zonaIdsPresentes);

  const serie: PuntoComparativa[] = filas
    .filter((f) => zonaSel === null || f.zona_id === zonaSel)
    .map((f) => ({ corrida_at: f.corrida_at, zona_id: f.zona_id, calculada: f.demora_informada, as400: f.demora_as400 }));

  const porZona = new Map<number, { calc: number[]; as400: number[] }>();
  for (const f of filas) {
    const e = porZona.get(f.zona_id) ?? { calc: [], as400: [] };
    e.calc.push(f.demora_informada);
    if (f.demora_as400 !== null) e.as400.push(f.demora_as400);
    porZona.set(f.zona_id, e);
  }

  const zonas: ZonaBrecha[] = [...porZona.entries()]
    .map(([zona_id, e]) => {
      const pc = prom(e.calc);
      const pa = e.as400.length > 0 ? prom(e.as400) : null;
      return {
        zona_id,
        zona_nombre: nombresPorZona.get(zona_id) ?? `Zona ${zona_id}`,
        prom_calculada: pc,
        prom_as400: pa,
        brecha: pa === null ? null : Math.round((pc - pa) * 100) / 100,
      };
    })
    .sort(compararBrechaDesc);

  const payload: ComparativaData = { serie, zonas };
  return NextResponse.json({ success: true, data: payload });
}
