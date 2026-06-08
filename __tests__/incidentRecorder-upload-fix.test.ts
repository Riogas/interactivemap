/**
 * Tests para el fix de upload de videos grandes (signed URL + blob directo).
 *
 * Fix: antes de este fix, el contexto hacía POST /api/incidents con el blob
 * completo en multipart, que nginx cortaba con 413 para videos > ~10s.
 * Ahora el blob se sube directamente a Supabase Storage via signed URL (PUT)
 * y la API route solo recibe JSON de metadata.
 *
 * Estos tests cubren:
 * - uploadBlobWithProgress(): XHR con progreso real
 * - parseUploadUrlResponse(): parsing defensivo del upload-url endpoint
 */

import { describe, it, expect, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Replica de uploadBlobWithProgress() para testear en aislamiento
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
  // vi.fn tracking
  _openCalls: unknown[][];
  _setHeaderCalls: unknown[][];
  _sendCalls: unknown[][];
};

function makeMockXhr(overrides?: Partial<Pick<MockXhr, 'status' | 'responseText'>>): MockXhr {
  const openCalls: unknown[][] = [];
  const headerCalls: unknown[][] = [];
  const sendCalls: unknown[][] = [];

  const xhr: MockXhr = {
    open: (...args: unknown[]) => { openCalls.push(args); },
    setRequestHeader: (...args: unknown[]) => { headerCalls.push(args); },
    send: (...args: unknown[]) => { sendCalls.push(args); },
    status: overrides?.status ?? 200,
    responseText: overrides?.responseText ?? '',
    onload: null,
    onerror: null,
    ontimeout: null,
    upload: { onprogress: null },
    _openCalls: openCalls,
    _setHeaderCalls: headerCalls,
    _sendCalls: sendCalls,
  };
  return xhr;
}

/**
 * Versión testeable de uploadBlobWithProgress() — igual lógica que el contexto
 * pero acepta un factory de XHR para poder mockearlo en tests.
 */
function uploadBlobWithProgressTestable(
  signedUrl: string,
  blob: Blob,
  mimeType: string,
  onProgress: (pct: number) => void,
  xhrFactory: () => MockXhr,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
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
// Replica de parseUploadUrlResponse() para testear en aislamiento
// (misma lógica que el bloque de parsing en confirmUpload())
// ─────────────────────────────────────────────────────────────────────────────

async function parseUploadUrlResponse(
  res: { ok: boolean; status: number; text: () => Promise<string> }
): Promise<{ success: boolean; signedUrl?: string; path?: string; error?: string }> {
  const urlText = await res.text();
  if (!res.ok) {
    const errMsg =
      res.status === 502 || res.status === 504
        ? 'El servidor tardó demasiado. Reintentá en unos segundos.'
        : res.status >= 500
        ? 'Error del servidor. Reintentá en unos segundos.'
        : (() => {
            try {
              return (JSON.parse(urlText) as { error?: string }).error ?? 'Error preparando el upload.';
            } catch {
              return 'Error preparando el upload.';
            }
          })();
    return { success: false, error: errMsg };
  }
  try {
    return JSON.parse(urlText) as { success: boolean; signedUrl?: string; path?: string; error?: string };
  } catch {
    return { success: false, error: 'Respuesta inesperada del servidor. Reintentá.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: uploadBlobWithProgress()
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix: uploadBlobWithProgress() — XHR directo a Supabase Storage', () => {
  it('XHR exitoso (200) → resuelve y reporta progreso 100%', async () => {
    let xhrRef: MockXhr | null = null;
    const progressCalls: number[] = [];

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video-data']),
      'video/webm',
      (pct) => progressCalls.push(pct),
      () => {
        xhrRef = makeMockXhr({ status: 200 });
        return xhrRef;
      },
    );

    // Simular progreso parcial
    xhrRef!.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
    xhrRef!.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 });
    // Simular carga exitosa
    xhrRef!.status = 200;
    xhrRef!.onload!();

    await promise;

    expect(progressCalls).toContain(50);
    expect(progressCalls).toContain(100);
  });

  it('XHR con status 403 → rechaza con mensaje que incluye el status', async () => {
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video-data']),
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 403, responseText: 'Forbidden' });
        return xhrRef;
      },
    );

    xhrRef!.status = 403;
    xhrRef!.onload!();

    await expect(promise).rejects.toThrow('Upload falló con status 403');
  });

  it('XHR onerror → rechaza con mensaje "Error de red"', async () => {
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video-data']),
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 0 });
        return xhrRef;
      },
    );

    xhrRef!.onerror!();

    await expect(promise).rejects.toThrow('Error de red durante el upload del video.');
  });

  it('XHR ontimeout → rechaza con mensaje "Timeout"', async () => {
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video-data']),
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 0 });
        return xhrRef;
      },
    );

    xhrRef!.ontimeout!();

    await expect(promise).rejects.toThrow('Timeout durante el upload del video.');
  });

  it('XHR llama open() con PUT y la URL correcta', async () => {
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['test']),
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 200 });
        return xhrRef;
      },
    );

    expect(xhrRef!._openCalls[0]).toEqual(['PUT', 'https://storage.supabase.co/signed-url']);
    expect(xhrRef!._setHeaderCalls[0]).toEqual(['Content-Type', 'video/webm']);

    xhrRef!.onload!();
    await promise;
  });

  it('XHR llama send() con el blob correcto', async () => {
    const blob = new Blob(['test-video'], { type: 'video/webm' });
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      blob,
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 200 });
        return xhrRef;
      },
    );

    expect(xhrRef!._sendCalls[0][0]).toBe(blob);

    xhrRef!.onload!();
    await promise;
  });

  it('onprogress con lengthComputable=false → no llama onProgress (evita NaN%)', async () => {
    let xhrRef: MockXhr | null = null;
    const progressCalls: number[] = [];

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video-data']),
      'video/webm',
      (pct) => progressCalls.push(pct),
      () => {
        xhrRef = makeMockXhr({ status: 200 });
        return xhrRef;
      },
    );

    // Evento sin lengthComputable → no debe llamar onProgress
    xhrRef!.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 0 });
    xhrRef!.onload!();
    await promise;

    // Solo el 100 del onload exitoso — no el evento sin lengthComputable
    expect(progressCalls).toEqual([100]);
  });

  it('XHR status 201 (Created) → considera como éxito (rango 2xx)', async () => {
    let xhrRef: MockXhr | null = null;

    const promise = uploadBlobWithProgressTestable(
      'https://storage.supabase.co/signed-url',
      new Blob(['video']),
      'video/webm',
      () => {},
      () => {
        xhrRef = makeMockXhr({ status: 201 });
        return xhrRef;
      },
    );

    xhrRef!.status = 201;
    xhrRef!.onload!();

    // No debe rechazar — 201 es éxito
    await expect(promise).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: parseUploadUrlResponse() — parser defensivo del upload-url endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix: parseUploadUrlResponse() — parsing defensivo del endpoint upload-url', () => {
  it('200 con JSON válido → devuelve signedUrl y path correctamente', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        signedUrl: 'https://s3.supabase.co/signed',
        path: '2026/06/08/user-123.webm',
      }),
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(true);
    expect(result.signedUrl).toBe('https://s3.supabase.co/signed');
    expect(result.path).toBe('2026/06/08/user-123.webm');
    expect(result.error).toBeUndefined();
  });

  it('502 con HTML de nginx → success=false, mensaje legible (no SyntaxError)', async () => {
    const res = {
      ok: false,
      status: 502,
      text: async () => '<html><body>502 Bad Gateway</body></html>',
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('tardó demasiado');
    expect(result.signedUrl).toBeUndefined();
  });

  it('504 con HTML de nginx → success=false, mismo mensaje que 502', async () => {
    const res = {
      ok: false,
      status: 504,
      text: async () => '<!DOCTYPE html><html>504 Gateway Time-out</html>',
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('tardó demasiado');
  });

  it('500 con HTML de nginx → success=false, mensaje de servidor', async () => {
    const res = {
      ok: false,
      status: 500,
      text: async () => '<html>Internal Server Error</html>',
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error del servidor');
  });

  it('400 con JSON de error → extrae campo error del JSON', async () => {
    const res = {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ success: false, error: 'mime no soportado' }),
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toBe('mime no soportado');
  });

  it('400 con body HTML (no JSON) → mensaje genérico, sin SyntaxError', async () => {
    const res = {
      ok: false,
      status: 400,
      text: async () => '<html>Bad Request</html>',
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error preparando el upload.');
  });

  it('200 con body no-JSON → success=false, error de parseo (no SyntaxError crudo)', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => 'malformed response',
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Respuesta inesperada');
  });

  it('200 con success=false en el JSON → propaga el fallo correctamente', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false, error: 'quota excedida' }),
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toBe('quota excedida');
  });

  it('200 con JSON sin signedUrl → success=true, signedUrl undefined (caller valida)', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    };

    const result = await parseUploadUrlResponse(res);

    expect(result.success).toBe(true);
    expect(result.signedUrl).toBeUndefined();
    expect(result.path).toBeUndefined();
  });
});

// Suprimir warning de vi no usado
void vi;
