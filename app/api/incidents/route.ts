/**
 * POST /api/incidents
 *
 * Recibe metadata del incidente y crea la fila en la tabla incidents.
 * El video ya fue subido directamente a Supabase Storage desde el cliente
 * usando la signed upload URL de /api/incidents/upload-url — este endpoint
 * NO recibe el blob, solo JSON con metadata.
 *
 * Body JSON:
 *   - video_path: string (path en el bucket, devuelto por /upload-url)
 *   - description: string (mínimo 10 chars)
 *   - duration_s?: number
 *   - mime_type?: string
 *   - size_bytes?: number
 *   - contact_email?: string
 *   - contact_celular: string (obligatorio)
 *   - reporter_nombre?: string
 *
 * Notificación: si INCIDENT_WEBHOOK_URL está definido, se hace un POST
 * fire-and-forget al webhook (ej: n8n). El webhook falla silenciosamente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Solo metadata, no upload — 30s más que suficiente

const BUCKET = 'incident-videos';
// Límite de size_bytes que el cliente declara (guard contra datos manipulados)
const MAX_DECLARED_SIZE_MB = 500;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

function extractUser(req: NextRequest): { userId: string | null; username: string | null } {
  const headerUsername = req.headers.get('x-track-user');
  const headerUserId = req.headers.get('x-track-userid');
  if (headerUsername) {
    return { userId: headerUserId, username: headerUsername };
  }
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const decoded = decodeJwtPayload(auth.slice(7));
    if (decoded) {
      return {
        userId: String(decoded.userId ?? '') || null,
        username: String(decoded.username ?? '') || null,
      };
    }
  }
  return { userId: null, username: null };
}

/**
 * Notifica via webhook (fire-and-forget).
 * No lanza excepciones — cualquier error se loguea como warn.
 */
function notifyWebhook(payload: {
  id: number;
  username: string | null;
  ts: string;
  description: string | null;
  detail_url: string;
  ip: string;
}): void {
  const webhookUrl = process.env.INCIDENT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err: unknown) => {
      console.warn('[incidents/notify] webhook falló (no bloquea):', err);
    });
  } catch (e) {
    console.warn('[incidents/notify] error armando webhook:', e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      video_path?: string;
      description?: string;
      duration_s?: number;
      mime_type?: string;
      size_bytes?: number;
      contact_email?: string;
      contact_celular?: string;
      reporter_nombre?: string;
    };

    // Validar video_path
    const video_path = typeof body.video_path === 'string' ? body.video_path.trim() : '';
    if (!video_path) {
      return NextResponse.json(
        { success: false, error: 'video_path es requerido' },
        { status: 400 },
      );
    }

    // Validar description
    const description = typeof body.description === 'string' ? body.description.slice(0, 2000).trim() : '';
    if (!description || description.length < 10) {
      return NextResponse.json(
        { success: false, error: 'La descripcion es obligatoria y debe tener al menos 10 caracteres.' },
        { status: 400 },
      );
    }

    // Validar celular
    const contact_celular_raw = typeof body.contact_celular === 'string' ? body.contact_celular.trim() : '';
    if (!contact_celular_raw) {
      return NextResponse.json(
        { success: false, error: 'Celular requerido', code: 'CELULAR_REQUIRED' },
        { status: 400 },
      );
    }
    const contact_celular = contact_celular_raw.slice(0, 50);

    // Guard de size declarado (no podemos verificar el real, el cliente declara)
    const size_bytes = typeof body.size_bytes === 'number' ? body.size_bytes : null;
    if (size_bytes !== null && size_bytes > MAX_DECLARED_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: `Tamaño declarado mayor a ${MAX_DECLARED_SIZE_MB}MB` },
        { status: 413 },
      );
    }

    const duration_s = typeof body.duration_s === 'number' ? Math.max(0, body.duration_s) : null;
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'video/webm';
    const contact_email = typeof body.contact_email === 'string' ? body.contact_email.slice(0, 200) || null : null;
    const reporter_nombre = typeof body.reporter_nombre === 'string' ? body.reporter_nombre.slice(0, 200) || null : null;

    const { userId, username } = extractUser(request);
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    const now = new Date();

    // Verificar que el archivo realmente existe en Storage antes de insertar
    // (previene inserts con paths inventados)
    const supabase = getServerSupabaseClient();
    const { data: fileData, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(video_path.split('/').slice(0, -1).join('/'), {
        search: video_path.split('/').pop(),
      });

    if (listError || !fileData || fileData.length === 0) {
      console.warn('[incidents] video_path no encontrado en storage:', video_path, listError?.message);
      return NextResponse.json(
        { success: false, error: 'El video no fue encontrado en el almacenamiento. Intentá subir de nuevo.' },
        { status: 400 },
      );
    }

    // Insert en incidents
    const row = {
      user_id: userId,
      username,
      reporter_nombre,
      description,
      contact_email,
      contact_celular,
      video_path,
      duration_s,
      size_bytes,
      mime_type: mimeType,
      ip,
      user_agent: userAgent,
      status: 'open',
    };

    const insertResult = await (
      supabase.from('incidents') as unknown as {
        insert: (r: typeof row) => {
          select: () => { single: () => Promise<{ data: { id: number } | null; error: { message: string } | null }> };
        };
      }
    )
      .insert(row)
      .select()
      .single();

    if (insertResult.error) {
      // Rollback del upload — el video ya está en storage, lo borramos
      await supabase.storage.from(BUCKET).remove([video_path]);
      return NextResponse.json(
        { success: false, error: `Error guardando metadata: ${insertResult.error.message}` },
        { status: 500 },
      );
    }

    const insertedId = insertResult.data?.id ?? 0;

    // Notificación fire-and-forget (no bloquea la respuesta)
    notifyWebhook({
      id: insertedId,
      username,
      ts: now.toISOString(),
      description,
      detail_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/incidencias?id=${insertedId}`,
      ip,
    });

    return NextResponse.json({
      success: true,
      id: insertedId,
      video_path,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
