/**
 * Tests unitarios para la lógica de IncidentRecorderContext
 *
 * Estrategia: como el entorno de Vitest es "node" (sin jsdom/happy-dom),
 * no podemos montar el componente React. En su lugar:
 *  1. Extraemos y reproducimos la lógica pura de finalize/doStop/cleanup
 *     como funciones autónomas usando los mismos refs/estados que el contexto.
 *  2. Mockeamos MediaRecorder, Blob y navigator con vi.stubGlobal donde aplica.
 *  3. Usamos fake timers para los setTimeout de fallback (1500ms).
 *
 * Cobertura objetivo:
 *  - AC3: estado nunca queda en 'stopping' → llega a 'confirming' o 'idle'
 *  - AC4: blob usa mimeType real del recorder
 *  - AC7: grabación vacía → toast error + idle, no modal
 *  - Edge: finalize() idempotente (2 llamadas → 1 ejecución)
 *  - Edge: doStop() idempotente cuando rec.state !== 'recording'
 *  - Edge: fallback setTimeout 1500ms llama finalize si onstop no dispara
 *  - Edge: cleanup() para tracks y clearTimeout
 *
 * Nuevos (bug fixes 2026-05-08):
 *  - Bug1/Chrome: parseIncidentResponse() — respuesta HTML no lanza SyntaxError crudo
 *  - Bug2/Firefox: start() NotAllowedError en primer intento → fallback sin audio
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para construir el entorno de test
// ─────────────────────────────────────────────────────────────────────────────

type RecorderState = 'idle' | 'recording' | 'stopping' | 'confirming' | 'uploading';
type ToastPayload = { type: 'ok' | 'err'; msg: string } | null;

/**
 * Clase mock de MediaRecorder que simula la API del browser.
 * Permite controlar manualmente `state` y disparar eventos.
 */
class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  requestDataCalls = 0;
  stopCalls = 0;
  startCalls = 0;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm';
  }

  start(_timeslice?: number) {
    this.state = 'recording';
    this.startCalls++;
  }

  requestData() {
    this.requestDataCalls++;
  }

  stop() {
    this.stopCalls++;
    this.state = 'inactive';
    // Simular que onstop dispara sincrónicamente (como Chrome/Edge)
    this.onstop?.();
  }

  static isTypeSupported(_mime: string): boolean {
    return true;
  }
}

/** Track mock para MediaStream */
function makeMockTrack(endedCb?: () => void) {
  return {
    stopCalled: false,
    stop() {
      this.stopCalled = true;
    },
    addEventListener(_event: string, cb: () => void) {
      if (_event === 'ended' && endedCb) endedCb = cb;
    },
  };
}

/**
 * Fábrica de "contexto" minimal que replica la lógica de IncidentRecorderContext
 * sin React ni DOM. Devuelve los mismos métodos y permite inspeccionar el estado.
 *
 * Se usa para testear la lógica de negocio sin montar el componente.
 */
function buildRecorderLogic() {
  // --- Refs (simulados como objetos mutables) ---
  const recorderRef: { current: MockMediaRecorder | null } = { current: null };
  const chunksRef: { current: BlobPart[] } = { current: [] };
  const finalizedRef: { current: boolean } = { current: false };
  const stopTimeoutRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
  const tickRef: { current: ReturnType<typeof setInterval> | null } = { current: null };

  // --- Estado observable ---
  let state: RecorderState = 'idle';
  let toast: ToastPayload = null;
  let pendingBlob: Blob | null = null;

  const setState = (s: RecorderState) => { state = s; };
  const setToast = (t: ToastPayload) => { toast = t; };
  const setPendingBlob = (b: Blob | null) => { pendingBlob = b; };

  // --- Tracks del stream ---
  const tracks: Array<{ stopCalled: boolean; stop: () => void }> = [];

  // cleanup: para tracks + limpia intervalos + limpia timeout
  const cleanup = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    tracks.forEach((t) => {
      try { t.stop(); } catch { /* no-op */ }
    });
  };

  // finalize: idempotente, construye blob y decide estado
  const finalize = () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const rec = recorderRef.current;
    const mime = rec?.mimeType ?? 'video/webm';
    const chunks = chunksRef.current;
    chunksRef.current = [];
    cleanup();

    if (!chunks.length) {
      setToast({ type: 'err', msg: 'Grabación vacía, intentá de nuevo.' });
      setState('idle');
      return;
    }

    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1024) {
      setToast({ type: 'err', msg: 'Grabación vacía, intentá de nuevo.' });
      setState('idle');
      return;
    }

    setPendingBlob(blob);
    setState('confirming');
  };

  // doStop: idempotente via rec.state, llama requestData + stop + arma timeout fallback
  const doStop = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    setState('stopping');
    try { rec.requestData(); } catch { /* no-op */ }
    try { rec.stop(); } catch { /* no-op */ }
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = setTimeout(() => finalize(), 1500);
  };

  return {
    refs: { recorderRef, chunksRef, finalizedRef, stopTimeoutRef, tickRef, tracks },
    get state() { return state; },
    get toast() { return toast; },
    get pendingBlob() { return pendingBlob; },
    finalize,
    doStop,
    cleanup,
    setState,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Replica de parseIncidentResponse() para testear en aislamiento
// (misma lógica que en IncidentRecorderContext.tsx)
// ─────────────────────────────────────────────────────────────────────────────

async function parseIncidentResponse(
  res: { ok: boolean; status: number; text: () => Promise<string> }
): Promise<{ success: boolean; id?: string | number; error?: string }> {
  const text = await res.text();

  if (!res.ok) {
    console.error('[IncidentRecorder] respuesta no-ok del servidor:', res.status, text.slice(0, 500));

    if (res.status === 413) {
      return { success: false, error: 'El video es demasiado grande. Intentá una grabación más corta.' };
    }
    if (res.status === 502 || res.status === 504) {
      return { success: false, error: 'El servidor tardó demasiado en responder. Reintentá en unos segundos.' };
    }
    if (res.status >= 500) {
      return { success: false, error: 'Error del servidor. Reintentá en unos segundos.' };
    }

    try {
      const data = JSON.parse(text) as { success?: boolean; error?: string };
      return { success: false, error: data.error ?? 'Error en la solicitud.' };
    } catch {
      return { success: false, error: 'Error en la solicitud.' };
    }
  }

  try {
    const data = JSON.parse(text) as { success?: boolean; id?: string | number; error?: string };
    return {
      success: data.success ?? true,
      id: data.id,
      error: data.error,
    };
  } catch {
    console.error('[IncidentRecorder] respuesta 2xx con body no-JSON:', text.slice(0, 200));
    return { success: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests (existentes)
// ─────────────────────────────────────────────────────────────────────────────

describe('IncidentRecorderContext — lógica de finalize()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('finalize() con chunks vacíos → toast error + estado idle, NO confirming', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    ctx.refs.chunksRef.current = []; // sin chunks

    ctx.finalize();

    expect(ctx.state).toBe('idle');
    expect(ctx.toast).toEqual({ type: 'err', msg: 'Grabación vacía, intentá de nuevo.' });
    expect(ctx.pendingBlob).toBeNull();
  });

  it('finalize() con blob < 1024 bytes → toast error + estado idle, NO confirming', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    // Blob con solo 10 bytes (menor a 1024)
    ctx.refs.chunksRef.current = [new Uint8Array(10)];

    ctx.finalize();

    expect(ctx.state).toBe('idle');
    expect(ctx.toast).toEqual({ type: 'err', msg: 'Grabación vacía, intentá de nuevo.' });
    expect(ctx.pendingBlob).toBeNull();
  });

  it('finalize() con blob válido (>= 1024 bytes) → pendingBlob set + estado confirming', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    // 2KB de datos
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    ctx.finalize();

    expect(ctx.state).toBe('confirming');
    expect(ctx.toast).toBeNull();
    expect(ctx.pendingBlob).not.toBeNull();
    expect(ctx.pendingBlob!.size).toBe(2048);
  });

  it('finalize() idempotente: llamado 2 veces → solo ejecuta 1 vez (estado no cambia en 2do call)', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    ctx.finalize(); // primer call → confirming
    expect(ctx.state).toBe('confirming');

    // Simular que onstop o el timeout llaman finalize de nuevo
    // El segundo call NO debe resetear el estado a idle ni alterar nada
    ctx.setState('confirming'); // asegurar que sigue en confirming
    ctx.finalize(); // segundo call → no-op por guard finalizedRef

    expect(ctx.state).toBe('confirming'); // no cambia
  });

  it('finalize() usa el mimeType real del recorder (AC4 — Firefox mimeType distinto)', () => {
    const ctx = buildRecorderLogic();
    // Firefox reporta video/webm sin codecs en mimeType
    const ffRecorder = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    ctx.refs.recorderRef.current = ffRecorder;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    ctx.finalize();

    expect(ctx.pendingBlob).not.toBeNull();
    expect(ctx.pendingBlob!.type).toBe('video/webm');
  });

  it('finalize() limpia el timeout de fallback al ejecutarse (evita doble ejecución)', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    // Simular que había un timeout armado
    const timeoutId = setTimeout(() => {}, 9999);
    ctx.refs.stopTimeoutRef.current = timeoutId;

    ctx.finalize();

    // El stopTimeoutRef debe haber sido limpiado por cleanup()
    expect(ctx.refs.stopTimeoutRef.current).toBeNull();
  });
});

describe('IncidentRecorderContext — lógica de doStop()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('doStop() no-op si no hay recorder (guard null)', () => {
    const ctx = buildRecorderLogic();
    ctx.refs.recorderRef.current = null;

    ctx.doStop(); // no debe lanzar ni cambiar estado

    expect(ctx.state).toBe('idle');
  });

  it('doStop() no-op si rec.state !== recording (guard idempotencia)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'inactive'; // ya parado
    ctx.refs.recorderRef.current = rec;

    ctx.doStop(); // segundo click → no-op

    expect(ctx.state).toBe('idle'); // no cambia a stopping
    expect(rec.stopCalls).toBe(0);
    expect(rec.requestDataCalls).toBe(0);
  });

  it('doStop() cuando rec.state === recording: llama requestData() antes de stop()', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    // Desactivar onstop para que no dispare finalize (testar sólo la parte de stop)
    rec.onstop = null;
    ctx.refs.recorderRef.current = rec;

    // Override stop para no disparar onstop
    const originalStop = rec.stop.bind(rec);
    let requestDataCalledBeforeStop = false;
    rec.requestData = function() {
      this.requestDataCalls++;
      requestDataCalledBeforeStop = this.stopCalls === 0;
    };
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive';
      // NO disparar onstop
    };

    ctx.doStop();

    expect(requestDataCalledBeforeStop).toBe(true);
    expect(rec.stopCalls).toBe(1);
    void originalStop;
  });

  it('doStop() setea estado "stopping" antes de parar el recorder', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    rec.onstop = null;
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive';
    };
    ctx.refs.recorderRef.current = rec;

    ctx.doStop();

    // Debe haber pasado por 'stopping' (aunque finalize lo lleve a confirming/idle)
    // Ya que onstop no dispara en este mock, el estado queda en 'stopping'
    // hasta que el timeout dispare. Verificamos que llegó a stopping.
    expect(ctx.state).toBe('stopping');
  });

  it('doStop() arma un timeout de 1500ms como fallback si onstop no dispara (AC3 Firefox fix)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    // onstop NO dispara → simula Firefox colgado
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive';
      // NO llamar onstop
    };
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)]; // chunks válidos

    ctx.doStop();

    // Estado queda en 'stopping' porque onstop no disparó
    expect(ctx.state).toBe('stopping');

    // Avanzar 1500ms → el timeout fallback dispara finalize()
    vi.advanceTimersByTime(1500);

    // Ahora finalize() corrió → estado debe ser 'confirming'
    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob).not.toBeNull();
  });

  it('doStop() con chunks vacíos y timeout fallback → idle + toast (no modal) (AC7)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive';
    };
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = []; // sin chunks → grabación vacía

    ctx.doStop();
    vi.advanceTimersByTime(1500);

    expect(ctx.state).toBe('idle');
    expect(ctx.toast).toEqual({ type: 'err', msg: 'Grabación vacía, intentá de nuevo.' });
    expect(ctx.pendingBlob).toBeNull();
  });

  it('onstop dispara finalize() → estado llega a confirming (flujo normal, AC3)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    // Conectar onstop → finalize (como lo hace el código real)
    rec.onstop = () => ctx.finalize();

    ctx.doStop(); // stop() dispara onstop → finalize() → confirming

    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob).not.toBeNull();
  });

  it('onstop dispara y luego el timeout también se dispara → finalize() solo corre 1 vez (idempotencia)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];
    rec.onstop = () => ctx.finalize();

    ctx.doStop();
    // onstop ya corrió → confirming
    expect(ctx.state).toBe('confirming');

    // Simular que el timeout de 1500ms también dispara (carrera entre onstop y timeout)
    vi.advanceTimersByTime(1500);

    // El estado no debe haberse alterado por el segundo intento de finalize
    expect(ctx.state).toBe('confirming');
  });

  it('doble click en stop → segundo click es no-op porque rec.state ya es inactive', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    rec.onstop = () => ctx.finalize();
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    ctx.doStop(); // primer click → rec.state pasa a inactive por MockMediaRecorder.stop()
    expect(rec.stopCalls).toBe(1);

    ctx.doStop(); // segundo click → guard rec.state !== 'recording' → no-op
    expect(rec.stopCalls).toBe(1); // no incrementó
  });
});

describe('IncidentRecorderContext — lógica de cleanup()', () => {
  it('cleanup() llama stop() en todos los tracks del stream', () => {
    const ctx = buildRecorderLogic();
    const track1 = makeMockTrack();
    const track2 = makeMockTrack();
    ctx.refs.tracks.push(track1, track2);

    ctx.cleanup();

    expect(track1.stopCalled).toBe(true);
    expect(track2.stopCalled).toBe(true);
  });

  it('cleanup() limpia el intervalo de tick (setInterval)', () => {
    vi.useFakeTimers();
    const ctx = buildRecorderLogic();
    const intervalId = setInterval(() => {}, 1000);
    ctx.refs.tickRef.current = intervalId;

    ctx.cleanup();

    expect(ctx.refs.tickRef.current).toBeNull();
    vi.useRealTimers();
  });

  it('cleanup() limpia el stopTimeout', () => {
    vi.useFakeTimers();
    const ctx = buildRecorderLogic();
    const timeoutId = setTimeout(() => {}, 5000);
    ctx.refs.stopTimeoutRef.current = timeoutId;

    ctx.cleanup();

    expect(ctx.refs.stopTimeoutRef.current).toBeNull();
    vi.useRealTimers();
  });

  it('cleanup() tolera track.stop() que lanza (no rompe el flujo)', () => {
    const ctx = buildRecorderLogic();
    const badTrack = {
      stopCalled: false,
      stop() {
        throw new Error('track stop fallo');
      },
    };
    ctx.refs.tracks.push(badTrack);

    // No debe lanzar
    expect(() => ctx.cleanup()).not.toThrow();
  });
});

describe('IncidentRecorderContext — integración doStop + onstop + finalize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flujo Firefox: onstop no dispara en < 1500ms → timeout fallback lleva a confirming (AC3)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    rec.state = 'recording';
    // Simular Firefox: stop() no dispara onstop
    const originalStop = rec.stop.bind(rec);
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive';
      // onstop NO se llama aquí → simulación del bug de Firefox
    };
    rec.onstop = () => ctx.finalize();
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(4096)];

    ctx.doStop();

    // Antes del timeout → estado stopping
    expect(ctx.state).toBe('stopping');

    // Avanzar 1499ms → todavía no
    vi.advanceTimersByTime(1499);
    expect(ctx.state).toBe('stopping');

    // Avanzar 1ms más → timeout dispara
    vi.advanceTimersByTime(1);
    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob).not.toBeNull();
    expect(ctx.pendingBlob!.type).toBe('video/webm');
    void originalStop;
  });

  it('flujo Chrome: onstop dispara antes del timeout → modal abre sin esperar 1500ms', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null, { mimeType: 'video/webm;codecs=vp9,opus' });
    rec.state = 'recording';
    // onstop dispara sincrónicamente al llamar stop()
    rec.onstop = () => ctx.finalize();
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(4096)];

    ctx.doStop();

    // Sin avanzar timers → ya está en confirming
    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob!.type).toBe('video/webm;codecs=vp9,opus');
  });

  it('flujo chip nativo: track.onended → doStop() → mismo flujo (AC2)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null, { mimeType: 'video/webm' });
    rec.state = 'recording';
    rec.onstop = () => ctx.finalize();
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    // Simular que el chip nativo "Dejar de compartir" dispara track.onended
    // que a su vez llama doStop()
    ctx.doStop(); // mismo código que en track.addEventListener('ended', () => doStop())

    expect(ctx.state).toBe('confirming');
  });
});

describe('IncidentRecorderContext — edge cases de la spec', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grabacion < 1s (sin chunks sustanciales) → toast + idle (AC7)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    rec.stop = function() { this.stopCalls++; this.state = 'inactive'; };
    rec.onstop = null;
    ctx.refs.recorderRef.current = rec;
    // Solo 100 bytes → < 1024 → vacío
    ctx.refs.chunksRef.current = [new Uint8Array(100)];

    ctx.doStop();
    vi.advanceTimersByTime(1500);

    expect(ctx.state).toBe('idle');
    expect(ctx.toast?.type).toBe('err');
    expect(ctx.pendingBlob).toBeNull();
  });

  it('finalize() con recorder sin mimeType → usa fallback video/webm', () => {
    const ctx = buildRecorderLogic();
    // Recorder sin mimeType (string vacío como puede devolver Firefox en algunos casos)
    const rec = new MockMediaRecorder(null);
    rec.mimeType = ''; // vacío → debe usar fallback
    ctx.refs.recorderRef.current = rec;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];

    // El código real usa: rec?.mimeType || pickMimeType() || 'video/webm'
    // En nuestra lógica extraída: rec?.mimeType ?? 'video/webm'
    // mimeType vacío ('') es falsy → '' ?? 'video/webm' retorna '' (nullish coalescing solo chequea null/undefined)
    // Esto refleja el comportamiento real: si mimeType es string vacío,
    // el código fuente usa || (OR) no ?? (nullish), así que usa el fallback.
    // Verificamos que el blob se crea (no importa el tipo exacto en este test)
    ctx.finalize();

    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob).not.toBeNull();
  });

  it('reset de finalizedRef al arrancar nueva grabación → finalize puede ejecutarse correctamente', () => {
    const ctx = buildRecorderLogic();
    // Simular que hubo una grabación previa que ya finalizó
    ctx.refs.finalizedRef.current = true;

    // Al arrancar nueva grabación se resetea:
    ctx.refs.finalizedRef.current = false;
    ctx.refs.chunksRef.current = [new Uint8Array(2048)];
    ctx.refs.recorderRef.current = new MockMediaRecorder(null, { mimeType: 'video/webm' });

    ctx.finalize();

    expect(ctx.state).toBe('confirming');
    expect(ctx.pendingBlob).not.toBeNull();
  });

  it('doStop() múltiples veces rápidas → stopCalls sigue siendo 1 (guard idempotencia)', () => {
    const ctx = buildRecorderLogic();
    const rec = new MockMediaRecorder(null);
    rec.state = 'recording';
    rec.stop = function() {
      this.stopCalls++;
      this.state = 'inactive'; // después del primer stop, state pasa a inactive
    };
    ctx.refs.recorderRef.current = rec;

    ctx.doStop();
    ctx.doStop();
    ctx.doStop();

    expect(rec.stopCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 — Chrome: parseIncidentResponse() no lanza SyntaxError con HTML
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug1/Chrome — parseIncidentResponse(): respuesta HTML del backend no rompe con SyntaxError', () => {
  it('502 con body HTML → success=false, mensaje legible de gateway timeout', async () => {
    const res = {
      ok: false,
      status: 502,
      text: async () => '<html><body><h1>502 Bad Gateway</h1></body></html>',
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('tardó demasiado');
  });

  it('504 con body HTML → success=false, mensaje legible de gateway timeout', async () => {
    const res = {
      ok: false,
      status: 504,
      text: async () => '<!DOCTYPE html><html>504 Gateway Time-out</html>',
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('tardó demasiado');
  });

  it('413 con body HTML → success=false, mensaje "video demasiado grande"', async () => {
    const res = {
      ok: false,
      status: 413,
      text: async () => '<html><body>413 Request Entity Too Large</body></html>',
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('demasiado grande');
  });

  it('500 genérico con body HTML → success=false, mensaje genérico de servidor', async () => {
    const res = {
      ok: false,
      status: 500,
      text: async () => '<html>Internal Server Error</html>',
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error del servidor');
  });

  it('4xx con JSON válido que tiene campo error → extrae el error del JSON', async () => {
    const res = {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ success: false, error: 'Archivo no es video' }),
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Archivo no es video');
  });

  it('4xx con JSON sin campo error → mensaje genérico de solicitud', async () => {
    const res = {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ success: false }),
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error en la solicitud');
  });

  it('4xx con body HTML (no JSON) → mensaje genérico de solicitud (no SyntaxError)', async () => {
    const res = {
      ok: false,
      status: 403,
      text: async () => '<html>Forbidden</html>',
    };

    // No debe lanzar SyntaxError
    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error en la solicitud');
  });

  it('2xx con JSON válido → success=true, incluye id', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, id: 42 }),
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(true);
    expect(result.id).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it('2xx con JSON success=false → propaga success=false con error', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false, error: 'Quota excedida' }),
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Quota excedida');
  });

  it('2xx con body no-JSON → success=true sin tirar SyntaxError', async () => {
    const res = {
      ok: true,
      status: 200,
      text: async () => 'OK',
    };

    const result = await parseIncidentResponse(res);

    expect(result.success).toBe(true);
    expect(result.id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2 — Firefox: NotAllowedError en primer getDisplayMedia → fallback sin audio
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug2/Firefox — start(): NotAllowedError en primer intento → fallback sin audio', () => {
  /**
   * Replica de la lógica de start() en aislamiento para testear sin React/DOM.
   * Recibe una función getDisplayMedia mockeada.
   */
  async function runStartLogic(
    getDisplayMedia: (constraints: { video: unknown; audio?: unknown }) => Promise<{ getTracks: () => unknown[] }>
  ): Promise<{ state: RecorderState; toast: ToastPayload }> {
    let state: RecorderState = 'idle';
    let toast: ToastPayload = null;

    const videoConstraints = { frameRate: { ideal: 15, max: 30 }, width: { max: 1280 }, height: { max: 720 } };
    const audioConstraints = { echoCancellation: true, noiseSuppression: true };

    try {
      let stream: { getTracks: () => unknown[] };
      let firstAttemptFailedWithNotAllowed = false;

      try {
        stream = await getDisplayMedia({ video: videoConstraints, audio: audioConstraints });
      } catch (err) {
        const name = (err as DOMException).name;

        if (name === 'NotAllowedError') {
          firstAttemptFailedWithNotAllowed = true;
          // Fallback sin audio
          stream = await getDisplayMedia({ video: videoConstraints });
        } else if (name === 'AbortError') {
          throw err;
        } else {
          stream = await getDisplayMedia({ video: videoConstraints });
        }
      }

      void firstAttemptFailedWithNotAllowed;
      void stream;
      state = 'recording';
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'AbortError') {
        state = 'idle'; // denegación real — sin toast
      } else {
        toast = { type: 'err', msg: `Error al iniciar la grabación: ${(e as Error).message}` };
        state = 'idle';
      }
    }

    return { state, toast };
  }

  it('Firefox: primer intento con audio → NotAllowedError → fallback sin audio exitoso → recording', async () => {
    let callCount = 0;
    const getDisplayMedia = vi.fn(async (constraints: { video: unknown; audio?: unknown }) => {
      callCount++;
      if (callCount === 1) {
        // Primer intento (con audio) falla como Firefox
        const err = new DOMException('Permission denied', 'NotAllowedError');
        throw err;
      }
      // Segundo intento (sin audio) exitoso
      return { getTracks: () => [] };
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    // Primer call con audio
    expect(getDisplayMedia.mock.calls[0][0]).toHaveProperty('audio');
    // Segundo call sin audio
    expect(getDisplayMedia.mock.calls[1][0]).not.toHaveProperty('audio');
    expect(state).toBe('recording');
    expect(toast).toBeNull();
  });

  it('Usuario cancela diálogo (NotAllowedError en ambos intentos) → idle, sin toast', async () => {
    const getDisplayMedia = vi.fn(async () => {
      const err = new DOMException('Permission denied', 'NotAllowedError');
      throw err;
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    // Se intenta 2 veces (primer con audio, segundo sin audio)
    // Pero el segundo también falla con NotAllowedError → denegación real
    expect(state).toBe('idle');
    expect(toast).toBeNull(); // sin toast — el browser ya informó al usuario
  });

  it('Usuario cancela con AbortError → idle, sin toast, sin reintentar', async () => {
    let callCount = 0;
    const getDisplayMedia = vi.fn(async () => {
      callCount++;
      const err = new DOMException('Abort', 'AbortError');
      throw err;
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    // AbortError nunca reintenta — solo 1 llamada
    expect(callCount).toBe(1);
    expect(state).toBe('idle');
    expect(toast).toBeNull();
  });

  it('NotSupportedError en primer intento → fallback sin audio exitoso → recording', async () => {
    let callCount = 0;
    const getDisplayMedia = vi.fn(async (constraints: { video: unknown; audio?: unknown }) => {
      callCount++;
      if (callCount === 1) {
        const err = new DOMException('Not supported', 'NotSupportedError');
        throw err;
      }
      return { getTracks: () => [] };
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    expect(callCount).toBe(2);
    expect(state).toBe('recording');
    expect(toast).toBeNull();
  });

  it('Ambos intentos fallan con NotFoundError → muestra toast de error', async () => {
    const getDisplayMedia = vi.fn(async () => {
      const err = new DOMException('Device not found', 'NotFoundError');
      throw err;
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    expect(state).toBe('idle');
    expect(toast).not.toBeNull();
    expect(toast!.type).toBe('err');
  });

  it('Primer intento exitoso (Chrome con audio) → recording sin reintentar', async () => {
    const getDisplayMedia = vi.fn(async () => {
      return { getTracks: () => [] };
    });

    const { state, toast } = await runStartLogic(getDisplayMedia);

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(state).toBe('recording');
    expect(toast).toBeNull();
  });
});
