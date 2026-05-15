import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

const BUCKET_NAME = 'notificaciones-media';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;  // 5 MB
const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30 MB

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

// POST /api/admin/notificaciones/upload
// Sube una imagen o video al bucket de Supabase Storage.
// Acepta multipart/form-data con un campo 'file'.
// Devuelve: { success, url, type }
export async function POST(request: NextRequest) {
  const gate = requireRoot(request);
  if (gate !== true) return gate;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'Request debe ser multipart/form-data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ success: false, error: 'Campo "file" requerido' }, { status: 400 });
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      return NextResponse.json(
        { success: false, error: 'Tipo de archivo no soportado. Solo imagen (image/*) o video (video/*).' },
        { status: 400 }
      );
    }

    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      const limitMB = maxBytes / (1024 * 1024);
      return NextResponse.json(
        { success: false, error: `Archivo demasiado grande. Limite: ${limitMB}MB para ${isImage ? 'imagenes' : 'videos'}.` },
        { status: 400 }
      );
    }

    // Determinar extension del archivo
    const ext = file.name.split('.').pop()?.toLowerCase() || (isImage ? 'jpg' : 'mp4');
    const path = `notif-temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const mediaType: 'image' | 'video' = isImage ? 'image' : 'video';

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getServerSupabaseClient() as any;

    const { error: uploadError } = await client.storage
      .from(BUCKET_NAME)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[notificaciones/upload] Storage error:', uploadError);

      // Detectar si el bucket no existe
      const msg = typeof uploadError.message === 'string' ? uploadError.message : '';
      if (
        msg.includes('not found') ||
        msg.includes('Bucket not found') ||
        msg.includes('does not exist')
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Bucket '${BUCKET_NAME}' no encontrado. Crearlo manualmente en el dashboard de Supabase: Storage → New bucket → Name: ${BUCKET_NAME} → Public: ON`,
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { success: false, error: 'Error al subir el archivo al Storage' },
        { status: 500 }
      );
    }

    const { data: urlData } = client.storage
      .from(BUCKET_NAME)
      .getPublicUrl(path);

    const publicUrl: string = urlData?.publicUrl ?? '';

    return NextResponse.json({ success: true, url: publicUrl, type: mediaType });
  } catch (error) {
    console.error('[notificaciones/upload] Error en POST:', error);
    return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
  }
}
