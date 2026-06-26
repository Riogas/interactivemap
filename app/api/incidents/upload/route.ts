/**
 * POST /api/incidents/upload
 *
 * Recibe el blob del video de incidencia en el body y lo sube al bucket
 * "incident-videos" de Supabase Storage usando el service_role desde el
 * server. El blob NUNCA viaja directo del browser a Supabase Storage.
 *
 * Por qué: el host interno de Supabase (supabase.glp.riogas.com.uy) usa un
 * cert de una CA interna de RioGas. Browsers fuera de la red rechazan el PUT
 * directo a la signed URL con ERR_CERT_AUTHORITY_INVALID. Proxyando el upload
 * por nuestro backend, el browser solo habla con el dominio del track (cert
 * válido). Es el espejo del proxy de descarga en [id]/video/route.ts.
 *
 * Request:
 *   - Content-Type: video/webm | video/mp4
 *   - body: bytes del video
 *   - header x-track-user: obligatorio (gate, igual que /upload-url)
 *
 * Respuesta:
 *   { success: true, path: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Uploads de video grandes pueden tardar minutos

const BUCKET = 'incident-videos';
// Mismo límite que /api/incidents (guard de tamaño real del blob recibido)
const MAX_DECLARED_SIZE_MB = 500;

export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-track-user');
    if (!username) {
      return NextResponse.json(
        { success: false, error: 'No autorizado' },
        { status: 401 },
      );
    }

    const rawContentType = request.headers.get('content-type') ?? '';
    const mime = rawContentType.split(';')[0].trim().toLowerCase();
    if (mime !== 'video/webm' && mime !== 'video/mp4') {
      return NextResponse.json(
        { success: false, error: 'Tipo de archivo no soportado (solo video/webm o video/mp4).' },
        { status: 400 },
      );
    }

    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: 'El video está vacío.' },
        { status: 400 },
      );
    }
    if (buffer.byteLength > MAX_DECLARED_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: `El video supera el máximo de ${MAX_DECLARED_SIZE_MB}MB.` },
        { status: 413 },
      );
    }

    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const videoPath = `${y}/${m}/${d}/${safeUser}-${now.getTime()}.${ext}`;

    const supabase = getServerSupabaseClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(videoPath, buffer, { contentType: mime, upsert: false });

    if (error) {
      console.error('[incidents/upload] error subiendo al bucket:', error);
      return NextResponse.json(
        { success: false, error: `No se pudo subir el video: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, path: videoPath });
  } catch (e) {
    console.error('[incidents/upload] excepción:', e);
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
