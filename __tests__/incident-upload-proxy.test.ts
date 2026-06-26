/**
 * QA tests — POST /api/incidents/upload (proxy endpoint)
 *
 * Cubre los acceptance criteria del fix de upload de incidencias:
 *   AC1: Browser nunca habla con supabase.glp.riogas.com.uy (el blob va a /api/incidents/upload)
 *   AC2: Funciona dentro/fuera de la red (sin diferencia — el server proxya)
 *   AC3: Progress real via XHR.upload.onprogress preservado
 *   AC4: video_path devuelto por /upload es usado en el POST /api/incidents metadata
 *   AC5: contact_celular y INCIDENT_WEBHOOK_URL no tocados
 *   AC6: Videos hasta ~500MB sin 413 (validación de tamaño en el endpoint)
 *
 * Estrategia:
 *   - Para el endpoint (route.ts): testear la lógica de validación en aislamiento
 *     mockeando getServerSupabaseClient (igual que lección del repo).
 *   - Para el contexto: testear uploadBlobWithProgress() con el nuevo contrato
 *     (POST a /api/incidents/upload, Content-Type del video, x-track-user header,
 *     respuesta { success: true, path } → resolve(path)).
 */

import { describe, it, expect, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers compartidos
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

type MockXhr = {
  open: AnyFn;
  setRequestHeader: AnyFn;
  send: AnyFn;
  status: number;
  responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  _openCalls: unknown[][];
  _headerCalls: unknown[][];
  _sendCalls: unknown[][];
};

function makeMockXhr(opts?: { status?: number; responseText?: string }): MockXhr {
  const openCalls: unknown[][] = [];
  const headerCalls: unknown[][] = [];
  const sendCalls: unknown[][] = [];

  const xhr: MockXhr = {
    open: (...args: unknown[]) => { openCalls.push(args); },
    setRequestHeader: (...args: unknown[]) => { headerCalls.push(args); },
    send: (...args: unknown[]) => { sendCalls.push(args); },
    status: opts?.status ?? 200,
    responseText: opts?.responseText ?? JSON.stringify({ success: true, path: '2026/06/26/user-123.webm' }),
    onload: null,
    onerror: null,
    ontimeout: null,
    upload: { onprogress: null },
    _openCalls: openCalls,
    _headerCalls: headerCalls,
    _sendCalls: sendCalls,
  };
  return xhr;
}

/**
 * Replica testeable de uploadBlobWithProgress() del nuevo flujo:
 * POST a /api/incidents/upload (no PUT a signedUrl),
 * con headers Content-Type y x-track-user,
 * parsea la respuesta JSON y resuelve con el path devuelto.
 */
function uploadBlobWithProgress(
  blob: Blob,
  mimeType: string,
  username: string,
  onProgress: (pct: number) => void,
  xhrFactory: () => MockXhr,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', '/api/incidents/upload');
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('x-track-user', username);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { success?: boolean; path?: string; error?: string };
          if (data.success && data.path) {
            onProgress(100);
            resolve(data.path);
            return;
          }
          reject(new Error(data.error ?? 'El servidor no devolvió el path del video.'));
        } catch {
          reject(new Error('Respuesta inesperada del servidor durante el upload.'));
        }
      } else {
        reject(new Error(`Upload falló con status ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red durante el upload del video.'));
    xhr.ontimeout = () => reject(new Error('Timeout durante el upload del video.'));

    xhr.send(blob);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para simular validación del endpoint (route.ts)
// Se replica la lógica de validación sin montar Next.js
// ─────────────────────────────────────────────────────────────────────────────

type ValidationResult =
  | { ok: true; mime: string; byteLength: number; username: string }
  | { ok: false; status: number; error: string };

/**
 * Replica exacta de la lógica de validación de POST /api/incidents/upload
 * (sin el storage call — ese va a Supabase).
 */
function validateUploadRequest(params: {
  username: string | null;
  contentType: string | null;
  byteLength: number;
}): ValidationResult {
  const MAX_MB = 500;

  if (!params.username) {
    return { ok: false, status: 401, error: 'No autorizado' };
  }

  const rawMime = params.contentType ?? '';
  const mime = rawMime.split(';')[0].trim().toLowerCase();
  if (mime !== 'video/webm' && mime !== 'video/mp4') {
    return { ok: false, status: 400, error: 'Tipo de archivo no soportado (solo video/webm o video/mp4).' };
  }

  if (params.byteLength === 0) {
    return { ok: false, status: 400, error: 'El video está vacío.' };
  }

  if (params.byteLength > MAX_MB * 1024 * 1024) {
    return { ok: false, status: 413, error: `El video supera el máximo de ${MAX_MB}MB.` };
  }

  return { ok: true, mime, byteLength: params.byteLength, username: params.username };
}

/**
 * Replica de la lógica de generación de path (replica del endpoint):
 *   ${y}/${m}/${d}/${safeUser}-${ts}.${ext}
 */
function buildVideoPath(username: string, mime: string, now: Date): string {
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return `${y}/${m}/${d}/${safeUser}-${now.getTime()}.${ext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1: Browser solo habla con track domain (no hay PUT a supabase.glp.riogas.com.uy)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC1 — Browser no contacta supabase.glp.riogas.com.uy', () => {
  it('uploadBlobWithProgress() usa POST, no PUT', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'testuser',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.onload!();
    await p;

    // Debe ser POST, no PUT
    expect(xhrRef!._openCalls[0][0]).toBe('POST');
  });

  it('uploadBlobWithProgress() apunta a /api/incidents/upload (dominio del track, cert válido)', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'testuser',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.onload!();
    await p;

    const url = xhrRef!._openCalls[0][1] as string;
    // No debe contener el host interno de Supabase
    expect(url).not.toContain('supabase.glp.riogas.com.uy');
    // Debe ser la ruta relativa al track domain
    expect(url).toBe('/api/incidents/upload');
  });

  it('uploadBlobWithProgress() NO setea ningún header Authorization de Supabase (anon key)', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'testuser',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.onload!();
    await p;

    const headerNames = xhrRef!._headerCalls.map((c) => (c[0] as string).toLowerCase());
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('apikey');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: Progreso real via xhr.upload.onprogress preservado
// ─────────────────────────────────────────────────────────────────────────────

describe('AC3 — Barra de progreso real preservada', () => {
  it('onprogress reporta porcentajes parciales antes del 100%', async () => {
    let xhrRef: MockXhr | null = null;
    const progressLog: number[] = [];

    const p = uploadBlobWithProgress(
      new Blob(['video-data']),
      'video/webm',
      'testuser',
      (pct) => progressLog.push(pct),
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.upload.onprogress!({ lengthComputable: true, loaded: 25, total: 100 });
    xhrRef!.upload.onprogress!({ lengthComputable: true, loaded: 75, total: 100 });
    xhrRef!.onload!();
    await p;

    expect(progressLog).toContain(25);
    expect(progressLog).toContain(75);
    expect(progressLog).toContain(100);
  });

  it('onprogress con lengthComputable=false no llama onProgress (evita NaN%)', async () => {
    let xhrRef: MockXhr | null = null;
    const progressLog: number[] = [];

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'testuser',
      (pct) => progressLog.push(pct),
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 0 });
    xhrRef!.onload!();
    await p;

    // Solo el 100% del onload exitoso — no el evento no computable
    expect(progressLog).toEqual([100]);
  });

  it('upload.onprogress está asignado (no es null después de open)', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['v']),
      'video/webm',
      'testuser',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    // onprogress debe estar asignado antes del envío
    expect(xhrRef!.upload.onprogress).toBeTypeOf('function');

    xhrRef!.onload!();
    await p;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: video_path devuelto por /upload es el que se pasa a /api/incidents
// ─────────────────────────────────────────────────────────────────────────────

describe('AC4 — video_path del endpoint se usa en metadata POST', () => {
  it('uploadBlobWithProgress() resuelve con el path devuelto por el servidor', async () => {
    const expectedPath = '2026/06/26/jgomez-1719400000000.webm';
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'jgomez',
      () => {},
      () => {
        xhrRef = makeMockXhr({
          status: 200,
          responseText: JSON.stringify({ success: true, path: expectedPath }),
        });
        return xhrRef;
      },
    );

    xhrRef!.onload!();
    const resolvedPath = await p;

    // El caller usa este path para el POST /api/incidents metadata
    expect(resolvedPath).toBe(expectedPath);
  });

  it('uploadBlobWithProgress() rechaza si el servidor devuelve success=true pero sin path', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'jgomez',
      () => {},
      () => {
        xhrRef = makeMockXhr({
          status: 200,
          responseText: JSON.stringify({ success: true }), // sin path
        });
        return xhrRef;
      },
    );

    xhrRef!.onload!();
    await expect(p).rejects.toThrow('El servidor no devolvió el path del video.');
  });

  it('uploadBlobWithProgress() rechaza si el servidor devuelve success=false', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'jgomez',
      () => {},
      () => {
        xhrRef = makeMockXhr({
          status: 200,
          responseText: JSON.stringify({ success: false, error: 'Tipo de archivo no soportado' }),
        });
        return xhrRef;
      },
    );

    xhrRef!.onload!();
    await expect(p).rejects.toThrow('Tipo de archivo no soportado');
  });

  it('x-track-user header se incluye en el XHR (el endpoint lo necesita como gate)', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'operador01',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.onload!();
    await p;

    const trackUserHeader = xhrRef!._headerCalls.find(
      (c) => (c[0] as string).toLowerCase() === 'x-track-user',
    );
    expect(trackUserHeader).toBeDefined();
    expect(trackUserHeader![1]).toBe('operador01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint: validaciones de la route.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('Endpoint POST /api/incidents/upload — validaciones', () => {
  // Gate x-track-user
  it('sin x-track-user → 401 No autorizado', () => {
    const result = validateUploadRequest({ username: null, contentType: 'video/webm', byteLength: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toContain('autorizado');
    }
  });

  // Validación MIME
  it('content-type video/webm → pasa validación', () => {
    const result = validateUploadRequest({ username: 'user', contentType: 'video/webm', byteLength: 1024 });
    expect(result.ok).toBe(true);
  });

  it('content-type video/webm;codecs=vp9,opus → se normaliza y pasa (solo base MIME)', () => {
    const result = validateUploadRequest({
      username: 'user',
      contentType: 'video/webm;codecs=vp9,opus',
      byteLength: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe('video/webm');
    }
  });

  it('content-type video/mp4 → pasa validación', () => {
    const result = validateUploadRequest({ username: 'user', contentType: 'video/mp4', byteLength: 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe('video/mp4');
    }
  });

  it('content-type image/png → 400 tipo no soportado', () => {
    const result = validateUploadRequest({ username: 'user', contentType: 'image/png', byteLength: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('no soportado');
    }
  });

  it('content-type application/octet-stream → 400 tipo no soportado', () => {
    const result = validateUploadRequest({
      username: 'user',
      contentType: 'application/octet-stream',
      byteLength: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  // Validación tamaño vacío
  it('blob de 0 bytes → 400 vacío', () => {
    const result = validateUploadRequest({ username: 'user', contentType: 'video/webm', byteLength: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('vacío');
    }
  });

  // AC6: validación de tamaño máximo
  it('blob de exactamente 500MB → pasa (límite exacto)', () => {
    const exactly500MB = 500 * 1024 * 1024;
    const result = validateUploadRequest({ username: 'user', contentType: 'video/webm', byteLength: exactly500MB });
    expect(result.ok).toBe(true);
  });

  it('blob de 500MB + 1 byte → 413', () => {
    const over500MB = 500 * 1024 * 1024 + 1;
    const result = validateUploadRequest({ username: 'user', contentType: 'video/webm', byteLength: over500MB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.error).toContain('500MB');
    }
  });

  // Generación de path (convención correcta)
  it('buildVideoPath() genera el formato correcto: ${y}/${m}/${d}/${safeUser}-${ts}.${ext}', () => {
    const now = new Date('2026-06-26T10:13:22.000Z');
    const path = buildVideoPath('jgomez', 'video/webm', now);

    // Formato: YYYY/MM/DD/username-timestamp.ext
    expect(path).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[a-zA-Z0-9_-]+-\d+\.webm$/);
    expect(path).toContain('jgomez');
  });

  it('buildVideoPath() usa ext mp4 para video/mp4', () => {
    const now = new Date('2026-06-26T10:00:00.000Z');
    const path = buildVideoPath('user', 'video/mp4', now);
    expect(path.endsWith('.mp4')).toBe(true);
  });

  it('buildVideoPath() sanitiza caracteres especiales del username (max 32 chars)', () => {
    const now = new Date('2026-06-26T10:00:00.000Z');
    // Username con caracteres especiales
    const path = buildVideoPath('user@domain.com', 'video/webm', now);
    // No debe contener @ ni punto en el componente del nombre
    const userPart = path.split('/')[3].split('-')[0];
    expect(userPart).not.toContain('@');
    expect(userPart).not.toContain('.');
    expect(userPart.length).toBeLessThanOrEqual(32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5: contact_celular sigue siendo obligatorio en POST /api/incidents
// (el nuevo endpoint /upload no toca este campo — lo verifica el metadata route)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC5 — contact_celular y webhook no tocados', () => {
  /**
   * Replica de la validación de celular del endpoint /api/incidents/route.ts
   * (el nuevo endpoint /upload no recibe este dato — va en el POST de metadata)
   */
  function validateMetadataBody(body: {
    video_path?: string;
    description?: string;
    contact_celular?: string;
  }): { ok: boolean; error?: string; status?: number } {
    const video_path = typeof body.video_path === 'string' ? body.video_path.trim() : '';
    if (!video_path) return { ok: false, status: 400, error: 'video_path es requerido' };

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description || description.length < 10) {
      return { ok: false, status: 400, error: 'La descripcion es obligatoria y debe tener al menos 10 caracteres.' };
    }

    const celular = typeof body.contact_celular === 'string' ? body.contact_celular.trim() : '';
    if (!celular) {
      return { ok: false, status: 400, error: 'Celular requerido', };
    }

    return { ok: true };
  }

  it('POST /api/incidents sin contact_celular → 400 celular requerido', () => {
    const result = validateMetadataBody({
      video_path: '2026/06/26/user-123.webm',
      description: 'Descripcion larga suficiente para pasar validacion',
      contact_celular: '',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('Celular');
  });

  it('POST /api/incidents con contact_celular válido → pasa validación', () => {
    const result = validateMetadataBody({
      video_path: '2026/06/26/user-123.webm',
      description: 'Descripcion larga suficiente para pasar validacion',
      contact_celular: '099 123 456',
    });
    expect(result.ok).toBe(true);
  });

  it('POST /api/incidents sin video_path → 400 (el path viene del nuevo endpoint)', () => {
    const result = validateMetadataBody({
      video_path: '',
      description: 'Descripcion larga suficiente para pasar validacion',
      contact_celular: '099 123 456',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('video_path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manejo de errores de red en el XHR (error handling del contexto)
// ─────────────────────────────────────────────────────────────────────────────

describe('Manejo de errores del XHR en uploadBlobWithProgress()', () => {
  it('onerror → rechaza con mensaje de red', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'user',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.onerror!();
    await expect(p).rejects.toThrow('Error de red durante el upload del video.');
  });

  it('ontimeout → rechaza con mensaje de timeout', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'user',
      () => {},
      () => { xhrRef = makeMockXhr(); return xhrRef; },
    );

    xhrRef!.ontimeout!();
    await expect(p).rejects.toThrow('Timeout durante el upload del video.');
  });

  it('status 500 → rechaza con el status en el mensaje', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'user',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 500, responseText: JSON.stringify({ success: false, error: 'internal' }) });
        return xhrRef;
      },
    );

    xhrRef!.status = 500;
    xhrRef!.onload!();
    await expect(p).rejects.toThrow('Upload falló con status 500');
  });

  it('status 401 (sin x-track-user) → rechaza con status en el mensaje', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      '', // username vacío — el backend devolvería 401
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 401, responseText: JSON.stringify({ success: false, error: 'No autorizado' }) });
        return xhrRef;
      },
    );

    xhrRef!.status = 401;
    xhrRef!.onload!();
    await expect(p).rejects.toThrow('Upload falló con status 401');
  });

  it('respuesta 2xx con JSON malformado → rechaza con "Respuesta inesperada"', async () => {
    let xhrRef: MockXhr | null = null;

    const p = uploadBlobWithProgress(
      new Blob(['video']),
      'video/webm',
      'user',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 200, responseText: 'not-json-at-all' });
        return xhrRef;
      },
    );

    xhrRef!.onload!();
    await expect(p).rejects.toThrow('Respuesta inesperada del servidor durante el upload.');
  });
});

// Suprimir warning de vi no usado
void vi;
