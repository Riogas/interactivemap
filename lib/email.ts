/**
 * Notificación de incidentes por correo (SMTP via nodemailer).
 *
 * Config GLOBAL ÚNICA (fila id=1 en email_settings), mismo patrón que
 * lib/supabase.ts + realtime_settings: se lee/escribe con getServerSupabaseClient()
 * (service_role) y se administra desde Preferencias Globales (root/admin).
 *
 * sendIncidentEmail() es fire-and-forget: NUNCA lanza — cualquier error
 * (settings inválidos, SMTP caído, etc.) se loguea como warn y no afecta
 * el guardado del incidente (ver app/api/incidents/route.ts).
 */
import nodemailer from 'nodemailer';
import { getServerSupabaseClient } from '@/lib/supabase';

// camelCase (cliente/API) ↔ snake_case (DB)
export interface EmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  toEmails: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  toEmails: '',
  subjectTemplate: 'Nuevo incidente #{{id}} en TrackMovil',
  bodyTemplate:
    'Se reportó un incidente el {{fecha}}.\n\n' +
    'Usuario: {{usuario}}\n' +
    'Reporta: {{reporter}}\n' +
    'Celular: {{celular}}\n' +
    'Email: {{email}}\n\n' +
    'Descripción:\n{{descripcion}}\n\n' +
    'Ver detalle: {{link}}',
};

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

export function rowToEmailSettings(row: EmailSettingsRow): EmailSettings {
  return {
    enabled: row.enabled,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    smtpUser: row.smtp_user,
    smtpPassword: row.smtp_password,
    fromEmail: row.from_email,
    toEmails: row.to_emails,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
  };
}

/**
 * Lee la fila id=1 de email_settings. Si no existe o hay error, devuelve
 * los defaults (envío desactivado) para no romper el flujo de incidentes.
 */
export async function getEmailSettings(): Promise<EmailSettings & { hasPassword: boolean }> {
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
    if (error) console.warn('[email] read settings error:', error.message);
    return { ...DEFAULT_EMAIL_SETTINGS, hasPassword: false };
  }

  const settings = rowToEmailSettings(data);
  return { ...settings, hasPassword: settings.smtpPassword.length > 0 };
}

/**
 * Reemplaza variables {{clave}} en una plantilla. Las claves desconocidas
 * (sin match en `vars`) se dejan intactas.
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

function buildTransport(settings: EmailSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUser
      ? { user: settings.smtpUser, pass: settings.smtpPassword }
      : undefined,
  });
}

function buildIncidentVars(incident: {
  id: number;
  usuario: string | null;
  reporter: string | null;
  celular: string | null;
  email: string | null;
  descripcion: string;
  fecha: string;
}): Record<string, string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return {
    id: String(incident.id),
    usuario: incident.usuario ?? '',
    reporter: incident.reporter ?? '',
    celular: incident.celular ?? '',
    email: incident.email ?? '',
    descripcion: incident.descripcion,
    fecha: incident.fecha,
    link: `${appUrl}/admin/incidencias?id=${incident.id}`,
  };
}

/**
 * Envía el mail de notificación de un incidente recién cargado.
 * Fire-and-forget: NUNCA lanza. Si `enabled` es false o faltan host/destinatarios,
 * simplemente no envía (no es un error).
 */
export async function sendIncidentEmail(incident: {
  id: number;
  usuario: string | null;
  reporter: string | null;
  celular: string | null;
  email: string | null;
  descripcion: string;
  fecha: string;
}): Promise<void> {
  try {
    const settings = await getEmailSettings();
    if (!settings.enabled) return;
    if (!settings.smtpHost || !settings.toEmails.trim()) return;

    const vars = buildIncidentVars(incident);
    const subject = renderTemplate(settings.subjectTemplate, vars);
    const text = renderTemplate(settings.bodyTemplate, vars);

    const transport = buildTransport(settings);
    await transport.sendMail({
      from: settings.fromEmail || settings.smtpUser,
      to: settings.toEmails,
      subject,
      text,
    });
  } catch (err) {
    console.warn('[email] sendIncidentEmail falló (no bloquea el incidente):', err);
  }
}

/**
 * Envía un mail de prueba con datos ficticios. A diferencia de sendIncidentEmail,
 * devuelve el resultado explícito para que el admin pueda diagnosticar el error de SMTP.
 * Acepta overrideSettings para probar una config antes de guardarla.
 */
export async function sendTestEmail(
  overrideSettings?: Partial<EmailSettings>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const stored = await getEmailSettings();
    // Password vacía en el override = usar la ya guardada (el cliente nunca
    // recibe la password real por GET, así que un override "" no debe borrarla).
    const settings: EmailSettings = {
      ...stored,
      ...overrideSettings,
      smtpPassword: overrideSettings?.smtpPassword ? overrideSettings.smtpPassword : stored.smtpPassword,
    };

    if (!settings.smtpHost) {
      return { ok: false, error: 'Falta configurar el servidor SMTP (smtp_host).' };
    }
    if (!settings.toEmails.trim()) {
      return { ok: false, error: 'Falta configurar al menos un destinatario (to_emails).' };
    }

    const vars = buildIncidentVars({
      id: 0,
      usuario: 'usuario_prueba',
      reporter: 'Prueba de notificación',
      celular: '099 000 000',
      email: 'prueba@trackmovil.local',
      descripcion: 'Este es un correo de prueba de la configuración de notificación de incidentes.',
      fecha: new Date().toLocaleString('es-UY'),
    });
    const subject = `[PRUEBA] ${renderTemplate(settings.subjectTemplate, vars)}`;
    const text = renderTemplate(settings.bodyTemplate, vars);

    const transport = buildTransport(settings);
    await transport.sendMail({
      from: settings.fromEmail || settings.smtpUser,
      to: settings.toEmails,
      subject,
      text,
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al enviar el correo.';
    return { ok: false, error: message };
  }
}
