import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

/**
 * POST /api/admin/upload-manual
 *
 * Sube un PDF al bucket 'manuals' de Supabase Storage (path fijo: manual/actual.pdf)
 * y actualiza app_config.manual_url con la publicUrl del archivo subido.
 *
 * Gate: funcionalidad 'Subir manuales de usuario'
 *
 * Body: multipart/form-data con campo 'file' (.pdf, max 20MB)
 *
 * Response: { success: true, url, uploadedAt, uploadedBy }
 */

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const STORAGE_BUCKET = 'manuals';
const STORAGE_PATH = 'manual/actual.pdf';

export async function POST(request: NextRequest) {
  const gate = requireFuncionalidad(request, 'Subir manuales de usuario');
  if (gate !== true) return gate;

  // Parsear FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: 'No se pudo parsear el formulario' },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json(
      { success: false, error: 'No se recibió archivo (campo "file" requerido)' },
      { status: 400 }
    );
  }

  // Validar extensión y tipo MIME
  if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') {
    return NextResponse.json(
      { success: false, error: 'Solo se aceptan archivos PDF (.pdf)' },
      { status: 400 }
    );
  }

  // Validar tamaño
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { success: false, error: 'El archivo supera el límite de 20MB' },
      { status: 400 }
    );
  }

  // Usar service role (bypasea RLS) — lección del repo: server-supabase-client-for-rls-bypass
  const supabase = getServerSupabaseClient();

  // Extraer username del header (para auditoría en app_config.updated_by)
  const username =
    request.headers.get('x-track-user') ??
    request.headers.get('x-track-username') ??
    'admin';

  // Leer archivo como ArrayBuffer para el upload
  const arrayBuffer = await file.arrayBuffer();

  // Upload a Supabase Storage con upsert (overwrite atómico)
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_PATH, arrayBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('[upload-manual] Error al subir a Storage:', uploadError);
    return NextResponse.json(
      { success: false, error: uploadError.message },
      { status: 500 }
    );
  }

  // Obtener la publicUrl del archivo subido
  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(STORAGE_PATH);

  const now = new Date().toISOString();

  // Actualizar app_config con la nueva URL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any).from('app_config').upsert(
    {
      key: 'manual_url',
      value: publicUrl,
      description: 'URL del manual de uso descargable desde el botón ? del dashboard',
      updated_at: now,
      updated_by: username,
    },
    { onConflict: 'key' }
  );

  if (dbError) {
    // El archivo ya se subió — loguear pero no fallar.
    // Degradación graceful: el archivo está disponible aunque no se actualizó la BD.
    console.error('[upload-manual] Error al actualizar app_config:', dbError);
  }

  return NextResponse.json({
    success: true,
    url: publicUrl,
    uploadedAt: now,
    uploadedBy: username,
  });
}
