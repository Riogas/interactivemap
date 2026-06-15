import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { requireFuncionalidad } from '@/lib/api-auth-gates';

/**
 * POST /api/admin/reset-manual
 *
 * Repunta app_config.manual_url al PDF estático del sistema
 * (public/manual/InstructivoRiogasTracking.pdf), neutralizando cualquier
 * override previo que apuntara a un archivo en Supabase Storage.
 *
 * Útil cuando el manual se distribuye junto con el deploy (archivo en el repo)
 * en lugar de subirse a Storage — evita los límites de tamaño del proxy en la
 * subida de archivos grandes.
 *
 * Gate: funcionalidad 'Subir manuales de usuario' (misma que upload-manual).
 *
 * No recibe body. Usa service role (bypass RLS) y corre server-side, por lo que
 * usa las credenciales correctas del entorno (no las del cliente).
 *
 * Response: { success: true, url, uploadedAt, uploadedBy }
 */

const STATIC_PATH = '/manual/InstructivoRiogasTracking.pdf';

export async function POST(request: NextRequest) {
  const gate = requireFuncionalidad(request, 'Subir manuales de usuario');
  if (gate !== true) return gate;

  try {
    const supabase = getServerSupabaseClient();
    const username =
      request.headers.get('x-track-user') ??
      request.headers.get('x-track-username') ??
      'admin';
    const now = new Date().toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('app_config').upsert(
      {
        key: 'manual_url',
        value: STATIC_PATH,
        description: 'URL del manual de uso descargable desde el botón ? del dashboard',
        updated_at: now,
        updated_by: username,
      },
      { onConflict: 'key' }
    );

    if (error) {
      console.error('[reset-manual] Error al actualizar app_config:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'No se pudo actualizar la configuración' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: STATIC_PATH,
      uploadedAt: now,
      uploadedBy: username,
    });
  } catch (error) {
    console.error('[reset-manual] Error en POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
