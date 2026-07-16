/**
 * Tests para app/api/email-config/route.ts y app/api/email-config/test/route.ts
 *
 * AC — Gate del GET/PUT/test: 403 sin headers de admin (root o funcionalidad
 * "Preferencias Globales").
 * AC — GET jamás devuelve smtp_password (expone hasPassword en su lugar).
 * AC — PUT con smtpPassword vacía conserva la password existente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue(undefined) })) },
}));

vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { GET, PUT } from '@/app/api/email-config/route';
import { POST as testPOST } from '@/app/api/email-config/test/route';
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

const storedRow: EmailSettingsRow = {
  id: 1,
  enabled: true,
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: 'user',
  smtp_password: 'super-secret-password',
  from_email: 'notificaciones@example.com',
  to_emails: 'soporte@example.com',
  subject_template: 'Nuevo incidente #{{id}} en TrackMovil',
  body_template: 'Descripcion: {{descripcion}}',
  updated_at: '2026-07-08T10:00:00.000Z',
  updated_by: 'system',
};

function buildMockClient(row: EmailSettingsRow | null) {
  let currentRow = row;
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: number) => ({
          maybeSingle: () => Promise.resolve({ data: currentRow, error: null }),
        }),
      }),
      upsert: (vals: Record<string, unknown>, _opts?: { onConflict: string }) => ({
        select: (_cols: string) => ({
          single: () => {
            currentRow = { ...(currentRow ?? storedRow), ...vals } as EmailSettingsRow;
            return Promise.resolve({ data: currentRow, error: null });
          },
        }),
      }),
    }),
  };
}

function makeRequest(method: string, opts?: {
  body?: unknown;
  isRootHeader?: string;
  funcsHeader?: string;
  user?: string;
}): NextRequest {
  const url = 'http://localhost/api/email-config';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.isRootHeader !== undefined) headers['x-track-isroot'] = opts.isRootHeader;
  if (opts?.funcsHeader !== undefined) headers['x-track-funcs'] = opts.funcsHeader;
  if (opts?.user !== undefined) headers['x-track-user'] = opts.user;
  return new NextRequest(url, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe('GET /api/email-config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin headers de admin → 403', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('con x-track-isroot=S → 200 y NUNCA devuelve smtp_password (expone hasPassword)', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = makeRequest('GET', { isRootHeader: 'S' });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.smtpPassword).toBe('');
    expect(JSON.stringify(json.data)).not.toContain('super-secret-password');
    expect(json.data.hasPassword).toBe(true);
  });

  it('con x-track-funcs conteniendo "Preferencias Globales" → 200', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = makeRequest('GET', { funcsHeader: 'Otra Funcionalidad,Preferencias Globales' });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('sin fila guardada → hasPassword false y defaults', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(null));
    const req = makeRequest('GET', { isRootHeader: 'S' });
    const res = await GET(req);
    const json = await res.json() as { data: { hasPassword: boolean; enabled: boolean } };
    expect(json.data.hasPassword).toBe(false);
    expect(json.data.enabled).toBe(false);
  });
});

describe('PUT /api/email-config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin headers de admin → 403', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = makeRequest('PUT', { body: { enabled: true } });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it('con smtpPassword vacía, conserva la password existente (no la pisa)', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient({ ...storedRow }));
    const req = makeRequest('PUT', {
      isRootHeader: 'S',
      user: 'dmedaglia',
      body: {
        enabled: true,
        smtpHost: 'smtp.nuevo.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'nuevo-user',
        smtpPassword: '', // vacía → conservar la anterior
        fromEmail: 'nuevo@example.com',
        toEmails: 'a@b.com',
        subjectTemplate: 'Asunto {{id}}',
        bodyTemplate: 'Cuerpo {{descripcion}}',
      },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { smtpPassword: string; hasPassword: boolean; smtpHost: string } };
    expect(json.success).toBe(true);
    // El GET nunca devuelve la password real, pero hasPassword debe seguir true
    // (la password guardada en DB sigue siendo la original, no se pisó).
    expect(json.data.smtpPassword).toBe('');
    expect(json.data.hasPassword).toBe(true);
    expect(json.data.smtpHost).toBe('smtp.nuevo.com');
  });

  it('con smtpPassword no vacía, actualiza la password', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient({ ...storedRow, smtp_password: '' }));
    const req = makeRequest('PUT', {
      isRootHeader: 'S',
      body: {
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'user',
        smtpPassword: 'nueva-password',
        toEmails: 'a@b.com',
      },
    });
    const res = await PUT(req);
    const json = await res.json() as { data: { hasPassword: boolean } };
    expect(json.data.hasPassword).toBe(true);
  });
});

describe('POST /api/email-config/test', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin headers de admin → 403', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = new NextRequest('http://localhost/api/email-config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await testPOST(req);
    expect(res.status).toBe(403);
  });

  it('con headers de admin y config válida → 200 success:true', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient(storedRow));
    const req = new NextRequest('http://localhost/api/email-config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-track-isroot': 'S' },
      body: JSON.stringify({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await testPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('con headers de admin pero sin smtp_host configurado → 400 con error explícito', async () => {
    (getServerSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(buildMockClient({ ...storedRow, smtp_host: '' }));
    const req = new NextRequest('http://localhost/api/email-config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-track-isroot': 'S' },
      body: JSON.stringify({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await testPOST(req);
    expect(res.status).toBe(400);
    const json = await res.json() as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toContain('SMTP');
  });
});
