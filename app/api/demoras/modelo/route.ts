/**
 * GET/PUT /api/demoras/modelo — configuración del motor de demora informada
 * (Preferencias Globales → sección "Motor de demora").
 *
 * GET ?escenario=N → { modelo (fila completa de demoras_modelo), config
 * (demoras_config por tipo), historial (últimas versiones), escenarios }.
 *
 * PUT { escenario, modelo?: {campos}, config?: [{tipo_servicio, ...}] } →
 * UPDATE con whitelist de campos. La VALIDACIÓN de dominio vive en los
 * CHECKs de la base (única fuente de verdad — los mismos que protegen al
 * motor): un valor inválido vuelve como 400 con el mensaje del CHECK. El
 * trigger de demoras_modelo versiona y snapshotea en
 * demoras_modelo_historial; las corridas siguientes quedan estampadas con
 * la versión nueva (modelo_version).
 *
 * Gate: root (x-track-isroot=S) O funcionalidad "Preferencias Globales" —
 * mismo criterio y mismo patrón que app/api/realtime-config/route.ts (es
 * la misma pantalla). updated_by = header x-track-user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { CAMPOS_MODELO_LISTA } from '@/lib/demoras-campos';

export const dynamic = 'force-dynamic';

/**
 * Campos editables de demoras_modelo. Todo lo que no está acá se ignora
 * en el PUT (nunca 500 por un campo de más; un typo simplemente no llega
 * a la base). `version`, `updated_*` y `escenario_id` quedan fuera a
 * propósito: los maneja el trigger.
 */
const CAMPOS_MODELO = new Set<string>(CAMPOS_MODELO_LISTA);

const CAMPOS_CONFIG = new Set(['motor_activo', 'hora_inicio', 'hora_fin']);

const TIPOS = ['URGENTE', 'NOCTURNO', 'SERVICE'];
const DIA_TIPOS = ['HABIL', 'SABADO', 'DOMINGO'];

type SQB = {
  select: (cols?: string) => SQB;
  eq: (col: string, val: unknown) => SQB;
  is: (col: string, val: null) => SQB;
  order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => SQB;
  limit: (n: number) => SQB;
  update: (vals: Record<string, unknown>) => SQB;
  insert: (vals: Record<string, unknown>) => SQB;
  upsert: (vals: Record<string, unknown>, opts: { onConflict: string }) => SQB;
  delete: () => SQB;
  then: Promise<{ data: unknown; error: { message: string } | null }>['then'];
};
type SupabaseCompat = { from: (table: string) => SQB };

function gate(request: NextRequest): NextResponse | null {
  const isRootHeader = request.headers.get('x-track-isroot') === 'S';
  const funcs = new Set(
    (request.headers.get('x-track-funcs') ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  if (!isRootHeader && !funcs.has('Preferencias Globales')) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NO_FUNCIONALIDAD' },
      { status: 403 },
    );
  }
  return null;
}

async function payload(db: SupabaseCompat, escenario: number) {
  const [modelo, config, historial, escenarios, ventanas, esperaMax] = await Promise.all([
    db.from('demoras_modelo').select('*').eq('escenario_id', escenario) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>,
    db.from('demoras_config').select('*').eq('escenario_id', escenario).order('tipo_servicio', { ascending: true }) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>,
    db.from('demoras_modelo_historial')
      .select('version, cambiado_at, cambiado_por')
      .eq('escenario_id', escenario)
      .order('version', { ascending: false })
      .limit(8) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>,
    db.from('demoras_modelo').select('escenario_id').order('escenario_id', { ascending: true }) as unknown as Promise<{ data: { escenario_id: number }[] | null; error: { message: string } | null }>,
    db.from('demoras_ventanas').select('*').eq('escenario_id', escenario).order('tipo_servicio', { ascending: true }) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>,
    db.from('demoras_espera_max')
      .select('*')
      .eq('escenario_id', escenario)
      .order('zona_id', { ascending: true, nullsFirst: true }) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>,
  ]);

  const err = modelo.error ?? config.error ?? historial.error ?? escenarios.error
    ?? ventanas.error ?? esperaMax.error;
  if (err) return { error: err.message };

  return {
    modelo: (modelo.data ?? [])[0] ?? null,
    config: config.data ?? [],
    historial: historial.data ?? [],
    escenarios: (escenarios.data ?? []).map((e) => e.escenario_id),
    ventanas: ventanas.data ?? [],
    esperaMax: esperaMax.data ?? [],
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = gate(request);
  if (denied) return denied;

  const escenario = Number.parseInt(request.nextUrl.searchParams.get('escenario') ?? '', 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const db = getServerSupabaseClient() as unknown as SupabaseCompat;
  const data = await payload(db, escenario);
  if ('error' in data) {
    return NextResponse.json({ success: false, error: data.error }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const denied = gate(request);
  if (denied) return denied;

  let body: {
    escenario?: number;
    modelo?: Record<string, unknown>;
    config?: Array<Record<string, unknown> & { tipo_servicio?: string }>;
    ventanas?: Array<{ tipo_servicio?: string; dia_tipo?: string; hora_inicio?: string; hora_fin?: string }>;
    esperaMax?: Array<{ tipo_servicio?: string; dia_tipo?: string; zona_id?: number | null; hora_max?: string | null }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 });
  }

  const escenario = Number.parseInt(String(body.escenario ?? ''), 10);
  if (!Number.isFinite(escenario)) {
    return NextResponse.json(
      { success: false, error: 'Campo "escenario" requerido y numérico', code: 'INVALID_ESCENARIO' },
      { status: 400 },
    );
  }

  const updatedBy = request.headers.get('x-track-user');
  const db = getServerSupabaseClient() as unknown as SupabaseCompat;

  // ── demoras_modelo (whitelist; los CHECKs de la base validan dominio) ──
  if (body.modelo && typeof body.modelo === 'object') {
    const cambios: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.modelo)) {
      if (CAMPOS_MODELO.has(k)) cambios[k] = v;
    }
    if (Object.keys(cambios).length > 0) {
      cambios.updated_by = updatedBy ?? null;
      const { error } = await (db.from('demoras_modelo').update(cambios).eq('escenario_id', escenario) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) {
        // Un CHECK que rechaza es un 400 (valor fuera de dominio), no un 500.
        const esCheck = /check|constraint|invalid/i.test(error.message);
        return NextResponse.json(
          { success: false, error: `No se pudo guardar el modelo: ${error.message}` },
          { status: esCheck ? 400 : 500 },
        );
      }
    }
  }

  // ── demoras_config por tipo ────────────────────────────────────────────
  for (const fila of body.config ?? []) {
    const tipo = String(fila.tipo_servicio ?? '');
    if (!['URGENTE', 'NOCTURNO', 'SERVICE'].includes(tipo)) continue;
    const cambios: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fila)) {
      if (CAMPOS_CONFIG.has(k)) cambios[k] = v;
    }
    if (Object.keys(cambios).length === 0) continue;
    cambios.updated_by = updatedBy ?? null;
    const { error } = await (db.from('demoras_config').update(cambios).eq('escenario_id', escenario).eq('tipo_servicio', tipo) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
    if (error) {
      const esCheck = /check|constraint|invalid/i.test(error.message);
      return NextResponse.json(
        { success: false, error: `No se pudo guardar la config de ${tipo}: ${error.message}` },
        { status: esCheck ? 400 : 500 },
      );
    }
  }

  // ── demoras_ventanas (ventana del cron por tipo de día) ────────────────
  // Upsert por PK: la fila puede no existir (solo URGENTE viene sembrado).
  for (const fila of body.ventanas ?? []) {
    const tipo = String(fila.tipo_servicio ?? '');
    const dia = String(fila.dia_tipo ?? '');
    if (!TIPOS.includes(tipo) || !DIA_TIPOS.includes(dia)) continue;
    if (fila.hora_inicio == null && fila.hora_fin == null) continue;
    const { error } = await (db.from('demoras_ventanas').upsert({
      escenario_id: escenario,
      tipo_servicio: tipo,
      dia_tipo: dia,
      ...(fila.hora_inicio != null ? { hora_inicio: fila.hora_inicio } : {}),
      ...(fila.hora_fin != null ? { hora_fin: fila.hora_fin } : {}),
      updated_by: updatedBy ?? null,
    }, { onConflict: 'escenario_id,tipo_servicio,dia_tipo' }) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
    if (error) {
      const esCheck = /check|constraint|invalid/i.test(error.message);
      return NextResponse.json(
        { success: false, error: `No se pudo guardar la ventana ${tipo}/${dia}: ${error.message}` },
        { status: esCheck ? 400 : 500 },
      );
    }
  }

  // ── demoras_espera_max ─────────────────────────────────────────────────
  // zona_id null = la default del escenario+tipo+día (update; la siembra la
  // migración). zona_id con hora_max = override (update o insert). zona_id
  // con hora_max null = borrar el override (la default nunca se borra: el
  // motor la necesita como respaldo).
  for (const fila of body.esperaMax ?? []) {
    const tipo = String(fila.tipo_servicio ?? '');
    const dia = String(fila.dia_tipo ?? '');
    if (!TIPOS.includes(tipo) || !DIA_TIPOS.includes(dia)) continue;
    const zona = fila.zona_id == null ? null : Number.parseInt(String(fila.zona_id), 10);
    if (zona !== null && !Number.isFinite(zona)) continue;

    let error: { message: string } | null = null;
    if (zona !== null && fila.hora_max == null) {
      ({ error } = await (db.from('demoras_espera_max').delete()
        .eq('escenario_id', escenario).eq('tipo_servicio', tipo)
        .eq('dia_tipo', dia).eq('zona_id', zona) as unknown as Promise<{ data: unknown; error: { message: string } | null }>));
    } else if (fila.hora_max != null) {
      const base = db.from('demoras_espera_max')
        .update({ hora_max: fila.hora_max, updated_by: updatedBy ?? null })
        .eq('escenario_id', escenario).eq('tipo_servicio', tipo).eq('dia_tipo', dia);
      const upd = await ((zona === null ? base.is('zona_id', null) : base.eq('zona_id', zona))
        .select() as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>);
      error = upd.error;
      if (!error && (upd.data ?? []).length === 0) {
        ({ error } = await (db.from('demoras_espera_max').insert({
          escenario_id: escenario,
          tipo_servicio: tipo,
          dia_tipo: dia,
          zona_id: zona,
          hora_max: fila.hora_max,
          updated_by: updatedBy ?? null,
        }) as unknown as Promise<{ data: unknown; error: { message: string } | null }>));
      }
    }
    if (error) {
      const esCheck = /check|constraint|invalid/i.test(error.message);
      return NextResponse.json(
        { success: false, error: `No se pudo guardar la espera máxima ${tipo}/${dia}: ${error.message}` },
        { status: esCheck ? 400 : 500 },
      );
    }
  }

  const data = await payload(db, escenario);
  if ('error' in data) {
    return NextResponse.json({ success: false, error: data.error }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}
