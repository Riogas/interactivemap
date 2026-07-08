/**
 * Tests para app/api/incidents/route.ts — disparo de sendIncidentEmail()
 *
 * Spec (2026-07-08-incidentes-email-notificacion-design.md):
 *   "El insert de incidente sigue devolviendo success:true aunque
 *    sendIncidentEmail tire error (mock de nodemailer que lanza)."
 *
 * Nota: sendIncidentEmail() NUNCA lanza (try/catch interno) — el mock de
 * nodemailer.createTransport().sendMail rechazando prueba que ese catch
 * realmente absorbe el error sin afectar el POST (fire-and-forget real,
 * no awaited por la ruta).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock nodemailer: createTransport().sendMail siempre rechaza.
// vi.mock es hoisted al top del archivo — usamos vi.hoisted() para poder
// referenciar los mocks tanto dentro del factory como en los tests.
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});
vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { POST } from '@/app/api/incidents/route';
import { getServerSupabaseClient } from '@/lib/supabase';

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

const enabledEmailRow: EmailSettingsRow = {
  id: 1,
  enabled: true,
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: 'user',
  smtp_password: 'pass',
  from_email: 'notificaciones@example.com',
  to_emails: 'soporte@example.com',
  subject_template: 'Nuevo incidente #{{id}} en TrackMovil',
  body_template: 'Descripcion: {{descripcion}}',
  updated_at: '2026-07-08T10:00:00.000Z',
  updated_by: 'system',
};

function buildMockClient(emailRow: EmailSettingsRow | null) {
  return {
    storage: {
      from: (_bucket: string) => ({
        list: vi.fn().mockResolvedValue({ data: [{ name: 'video.webm' }], error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
    from: (table: string) => {
      if (table === 'incidents') {
        return {
          insert: (_row: unknown) => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 999 }, error: null }),
            }),
          }),
        };
      }
      if (table === 'email_settings') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: number) => ({
              maybeSingle: () => Promise.resolve({ data: emailRow, error: emailRow ? null : { message: 'not found' } }),
            }),
          }),
        };
      }
      throw new Error(`tabla inesperada en el mock: ${table}`);
    },
  };
}

function makeIncidentRequest(): NextRequest {
  const url = 'http://localhost/api/incidents';
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-track-user': 'operador1',
    },
    body: JSON.stringify({
      video_path: '2026/07/08/operador1-123.webm',
      description: 'Descripcion suficientemente larga para pasar validacion',
      contact_celular: '099123456',
      contact_email: 'operador1@example.com',
      reporter_nombre: 'Operador Uno',
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe('POST /api/incidents — dispara sendIncidentEmail sin bloquear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  it('el insert responde success:true aunque el envío de correo (nodemailer) falle', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(enabledEmailRow));

    const req = makeIncidentRequest();
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; id: number };
    expect(json.success).toBe(true);
    expect(json.id).toBe(999);
  });

  it('sendIncidentEmail intenta enviar (nodemailer se invoca) sin propagar el error al caller', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(enabledEmailRow));

    const req = makeIncidentRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Dejar correr el microtask del fire-and-forget (sendIncidentEmail no es awaited por la ruta).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTransportMock).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalled();
  });

  it('con email_settings enabled:false, no se intenta enviar el correo (pero el insert igual funciona)', async () => {
    const disabledRow: EmailSettingsRow = { ...enabledEmailRow, enabled: false };
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(disabledRow));

    const req = makeIncidentRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('si falta la fila de email_settings (fallback a defaults), el insert sigue funcionando', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(null));

    const req = makeIncidentRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });
});
