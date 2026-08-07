/**
 * /api/metricas/variantes/reproceso — la cola de reprocesos del
 * Laboratorio de variantes.
 *
 *   POST → encola un reproceso (RPC `metricas_lab_job_crear`)
 *   GET  → los últimos trabajos con su estado (RPC `metricas_lab_jobs_listar`)
 *
 * Reprocesar una semana son cientos de corridas simuladas de a una y en
 * orden: no puede colgar de un request HTTP. Por eso acá solo se encola,
 * y el worker de pg_cron (`demoras-lab-reproceso`, cada minuto) lo
 * ejecuta. Ver docs/sqls/2026-08-07-lab-jobs-rpc.sql.
 *
 * Gates: los mismos que la lectura del scoreboard (requireAuth +
 * allowlist de email + funcionalidad + scope fail-closed) MÁS root
 * obligatorio: esto escribe sobre todo el rango y para todas las
 * empresas, así que no hay recorte por empresa que lo haga seguro.
 *
 * Query param: escenario (req, numérico).
 * Body del POST: { desde?, hasta? (YYYY-MM-DD), variantes?: number[]|null }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-middleware';
import { requireFuncionalidad, requireAllowlistedEmail } from '@/lib/api-auth-gates';
import type { LabJob, LabJobsData } from '@/types/metricas-variantes';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_JOBS: LabJobsData = { escenario: null, jobs: [] };

type SupabaseCompat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type GateOk = { escenario: number; email: string | null };

/**
 * Todos los gates + el escenario, compartidos por GET y POST. Devuelve la
 * NextResponse de rechazo o los datos ya validados.
 */
async function pasarGates(request: NextRequest): Promise<GateOk | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const allowGate = requireAllowlistedEmail(auth.user?.email, process.env.METRICAS_DASHBOARD_ALLOWED_EMAILS);
  if (allowGate !== true) return allowGate;

  const funcGate = requireFuncionalidad(request, 'Estadisticas Cumplimiento');
  if (funcGate !== true) return funcGate;

  // Mismo scope fail-closed que la lectura: sin root, un usuario sin
  // empresas asignadas no tiene alcance ninguno.
  const isRoot = request.headers.get('x-track-isroot') === 'S';
  if (!isRoot) {
    const empresasHeader = request.headers.get('x-track-empresas-ids');
    const scopeEmpresaIds =
      empresasHeader !== null && empresasHeader.trim() !== ''
        ? empresasHeader.split(',').map((v) => Number.parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n))
        : [];
    // Y aunque tenga empresas: el reproceso reescribe las variantes de
    // todo el rango, para todas las empresas. No hay forma de recortarlo
    // al scope de nadie, así que es solo para root.
    return NextResponse.json(
      {
        success: false,
        error:
          scopeEmpresaIds.length === 0
            ? 'Acceso denegado'
            : 'El reproceso del laboratorio es solo para usuarios root: recalcula el rango completo, para todas las empresas.',
        code: 'FORBIDDEN',
      },
      { status: 403 },
    );
  }

  const escenario = Number.parseInt(request.nextUrl.searchParams.get('escenario') ?? '', 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const email = typeof auth.user?.email === 'string' ? (auth.user.email as string) : null;
  return { escenario, email };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await pasarGates(request);
  if (gate instanceof NextResponse) return gate;

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;
  const { data, error } = await db.rpc('metricas_lab_jobs_listar', { p: { escenario: gate.escenario } });

  if (error) {
    console.error('[metricas/variantes/reproceso] error listando trabajos:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al obtener los reprocesos del laboratorio', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: (data ?? EMPTY_JOBS) as LabJobsData });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await pasarGates(request);
  if (gate instanceof NextResponse) return gate;

  // Un body ausente o roto es un pedido con los defaults de la RPC
  // (última semana, todas las variantes), no un 500.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const b = (body ?? {}) as { desde?: unknown; hasta?: unknown; variantes?: unknown };

  const fechas: Record<'desde' | 'hasta', string | null> = { desde: null, hasta: null };
  for (const nombre of ['desde', 'hasta'] as const) {
    const valor = b[nombre];
    if (valor === undefined || valor === null || valor === '') continue;
    if (typeof valor !== 'string' || !DATE_RE.test(valor)) {
      return NextResponse.json(
        { success: false, error: `Parámetro "${nombre}" inválido (YYYY-MM-DD)`, code: 'INVALID_FECHA' },
        { status: 400 },
      );
    }
    fechas[nombre] = valor;
  }

  let variantes: number[] | null = null;
  if (b.variantes !== undefined && b.variantes !== null) {
    if (!Array.isArray(b.variantes)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro "variantes" inválido: lista de ids o null', code: 'INVALID_VARIANTES' },
        { status: 400 },
      );
    }
    const ids = b.variantes.map((v) => Number.parseInt(String(v), 10));
    if (ids.some((n) => !Number.isFinite(n))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro "variantes" inválido: los ids tienen que ser numéricos', code: 'INVALID_VARIANTES' },
        { status: 400 },
      );
    }
    variantes = ids;
  }

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;
  const { data, error } = await db.rpc('metricas_lab_job_crear', {
    p: {
      escenario: gate.escenario,
      desde: fechas.desde,
      hasta: fechas.hasta,
      variantes,
      pedido_por: gate.email,
    },
  });

  if (error) {
    console.error('[metricas/variantes/reproceso] error encolando el reproceso:', error.message);
    return NextResponse.json(
      { success: false, error: 'Error al encolar el reproceso', details: error.message },
      { status: 500 },
    );
  }

  // La RPC rechaza con { error } y un texto ya escrito para mostrar en
  // pantalla (rango muy largo, otro reproceso en curso, ids inválidos).
  const rechazo = (data as { error?: string } | null)?.error;
  if (typeof rechazo === 'string' && rechazo.length > 0) {
    return NextResponse.json({ success: false, error: rechazo, code: 'JOB_RECHAZADO' }, { status: 409 });
  }

  return NextResponse.json({ success: true, data: data as LabJob });
}
