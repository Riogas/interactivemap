/**
 * GET /api/demoras/comparativa
 *
 * Serie del día y brecha por zona entre la demora que calcula TrackMovil y
 * la que informa el AS400. Lee `demoras_calculadas`, que guarda el snapshot
 * del AS400 en cada corrida — el import del AS400 pisa su propia tabla, así
 * que sin ese snapshot no habría con qué comparar.
 *
 * Query params:
 *   - escenario (requerido, int)
 *   - fecha     (opcional, YYYY-MM-DD; default hoy en Montevideo)
 *   - tipo      (opcional, URGENTE|NOCTURNO|SERVICE; default URGENTE)
 *   - zona      (opcional, int) — si viene, `serie` es de esa zona
 *
 * OJO: el AS400 solo informa URGENTE. Para NOCTURNO y SERVICE `as400` viene
 * null y la brecha no se puede calcular; la UI lo dice explícitamente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
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

function hoyMontevideo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
}

function prom(xs: number[]): number {
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
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
  const fecha = fechaRaw ?? hoyMontevideo();

  const zonaRaw = sp.get('zona');
  const zonaSel = zonaRaw !== null ? Number.parseInt(zonaRaw, 10) : null;

  // demoras_calculadas no está en types/supabase.ts: cast a una cadena tipada
  // a mano (mismo patrón que app/api/audit/list/route.ts) en vez de `any`.
  const db = getServerSupabaseClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            gte: (c: string, v: unknown) => {
              lte: (c: string, v: unknown) => {
                order: (
                  c: string,
                  o: { ascending: boolean },
                ) => Promise<{ data: Fila[] | null; error: { message: string } | null }>;
              };
            };
          };
        };
      };
    };
  };

  const { data, error } = await db
    .from('demoras_calculadas')
    .select('corrida_at, zona_id, tipo_servicio, demora_informada, demora_as400')
    .eq('escenario', escenario)
    .eq('tipo_servicio', tipo)
    .gte('corrida_at', `${fecha}T00:00:00-03:00`)
    .lte('corrida_at', `${fecha}T23:59:59-03:00`)
    .order('corrida_at', { ascending: true });

  if (error) {
    console.error('[demoras/comparativa] error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener la comparativa', details: error.message },
      { status: 500 },
    );
  }

  const filas = data ?? [];

  const serie: PuntoComparativa[] = filas
    .filter((f) => zonaSel === null || f.zona_id === zonaSel)
    .map((f) => ({ corrida_at: f.corrida_at, calculada: f.demora_informada, as400: f.demora_as400 }));

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
        zona_nombre: `Zona ${zona_id}`,
        prom_calculada: pc,
        prom_as400: pa,
        brecha: pa === null ? null : Math.round((pc - pa) * 100) / 100,
      };
    })
    .sort((a, b) => Math.abs(b.brecha ?? -1) - Math.abs(a.brecha ?? -1));

  const payload: ComparativaData = { serie, zonas };
  return NextResponse.json({ success: true, data: payload });
}
