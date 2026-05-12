import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/admin/login-security/unblock — Desbloquear usuario o IP manualmente
 *
 * Body: { type: 'user' | 'ip', value: string }
 * Efecto: soft-unblock en login_blocks (is_active=false, unblocked_at, unblocked_by)
 * Audit trail: registra quién hizo el unblock y cuándo.
 *
 * Gate: header x-track-isroot: 'S'
 */

function requireRoot(request: NextRequest): true | NextResponse {
  const isRoot = request.headers.get('x-track-isroot');
  if (isRoot !== 'S') {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NOT_ROOT' },
      { status: 403 }
    );
  }
  return true;
}

export async function POST(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body inválido' },
      { status: 400 }
    );
  }

  const { type, value } = body as Record<string, unknown>;

  // Validar type
  if (type !== 'user' && type !== 'ip') {
    return NextResponse.json(
      { success: false, error: 'type debe ser "user" o "ip"' },
      { status: 400 }
    );
  }

  // Validar value
  if (typeof value !== 'string' || value.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'value debe ser un string no vacío' },
      { status: 400 }
    );
  }

  const unblockedBy = request.headers.get('x-track-user') ?? null;
  const unblockedAt = new Date().toISOString();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    // Buscar el bloqueo activo para ese type+value
    // Usar queries .eq() separadas (NUNCA .or() con template strings — lesson supabase-or-injection-prevention)
    const { data: block, error: findError } = await client
      .from('login_blocks')
      .select('id, block_type, key, blocked_until, reason')
      .eq('block_type', type)
      .eq('key', value.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (findError) {
      console.error('[unblock] Error al buscar bloqueo:', findError);
      return NextResponse.json(
        { success: false, error: 'Error al buscar el bloqueo' },
        { status: 500 }
      );
    }

    if (!block) {
      return NextResponse.json(
        { success: false, error: `No se encontró un bloqueo activo de tipo "${type}" para "${value.trim()}"`, code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Soft-unblock: marcar como inactivo con audit trail
    const { error: updateError } = await client
      .from('login_blocks')
      .update({
        is_active: false,
        unblocked_at: unblockedAt,
        unblocked_by: unblockedBy,
      })
      .eq('id', block.id);

    if (updateError) {
      console.error('[unblock] Error al desbloquear:', updateError);
      return NextResponse.json(
        { success: false, error: 'Error al desbloquear' },
        { status: 500 }
      );
    }

    console.log(`✅ [unblock] ${type}="${value.trim()}" desbloqueado por "${unblockedBy ?? 'unknown'}" (id=${block.id})`);

    return NextResponse.json({
      success: true,
      unblocked: {
        id: block.id,
        block_type: block.block_type,
        key: block.key,
        unblocked_at: unblockedAt,
        unblocked_by: unblockedBy,
      },
    });
  } catch (error) {
    console.error('[api/admin/login-security/unblock] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
