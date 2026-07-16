/**
 * GET  /api/email-config — config GLOBAL de notificación de incidentes por correo
 * PUT  /api/email-config — actualiza la config (gate: root o funcionalidad "Preferencias Globales")
 *
 * Config GLOBAL ÚNICA (una sola fila id=1 en email_settings), mismo modelo de
 * confianza que /api/realtime-config: header x-track-isroot y/o x-track-funcs
 * confiados client-side.
 *
 * A diferencia de /api/realtime-config, el GET acá TAMBIÉN está gateado
 * (la config incluye credenciales SMTP) y NUNCA devuelve smtp_password —
 * en su lugar expone `hasPassword: boolean` para que el front sepa si ya
 * hay una contraseña guardada.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase';
import { DEFAULT_EMAIL_SETTINGS, rowToEmailSettings, type EmailSettings } from '@/lib/email';

interface EmailSettingsRow {
  id: number;
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  from_email: string;
  to_emails: string;
  subject_template: string;
  body_template: string;
  updated_at: string;
  updated_by: string | null;
}

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

function denyResponse() {
  return NextResponse.json(
    { success: false, error: 'Acceso denegado', code: 'NO_FUNCIONALIDAD' },
    { status: 403 },
  );
}

async function readSettingsRow(): Promise<EmailSettingsRow | null> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await (
    supabase.from('email_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          maybeSingle: () => Promise<{ data: EmailSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn('[email-config] read error:', error.message);
    return null;
  }
  return data;
}

// Omite smtp_password del payload devuelto al cliente; agrega hasPassword.
function toClientPayload(row: EmailSettingsRow | null): (EmailSettings & { hasPassword: boolean }) {
  if (!row) return { ...DEFAULT_EMAIL_SETTINGS, hasPassword: false };
  const settings = rowToEmailSettings(row);
  const { smtpPassword, ...rest } = settings;
  return { ...rest, smtpPassword: '', hasPassword: smtpPassword.length > 0 };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return denyResponse();

  const row = await readSettingsRow();
  return NextResponse.json({ success: true, data: toClientPayload(row) });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export async function PUT(request: NextRequest) {
  if (!isAdminRequest(request)) return denyResponse();

  let body: Partial<EmailSettings>;
  try {
    body = (await request.json()) as Partial<EmailSettings>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 });
  }

  const updatedBy = request.headers.get('x-track-user');

  // Password vacía/undefined en el body = conservar la anterior (no pisar).
  const currentRow = await readSettingsRow();
  const currentPassword = currentRow?.smtp_password ?? DEFAULT_EMAIL_SETTINGS.smtpPassword;
  const nextPassword = typeof body.smtpPassword === 'string' && body.smtpPassword.trim().length > 0
    ? body.smtpPassword
    : currentPassword;

  const upsert = {
    id: 1,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : DEFAULT_EMAIL_SETTINGS.enabled,
    smtp_host: typeof body.smtpHost === 'string' ? body.smtpHost.trim().slice(0, 255) : DEFAULT_EMAIL_SETTINGS.smtpHost,
    smtp_port: clampInt(body.smtpPort, 1, 65535, DEFAULT_EMAIL_SETTINGS.smtpPort),
    smtp_secure: typeof body.smtpSecure === 'boolean' ? body.smtpSecure : DEFAULT_EMAIL_SETTINGS.smtpSecure,
    smtp_user: typeof body.smtpUser === 'string' ? body.smtpUser.trim().slice(0, 255) : DEFAULT_EMAIL_SETTINGS.smtpUser,
    smtp_password: nextPassword,
    from_email: typeof body.fromEmail === 'string' ? body.fromEmail.trim().slice(0, 255) : DEFAULT_EMAIL_SETTINGS.fromEmail,
    to_emails: typeof body.toEmails === 'string' ? body.toEmails.trim().slice(0, 1000) : DEFAULT_EMAIL_SETTINGS.toEmails,
    subject_template: typeof body.subjectTemplate === 'string' && body.subjectTemplate.trim().length > 0
      ? body.subjectTemplate.slice(0, 500)
      : DEFAULT_EMAIL_SETTINGS.subjectTemplate,
    body_template: typeof body.bodyTemplate === 'string' && body.bodyTemplate.trim().length > 0
      ? body.bodyTemplate.slice(0, 5000)
      : DEFAULT_EMAIL_SETTINGS.bodyTemplate,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy ?? null,
  };

  const supabase = getServerSupabaseClient();
  const { data, error } = await (
    supabase.from('email_settings') as unknown as {
      upsert: (vals: Record<string, unknown>, opts?: { onConflict: string }) => {
        select: (cols: string) => {
          single: () => Promise<{ data: EmailSettingsRow | null; error: { message: string } | null }>;
        };
      };
    }
  )
    .upsert(upsert, { onConflict: 'id' })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[email-config] update error:', error?.message);
    return NextResponse.json({ success: false, error: error?.message ?? 'Error al guardar' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: toClientPayload(data) });
}
