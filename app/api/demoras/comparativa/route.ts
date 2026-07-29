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
 * Paginación (B1 — bloqueante de la revisión final): un día entero de
 * `demoras_calculadas` son ~10.500 filas SOLO de URGENTE (106 zonas × 99
 * corridas). Supabase/PostgREST corta en 1000 filas por request SIN avisar,
 * y como el `.order('corrida_at')` va antes del corte sobrevivían las
 * corridas MÁS VIEJAS: el gráfico terminaba a las 08:30 y la tabla de brecha
 * promediaba solo la primera hora y media del día. Se pagina con `.range()`
 * en bloques de PAGE_SIZE, mismo patrón que
 * app/api/metricas/cumplimiento/run/route.ts (fetchCumplidos/fetchExistentes).
 *
 * Filas sin capacidad (B2): `sin_capacidad = true` significa que la zona no
 * tenía NINGÚN móvil activo y la fila informó el techo (`max_minutos`) por
 * definición, no por cálculo. A las 07:00 el 72% de la flota está inactiva,
 * así que el arranque del día produce una masa de filas con 120 fijo que, si
 * entran al promedio, arruinan la calibración contra el AS400. Se traen las
 * banderas que explican un 120 (`sin_capacidad`, `clampeado`, `ritmo_origen`)
 * y se EXCLUYEN esas filas del promedio de brecha, informando cuántas se
 * excluyeron. La serie las conserva (la card las marca en el gráfico).
 *
 * `escenario_configurado` (B3): el motor solo calcula el escenario 1000
 * (`v_esc integer := 1000` hardcodeado en demoras_calcular_run, y el seed de
 * `demoras_config` es solo de ese escenario), pero la pantalla tiene selector
 * de escenario. Este flag deja que la card diga "el motor no está configurado
 * para este escenario" en vez de "todavía no hay corridas para hoy", que es
 * una explicación falsa de una condición permanente.
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
 *
 * Gates de autorización (Task 8 — la card de esta comparativa vive en la
 * misma pantalla que /api/metricas/dashboard, así que comparte su mismo
 * umbral de acceso, en el mismo orden):
 *   - requireAllowlistedEmail(auth.user?.email, METRICAS_DASHBOARD_ALLOWED_EMAILS):
 *     chequea el email de la sesión AUTENTICADA (no spoofeable) contra la
 *     misma allowlist que metricas/dashboard.
 *   - requireFuncionalidad('Estadisticas Cumplimiento'): mismo gate por
 *     header x-track-funcs que metricas/dashboard (root bypassea siempre).
 *   Los headers x-track-isroot / x-track-empresas-ids que resuelven el scope
 *   de zonas más abajo son forjables por el cliente — estos dos gates previos
 *   son la defensa real para datos sensibles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import { todayMontevideo, montevideoRangeToUtc } from '@/lib/date-utils';
import { parseZonasJsonb } from '@/lib/auth-scope';
import { TIPOS_DEMORA } from '@/types/demoras-comparativa';
import type {
  TipoDemora,
  ComparativaData,
  PuntoComparativa,
  ZonaBrecha,
  ClampeadoDemora,
  RitmoOrigen,
} from '@/types/demoras-comparativa';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Límite implícito de filas por request de PostgREST/Supabase. */
const PAGE_SIZE = 1000;

/**
 * Tope de páginas. Un día son ~10.500 filas por tipo (106 zonas × 99
 * corridas), así que 30 páginas (30.000 filas) es ~3× el peor caso previsto.
 * Existe para que un `.range()` que no filtre (driver cambiado, mock mal
 * armado) no deje el handler en un bucle infinito comiéndose la memoria del
 * proceso: preferimos un log ruidoso y un resultado incompleto a un cuelgue.
 */
const MAX_PAGES = 30;

/** Columnas leídas de `demoras_calculadas` (una sola fuente de verdad). */
const FILA_COLS =
  'corrida_at, zona_id, tipo_servicio, demora_informada, demora_as400, sin_capacidad, clampeado, ritmo_origen';

interface Fila {
  corrida_at: string;
  zona_id: number;
  tipo_servicio: string;
  demora_informada: number;
  demora_as400: number | null;
  sin_capacidad: boolean | null;
  clampeado: ClampeadoDemora | null;
  ritmo_origen: RitmoOrigen | null;
}

interface ZonaNombreRow {
  zona_id: number;
  nombre: string | null;
}

interface DemorasAs400NombreRow {
  zona_id: number;
  zona_nombre: string | null;
}

/**
 * Payload de los caminos fail-closed (caller no-root sin scope resuelto).
 *
 * `escenario_configurado: true` acá NO es una afirmación sobre
 * `demoras_config`: en estos caminos el flag no se evalúa (dos de los tres ni
 * siquiera tocan la base, que es parte del contrato fail-closed). Se elige
 * `true` para no inventar un "el motor no está configurado" que nadie
 * verificó; el motivo real —el caller no tiene zonas— lo dice la card con su
 * propio mensaje, que tiene prioridad sobre el de configuración.
 */
const EMPTY_DATA: ComparativaData = {
  serie: [],
  zonas: [],
  excluidas_sin_capacidad: 0,
  total_filas: 0,
  escenario_configurado: true,
};

// ─── Supabase query builder type helper (demoras_calculadas, demoras_config,
// fleteras_zonas, zonas y demoras no están en types/supabase.ts) ────────────
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
  range: (from: number, to: number) => SQB;
  then: Promise<{ data: unknown[] | null; error: { message: string } | null }>['then'];
};
type SupabaseCompat = { from: (table: string) => SQB };

function prom(xs: number[]): number {
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

/**
 * B3 — ¿el motor está configurado para este escenario?
 *
 * `demoras_calcular_run` tiene el escenario 1000 hardcodeado y el seed de
 * `demoras_config` solo siembra ese escenario, pero la pantalla tiene
 * selector de escenario. Con cualquier otro la card queda vacía PARA SIEMPRE:
 * sin este flag, la UI explicaba esa condición permanente con "todavía no hay
 * corridas del motor para hoy" — una explicación falsa que invita a esperar.
 *
 * Un error leyendo `demoras_config` (el caso más probable: la migración
 * todavía no se aplicó y la tabla no existe) se trata como "no configurado",
 * que a los efectos del usuario es exactamente lo mismo.
 */
async function escenarioEstaConfigurado(db: SupabaseCompat, escenario: number): Promise<boolean> {
  const { data, error } = (await db
    .from('demoras_config')
    .select('tipo_servicio')
    .eq('escenario_id', escenario)) as {
    data: { tipo_servicio: string }[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[demoras/comparativa] error al leer demoras_config:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Lee TODAS las filas del día para (escenario, tipo), paginando en bloques de
 * PAGE_SIZE. Sin esto Supabase devuelve las primeras 1000 y calla (B1).
 * Mismo patrón que app/api/metricas/cumplimiento/run/route.ts:42.
 */
async function fetchFilas(
  db: SupabaseCompat,
  escenario: number,
  tipo: TipoDemora,
  gte: string,
  ltExclusive: string,
  allowedZonaIds: Set<number> | null,
): Promise<{ filas: Fila[]; error: string | null }> {
  const filas: Fila[] = [];
  let page = 0;

  for (; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = db
      .from('demoras_calculadas')
      .select(FILA_COLS)
      .eq('escenario', escenario)
      .eq('tipo_servicio', tipo)
      .gte('corrida_at', gte)
      .lt('corrida_at', ltExclusive);

    if (allowedZonaIds !== null) {
      query = query.in('zona_id', [...allowedZonaIds]);
    }

    const { data, error } = (await query.order('corrida_at', { ascending: true }).range(from, to)) as {
      data: Fila[] | null;
      error: { message: string } | null;
    };

    if (error) return { filas, error: error.message };

    const batch = data ?? [];
    filas.push(...batch);
    if (batch.length < PAGE_SIZE) return { filas, error: null };
  }

  // Techo alcanzado: el día tiene más filas de las que este endpoint está
  // dispuesto a traer. Se devuelve lo leído, pero se loguea fuerte — un
  // truncado silencioso es exactamente el bug que este fix vino a arreglar.
  console.error(
    `[demoras/comparativa] tope de paginacion alcanzado (${MAX_PAGES} paginas x ${PAGE_SIZE}): ` +
      `escenario=${escenario} tipo=${tipo} rango=[${gte}, ${ltExclusive}). El resultado esta truncado.`,
  );

  return { filas, error: null };
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

  // Allowlist server-side por EMAIL (defensa contra headers spoofeables) —
  // mismo gate y misma env que app/api/metricas/dashboard/route.ts.
  const allowGate = requireAllowlistedEmail(auth.user?.email, process.env.METRICAS_DASHBOARD_ALLOWED_EMAILS);
  if (allowGate !== true) return allowGate;

  // Gate de funcionalidad — mismo patrón que metricas/dashboard (root
  // bypassea siempre).
  const funcGate = requireFuncionalidad(request, 'Estadisticas Cumplimiento');
  if (funcGate !== true) return funcGate;

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

  const { filas, error } = await fetchFilas(db, escenario, tipo, gte, ltExclusive, allowedZonaIds);

  if (error) {
    console.error('[demoras/comparativa] error:', error);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la comparativa', details: error },
      { status: 500 },
    );
  }

  const escenarioConfigurado = await escenarioEstaConfigurado(db, escenario);

  const zonaIdsPresentes = [...new Set(filas.map((f) => f.zona_id))];
  const nombresPorZona = await resolverNombresZona(db, escenario, zonaIdsPresentes);

  const serie: PuntoComparativa[] = filas
    .filter((f) => zonaSel === null || f.zona_id === zonaSel)
    .map((f) => ({
      corrida_at: f.corrida_at,
      zona_id: f.zona_id,
      calculada: f.demora_informada,
      as400: f.demora_as400,
      sin_capacidad: f.sin_capacidad === true,
      clampeado: f.clampeado ?? null,
      ritmo_origen: f.ritmo_origen ?? null,
    }));

  // Brecha: las filas con sin_capacidad=true NO promedian (B2). Esa fila
  // informa el techo por definición (no había un solo móvil activo), no por
  // el modelo; mezclarlas con las filas calculadas de verdad es exactamente
  // lo que descalibra la comparación contra el AS400 — y a las 07:00, con el
  // 72% de la flota inactiva, son la mayoría del tramo.
  const porZona = new Map<number, { calc: number[]; as400: number[]; excluidas: number }>();
  for (const f of filas) {
    const e = porZona.get(f.zona_id) ?? { calc: [], as400: [], excluidas: 0 };
    if (f.sin_capacidad === true) {
      e.excluidas += 1;
    } else {
      e.calc.push(f.demora_informada);
      // El AS400 se promedia sobre las MISMAS corridas que la calculada: una
      // brecha entre poblaciones distintas no significa nada.
      if (f.demora_as400 !== null) e.as400.push(f.demora_as400);
    }
    porZona.set(f.zona_id, e);
  }

  const zonas: ZonaBrecha[] = [...porZona.entries()]
    .map(([zona_id, e]) => {
      const pc = e.calc.length > 0 ? prom(e.calc) : null;
      const pa = e.as400.length > 0 ? prom(e.as400) : null;
      return {
        zona_id,
        zona_nombre: nombresPorZona.get(zona_id) ?? `Zona ${zona_id}`,
        prom_calculada: pc,
        prom_as400: pa,
        brecha: pc === null || pa === null ? null : Math.round((pc - pa) * 100) / 100,
        muestras: e.calc.length,
        excluidas_sin_capacidad: e.excluidas,
      };
    })
    .sort(compararBrechaDesc);

  const payload: ComparativaData = {
    serie,
    zonas,
    excluidas_sin_capacidad: zonas.reduce((acc, z) => acc + z.excluidas_sin_capacidad, 0),
    total_filas: filas.length,
    escenario_configurado: escenarioConfigurado,
  };
  return NextResponse.json({ success: true, data: payload });
}
