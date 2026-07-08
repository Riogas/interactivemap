/**
 * POST /api/email-config/test — envía un mail de prueba con la config de
 * notificación de incidentes (gate: root o funcionalidad "Preferencias Globales").
 *
 * Acepta un body opcional con overrides (para probar antes de guardar, ej: el
 * admin cambia el host y quiere probar sin haber apretado "Guardar" todavía).
 * Si el body no trae `smtpPassword`, se usa la password ya guardada (no se
 * puede probar sin password si nunca se guardó una).
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendTestEmail, type EmailSettings } from '@/lib/email';

function isAdminRequest(request: NextRequest): boolean {
  const isRootHeader = request.headers.get('x-track-isroot') === 'S';
  const funcs = new Set(
    (request.headers.get('x-track-funcs') ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0),
  );
  return isRootHeader || funcs.has('Preferencias Globales');
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json(
      { success: false, error: 'Acceso denegado', code: 'NO_FUNCIONALIDAD' },
      { status: 403 },
    );
  }

  let overrides: Partial<EmailSettings> = {};
  try {
    const body = await request.json();
    if (body && typeof body === 'object') overrides = body as Partial<EmailSettings>;
  } catch {
    // Body vacío/no-JSON: probar con la config guardada tal cual.
  }

  const result = await sendTestEmail(overrides);
  return NextResponse.json({ success: result.ok, error: result.error }, { status: result.ok ? 200 : 400 });
}
