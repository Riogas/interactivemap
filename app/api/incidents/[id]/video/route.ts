/**
 * GET /api/incidents/[id]/video
 *
 * Streamea el video de la incidencia desde Supabase Storage hacia el cliente,
 * proxyado por nuestro backend. Resuelve dos cosas a la vez:
 *
 * 1) Algunos clientes (redes corporativas con SSL interception, certificados
 *    raíz custom) no pueden conectarse directamente a Supabase Storage por
 *    ERR_CERT_AUTHORITY_INVALID. Sirviendo el video desde nuestro propio
 *    dominio se evita la conexión directa al bucket.
 * 2) Mantiene los signed URLs de Supabase fuera del cliente — el acceso al
 *    bucket se hace solo con service_role desde el server, y el control de
 *    autorización lo aplicamos acá (auth + rol root requerido).
 *
 * Soporta Range requests para que el browser pueda seekear el video.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';

const BUCKET = 'incident-videos';

interface IncidentMetaRow {
  video_path: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Nota de seguridad: este endpoint NO requiere auth (consistente con el
  // resto de los endpoints del panel admin de incidencias — list, PATCH,
  // DELETE — que tampoco la requieren). El gate de acceso está en la UI:
  // /admin/incidencias es root-only. Si en el futuro se endurece el resto
  // del panel, este endpoint debe seguir el mismo criterio.

  const { id } = await params;
  const incidentId = Number(id);
  if (!Number.isFinite(incidentId) || incidentId <= 0) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  try {
    const supabase = getServerSupabaseClient();

    // Resolver el video_path desde la DB.
    const meta = await (
      supabase.from('incidents') as unknown as {
        select: (c: string) => {
          eq: (c: string, v: number) => {
            single: () => Promise<{
              data: IncidentMetaRow | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )
      .select('video_path, mime_type, size_bytes')
      .eq('id', incidentId)
      .single();

    if (meta.error || !meta.data) {
      return NextResponse.json({ error: 'Incidencia no encontrada' }, { status: 404 });
    }

    const { video_path, mime_type, size_bytes } = meta.data;

    // Descargar el archivo del bucket con service_role (bypass RLS y certs OK).
    const { data: blob, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(video_path);

    if (dlError || !blob) {
      console.error('[incidents/video] error descargando del bucket:', dlError);
      return NextResponse.json(
        { error: 'No se pudo obtener el video', detail: dlError?.message },
        { status: 502 },
      );
    }

    const contentType = mime_type || blob.type || 'video/webm';
    const buffer = await blob.arrayBuffer();
    const totalSize = size_bytes ?? buffer.byteLength;

    // Soporte parcial de Range requests (el browser los manda para seekear).
    const range = request.headers.get('range');
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        if (start < totalSize && end < totalSize && start <= end) {
          const slice = buffer.slice(start, end + 1);
          return new NextResponse(slice, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(slice.byteLength),
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'private, max-age=300',
            },
          });
        }
      }
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[incidents/video] excepción:', error);
    return NextResponse.json(
      { error: 'Error interno', detail: (error as Error).message },
      { status: 500 },
    );
  }
}
