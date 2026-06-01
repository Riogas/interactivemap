import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

/**
 * POST /api/moviles-dia/rebuild
 *
 * Dispara fn_moviles_dia_rebuild para reconstruir el read model
 * moviles_dia en el rango [desde, hasta] para un escenario dado.
 *
 * Gate: funcionalidad 'Reconstruir read model moviles_dia'
 *
 * Body:
 *   { "desde": "YYYY-MM-DD", "hasta": "YYYY-MM-DD", "escenario"?: number }
 *
 * Response:
 *   { ok: true } | { error: string }
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, fieldName: string): Date | NextResponse {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return NextResponse.json(
      { error: `${fieldName} debe tener formato YYYY-MM-DD` },
      { status: 400 }
    );
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return NextResponse.json(
      { error: `${fieldName} no es una fecha válida` },
      { status: 400 }
    );
  }
  return d;
}

export async function POST(request: NextRequest) {
  const gate = requireFuncionalidad(request, 'Reconstruir read model moviles_dia');
  if (gate !== true) return gate;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const desdeResult = parseDate(body.desde, 'desde');
  if (desdeResult instanceof NextResponse) return desdeResult;

  const hastaResult = parseDate(body.hasta, 'hasta');
  if (hastaResult instanceof NextResponse) return hastaResult;

  const desde = body.desde as string;
  const hasta = body.hasta as string;

  // Validar rango máximo de 180 días
  const diffMs = desdeResult < hastaResult
    ? hastaResult.getTime() - desdeResult.getTime()
    : desdeResult.getTime() - hastaResult.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 180) {
    return NextResponse.json({ error: 'máximo 180 días' }, { status: 400 });
  }

  const escenario = body.escenario !== undefined
    ? (typeof body.escenario === 'number' ? body.escenario : Number(body.escenario))
    : null;

  if (escenario !== null && !Number.isFinite(escenario)) {
    return NextResponse.json({ error: 'escenario debe ser un número entero válido' }, { status: 400 });
  }

  console.log('[moviles-dia/rebuild] iniciando rebuild:', { desde, hasta, escenario });

  const { error } = await (supabase as any).rpc('fn_moviles_dia_rebuild', {
    p_desde: desde,
    p_hasta: hasta,
    p_escenario: escenario ?? null,
  });

  if (error) {
    console.error('[moviles-dia/rebuild] error en fn_moviles_dia_rebuild:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  console.log('[moviles-dia/rebuild] completado OK:', { desde, hasta, escenario });

  return NextResponse.json({ ok: true });
}
