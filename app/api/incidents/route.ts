/**
 * POST /api/incidents
 *
 * Recibe un video de grabación de pantalla desde el IncidentRecorder y lo
 * sube al bucket "incident-videos" de Supabase Storage. Crea una fila en
 * la tabla incidents con la metadata (user, duration, size, description).
 *
 * Multipart form:
 *   - video: File (webm/mp4)
 *   - description: string (opcional)
 *   - duration_s: number (opcional)
 *
 * Notificación: si INCIDENT_WEBHOOK_URL está definido, se hace un POST
 * fire-and-forget al webhook (ej: n8n) con el payload de la incidencia.
 * El webhook falla silenciosamente — no bloquea la respuesta al cliente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min para uploads grandes

const BUCKET = 'incident-videos';
const MAX_SIZE_MB = 500;

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
    const form = await request.formData();
    const video = form.get('video');

    if (!(video instanceof Blob)) {
      return NextResponse.json(
        { success: false, error: 'Se esperaba un archivo en el campo "video"' },
        { status: 400 },
      );
    }

    if (video.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: `Archivo mayor a ${MAX_SIZE_MB}MB` },
        { status: 413 },
      );
    }

    const description = (form.get('description') as string | null)?.slice(0, 2000) ?? null;
    // Descripcion es obligatoria y minimo 10 caracteres (server-side guard, la
    // UI ya valida pero el endpoint puede ser invocado directamente).
    if (!description || description.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: 'La descripcion es obligatoria y debe tener al menos 10 caracteres.' },
        { status: 400 },
      );
    }
    const durationStr = form.get('duration_s') as string | null;
    const duration_s = durationStr ? Math.max(0, Number(durationStr)) || null : null;
    const mimeType = video.type || 'video/webm';
    // Contacto: email opcional, celular obligatorio.
    const contact_email = (form.get('contact_email') as string | null)?.slice(0, 200) || null;
    const contact_celular_raw = (form.get('contact_celular') as string | null)?.trim() ?? '';
    // Server-side guard: el celular es obligatorio — protege contra clientes
    // que bypaseen el form (Postman, devtools, etc.).
    if (!contact_celular_raw) {
      return NextResponse.json(
        { success: false, error: 'Celular requerido', code: 'CELULAR_REQUIRED' },
        { status: 400 },
      );
    }
    const contact_celular = contact_celular_raw.slice(0, 50);
    const reporter_nombre = (form.get('reporter_nombre') as string | null)?.slice(0, 200) || null;

    const { userId, username } = extractUser(request);
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const userAgent = request.headers.get('user-agent') ?? 'unknown';

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const safeUser = (username ?? 'anon').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const videoPath = `${y}/${m}/${d}/${safeUser}-${now.getTime()}.${ext}`;

    // Upload al bucket
    const supabase = getServerSupabaseClient();
    const buffer = Buffer.from(await video.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(videoPath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { success: false, error: `Error subiendo video: ${uploadError.message}` },
        { status: 500 },
      );
    }

    // Insert en incidents (cast porque la tabla no está en types/supabase.ts generado)
    const row = {
      user_id: userId,
      username,
      reporter_nombre,
      description,
      contact_email,
      contact_celular,
      video_path: videoPath,
      duration_s,
      size_bytes: video.size,
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
      // Rollback del upload
      await supabase.storage.from(BUCKET).remove([videoPath]);
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
      video_path: videoPath,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
