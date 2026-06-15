/**
 * POST /api/incidents/upload-url
 *
 * Genera una signed upload URL para subir el video de incidencia
 * directamente al bucket "incident-videos" de Supabase Storage desde
 * el browser — sin pasar el blob por nginx ni por el body parser.
 *
 * El cliente sube el blob con un PUT al signedUrl y luego llama
 * POST /api/incidents con solo la metadata (description, video_path, etc.)
 *
 * Body JSON:
 *   - mime: string (video/webm, video/mp4)
 *
 * Respuesta:
 *   { success: true, signedUrl: string, token: string, path: string }
 *
 * La signed URL expira en el default de Supabase Storage (1 hora), más que
 * suficiente para que el cliente complete el upload antes de que expire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'incident-videos';

function extractUsername(req: NextRequest): string {
  const header = req.headers.get('x-track-user');
  if (header) return header;
  return 'anon';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { mime?: string };
    const username = extractUsername(request);

    const mime = typeof body.mime === 'string' ? body.mime : 'video/webm';
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const videoPath = `${y}/${m}/${d}/${safeUser}-${now.getTime()}.${ext}`;

    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(videoPath, { upsert: false });

    if (error || !data) {
      console.error('[incidents/upload-url] error generando signed URL:', error);
      return NextResponse.json(
        {
          success: false,
          error: `No se pudo generar la URL de upload: ${error?.message ?? 'error desconocido'}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      signedUrl: data.signedUrl,
      token: data.token,
      path: videoPath,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
