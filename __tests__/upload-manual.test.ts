/**
 * Tests para:
 *  - POST /api/admin/upload-manual
 *  - GET  /api/manual/current
 *
 * AC1  — POST upload válido (PDF ≤20MB, x-track-isroot=S) → 200 con { success, url, uploadedAt, uploadedBy }
 * AC2  — POST sin permiso (x-track-isroot≠S) → 403
 * AC3  — POST sin archivo → 400
 * AC4  — POST con archivo no-PDF → 400
 * AC5  — POST con archivo >20MB → 400
 * AC6  — GET /api/manual/current sin auth → 200 con { url, updated_at, updated_by }
 * AC7  — GET /api/manual/current cuando Supabase falla → 200 con fallback URL estática
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Lección: supabase-tests-require-mocks — SIEMPRE mockear getServerSupabaseClient en tests
vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { POST } from '@/app/api/admin/upload-manual/route';
import { GET } from '@/app/api/manual/current/route';
import { getServerSupabaseClient } from '@/lib/supabase';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeUploadRequest(opts: {
  isRoot?: string;
  file?: { name: string; type: string; size: number; content?: string };
  username?: string;
  funcs?: string;
}): NextRequest {
  const { isRoot = 'S', file, username = 'admin', funcs = 'Subir manuales de usuario' } = opts;
  const headers: Record<string, string> = {
    'x-track-isroot': isRoot,
    'x-track-user': username,
  };
  // El route usa requireFuncionalidad('Subir manuales de usuario') → lee x-track-funcs.
  if (funcs) headers['x-track-funcs'] = funcs;

  const formData = new FormData();
  if (file) {
    const content = file.content ?? 'fake pdf content';
    // Creamos un Blob con el tipo MIME dado para simular el File
    const blob = new Blob([content], { type: file.type });
    // FormData.set espera File — en Node/Vitest el Blob es suficiente
    formData.append('file', new File([blob], file.name, { type: file.type }));
  }

  return new NextRequest('http://localhost/api/admin/upload-manual', {
    method: 'POST',
    headers,
    body: formData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/manual/current', { method: 'GET' });
}

// ─── Mock factory para Supabase Storage + DB ────────────────────────────────

function makeSupabaseMock(opts: {
  uploadError?: { message: string } | null;
  publicUrl?: string;
  upsertError?: { message: string } | null;
  selectData?: { value: string; updated_at: string | null; updated_by: string | null } | null;
  selectError?: { message: string } | null;
}) {
  const {
    uploadError = null,
    publicUrl = 'https://supabase.glp.riogas.com.uy/storage/v1/object/public/manuals/manual/actual.pdf',
    upsertError = null,
    selectData = { value: 'https://supabase.glp.riogas.com.uy/storage/v1/object/public/manuals/manual/actual.pdf', updated_at: '2026-05-26T21:00:00Z', updated_by: 'admin' },
    selectError = null,
  } = opts;

  const storageMock = {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ error: uploadError }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl } }),
    })),
  };

  const dbSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: selectData, error: selectError }),
  };

  const dbMock = {
    from: vi.fn((table: string) => {
      if (table === 'app_config') {
        return {
          ...dbSelectChain,
          upsert: vi.fn().mockResolvedValue({ error: upsertError }),
        };
      }
      return {};
    }),
    storage: storageMock,
  };

  // El storage mock se expone directamente en el cliente
  (dbMock as any).storage = storageMock;

  return dbMock;
}

// ─── Tests: POST /api/admin/upload-manual ────────────────────────────────────

describe('POST /api/admin/upload-manual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1 — upload válido devuelve 200 con url y metadata', async () => {
    const mock = makeSupabaseMock({});
    (getServerSupabaseClient as any).mockReturnValue(mock);

    const req = makeUploadRequest({
      isRoot: 'S',
      file: { name: 'manual.pdf', type: 'application/pdf', size: 1024 * 100 }, // 100KB
      username: 'admin@riogas',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.url).toContain('manuals/manual/actual.pdf');
    expect(json.uploadedBy).toBe('admin@riogas');
    expect(json.uploadedAt).toBeDefined();
  });

  it('AC2 — sin la funcionalidad "Subir manuales de usuario" (y no root) devuelve 403', async () => {
    const req = makeUploadRequest({ isRoot: 'N', funcs: '', file: { name: 'manual.pdf', type: 'application/pdf', size: 100 } });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.code).toBe('NO_FUNCIONALIDAD');
  });

  it('AC3 — sin archivo devuelve 400', async () => {
    const mock = makeSupabaseMock({});
    (getServerSupabaseClient as any).mockReturnValue(mock);

    // Request sin file en formData (con la funcionalidad para pasar el gate)
    const req = new NextRequest('http://localhost/api/admin/upload-manual', {
      method: 'POST',
      headers: { 'x-track-isroot': 'S', 'x-track-funcs': 'Subir manuales de usuario' },
      body: new FormData(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('AC4 — archivo no-PDF devuelve 400', async () => {
    const mock = makeSupabaseMock({});
    (getServerSupabaseClient as any).mockReturnValue(mock);

    const req = makeUploadRequest({
      isRoot: 'S',
      file: { name: 'manual.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1024 },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('PDF');
  });

  it('AC5 — archivo >20MB devuelve 400', async () => {
    const mock = makeSupabaseMock({});
    (getServerSupabaseClient as any).mockReturnValue(mock);

    // Creamos un archivo con size > 20MB
    const bigContent = 'a'.repeat(21 * 1024 * 1024);
    const req = makeUploadRequest({
      isRoot: 'S',
      file: { name: 'manual-big.pdf', type: 'application/pdf', size: 21 * 1024 * 1024, content: bigContent },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('20MB');
  });

  it('AC5b — error de Storage propaga 500', async () => {
    const mock = makeSupabaseMock({ uploadError: { message: 'Bucket not found' } });
    (getServerSupabaseClient as any).mockReturnValue(mock);

    const req = makeUploadRequest({
      isRoot: 'S',
      file: { name: 'manual.pdf', type: 'application/pdf', size: 1024 },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });
});

// ─── Tests: GET /api/manual/current ─────────────────────────────────────────

describe('GET /api/manual/current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC6 — devuelve 200 con url, updated_at, updated_by desde BD', async () => {
    const mock = makeSupabaseMock({
      selectData: {
        value: 'https://supabase.glp.riogas.com.uy/storage/v1/object/public/manuals/manual/actual.pdf',
        updated_at: '2026-05-26T21:00:00Z',
        updated_by: 'admin@riogas',
      },
    });
    (getServerSupabaseClient as any).mockReturnValue(mock);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toContain('manuals');
    expect(json.updated_by).toBe('admin@riogas');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('AC7 — si Supabase falla, devuelve URL fallback estática', async () => {
    const mock = makeSupabaseMock({
      selectData: null,
      selectError: { message: 'Connection refused' },
    });
    (getServerSupabaseClient as any).mockReturnValue(mock);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('/manual/InstructivoRiogasTracking.pdf');
    expect(json.updated_at).toBeNull();
  });

  it('AC7b — si Supabase throws, devuelve URL fallback estática', async () => {
    (getServerSupabaseClient as any).mockImplementation(() => {
      throw new Error('Supabase completely down');
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('/manual/InstructivoRiogasTracking.pdf');
  });
});
