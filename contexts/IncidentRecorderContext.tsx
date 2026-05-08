'use client';

/**
 * IncidentRecorderProvider
 *
 * Provee estado global del grabador de incidencias (pantalla) + renderiza
 * los modales de confirmación / uploading y los toasts.
 * El botón visual vive en el navbar (components/IncidentRecorderButton.tsx)
 * y consume este contexto vía useIncidentRecorder().
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type RecorderState = 'idle' | 'recording' | 'stopping' | 'confirming' | 'uploading';

interface RecorderContextValue {
  state: RecorderState;
  seconds: number;
  start: () => Promise<void>;
  stop: () => void;
  available: boolean;
}

const RecorderContext = createContext<RecorderContextValue | undefined>(undefined);

const PREFERRED_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parsea defensivamente la respuesta del endpoint de incidencias.
 *
 * Problema: si nginx upstream devuelve HTML (502/504/413 con body HTML),
 * llamar `res.json()` directamente lanza SyntaxError que el catch muestra
 * crudo al usuario como "Unexpected token '<'".
 *
 * Solución: leer como texto, intentar parsear JSON, y si falla o el status
 * no es 2xx, devolver un error legible según el código HTTP.
 */
async function parseIncidentResponse(res: Response): Promise<{ success: boolean; id?: string | number; error?: string }> {
  const text = await res.text();

  if (!res.ok) {
    // Loggear el body original para debug
    console.error('[IncidentRecorder] respuesta no-ok del servidor:', res.status, text.slice(0, 500));

    // Mensajes específicos por código HTTP
    if (res.status === 413) {
      return { success: false, error: 'El video es demasiado grande. Intentá una grabación más corta.' };
    }
    if (res.status === 502 || res.status === 504) {
      return { success: false, error: 'El servidor tardó demasiado en responder. Reintentá en unos segundos.' };
    }
    if (res.status >= 500) {
      return { success: false, error: 'Error del servidor. Reintentá en unos segundos.' };
    }

    // 4xx: intentar extraer el campo `error` del JSON si está disponible
    try {
      const data = JSON.parse(text) as { success?: boolean; error?: string };
      return { success: false, error: data.error ?? 'Error en la solicitud.' };
    } catch {
      return { success: false, error: 'Error en la solicitud.' };
    }
  }

  // Status 2xx: parsear JSON normalmente
  try {
    const data = JSON.parse(text) as { success?: boolean; id?: string | number; error?: string };
    return {
      success: data.success ?? true,
      id: data.id,
      error: data.error,
    };
  } catch {
    // 2xx pero body no es JSON: tratar como éxito sin ID
    console.error('[IncidentRecorder] respuesta 2xx con body no-JSON:', text.slice(0, 200));
    return { success: true };
  }
}

export function IncidentRecorderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [description, setDescription] = useState('');
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingDurationS, setPendingDurationS] = useState(0);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizedRef = useRef<boolean>(false);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const available =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== 'undefined';

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // no-op
        }
      });
      streamRef.current = null;
    }
  }, []);

  const finalize = useCallback(
    () => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      const rec = recorderRef.current;
      const mime = rec?.mimeType || pickMimeType() || 'video/webm';
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
    },
    [cleanup],
  );

  useEffect(() => {
    return () => {
      cleanup();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // no-op
        }
      }
    };
  }, [cleanup]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const doStop = useCallback(() => {
    // Idempotente: chequeamos el estado síncrono del MediaRecorder
    // (no el de React) para evitar doble stop en clicks repetidos.
    // Tanto el click del botón como el track.onended (chip nativo
    // "Dejar de compartir") convergen acá.
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    setState('stopping');
    // En Firefox, llamar a `requestData()` antes de `stop()` produce un
    // dataavailable extra cuyo timing pelea con el flush natural del stop —
    // resultado: chunks puede quedar vacío. Confiamos en el flush de stop()
    // (con timeslice corto en start() ya tenemos múltiples chunks bufferados).
    try {
      rec.stop();
    } catch {
      // no-op
    }
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    // Fallback para navegadores que no disparan onstop:
    // 3s es holgado para que Firefox emita el último dataavailable + onstop
    // antes de que finalicemos con lo bufferado.
    stopTimeoutRef.current = setTimeout(() => finalize(), 3000);
  }, [finalize]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    if (!available) {
      setToast({ type: 'err', msg: 'Tu navegador no soporta grabación de pantalla.' });
      return;
    }

    // Verificar contexto seguro: la API de captura de pantalla requiere HTTPS.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setToast({ type: 'err', msg: 'La grabación de pantalla requiere una conexión segura (HTTPS).' });
      return;
    }

    try {
      const videoConstraints: MediaTrackConstraints = {
        frameRate: { ideal: 15, max: 30 },
        // Cap a 720p: reduce tamaño ~4x vs 1080p con pérdida visual
        // mínima para debug de UI.
        width: { max: 1280 },
        height: { max: 720 },
      };
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
      };

      let stream: MediaStream;

      // Bug Firefox: getDisplayMedia con constraints de audio lanza NotAllowedError
      // incluso cuando el usuario NO canceló — Firefox en muchos contextos
      // (Windows/Linux) no soporta captura de audio de display y reporta el mismo
      // error que cuando el usuario deniega el permiso.
      //
      // Solución: intentar primero con audio; si falla con NotAllowedError,
      // reintentar SIN audio antes de concluir que el usuario canceló.
      // Solo si el segundo intento también falla con NotAllowedError o AbortError
      // se trata como denegación real del usuario (no mostrar toast).
      let firstAttemptFailedWithNotAllowed = false;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: audioConstraints,
        });
      } catch (err) {
        const name = (err as DOMException).name;

        if (name === 'NotAllowedError') {
          // Puede ser denegación real del usuario O incompatibilidad del navegador
          // con audio de display. Reintentar sin audio para diferenciar.
          firstAttemptFailedWithNotAllowed = true;
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
          });
          // Si llegamos acá: el primer fallo fue por audio no soportado, no por
          // denegación real. La grabación arranca sin audio.
        } else if (name === 'AbortError') {
          // AbortError siempre es cancelación real del usuario → no reintentar.
          throw err;
        } else {
          // Otro error (NotFoundError, NotSupportedError, etc.) → reintentar sin audio.
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
          });
        }
      }

      // Silenciar advertencia de variable no usada en el path sin audio
      void firstAttemptFailedWithNotAllowed;

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        doStop();
      });

      streamRef.current = stream;
      chunksRef.current = [];
      finalizedRef.current = false;

      const mimeType = pickMimeType();
      // Bitrate agresivo para minimizar el tamaño del video.
      // 500 kbps de video + 64 kbps de audio ≈ 4 MB/min.
      // A 10 min ≈ 40 MB, a 1 min ≈ 4 MB. Ajustable si se ve degradación.
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 500_000,
        audioBitsPerSecond: 64_000,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Firefox fires `onstop` BEFORE flushing the final `dataavailable` event
      // in some cases, leaving `chunksRef` empty when finalize() runs.
      // Diferir la finalización 300ms da tiempo al último dataavailable.
      // En Chrome, la diferencia es invisible (los chunks ya están bufferados
      // por el timeslice de 250ms del start()).
      recorder.onstop = () => {
        setTimeout(() => finalize(), 300);
      };

      recorder.onerror = () => {
        doStop();
      };

      // Timeslice corto = chunks más frecuentes en chunksRef. Asegura que
      // incluso grabaciones cortas (< 1s) tengan al menos un chunk antes de
      // stop, evitando "Grabación vacía" en Firefox cuando el flush final
      // del stop() no se completa a tiempo.
      recorder.start(250);
      setSeconds(0);
      setState('recording');
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          setPendingDurationS(next);
          return next;
        });
      }, 1000);
    } catch (e) {
      const name = (e as DOMException).name;
      // NotAllowedError o AbortError en ambos intentos = denegación real del usuario.
      // No mostrar toast (el navegador ya mostró su propio mensaje de denegación).
      if (name === 'NotAllowedError' || name === 'AbortError') {
        setState('idle');
        return;
      }
      // Otros errores: mostrar mensaje al usuario.
      setToast({ type: 'err', msg: `Error al iniciar la grabación: ${(e as Error).message}` });
      setState('idle');
    }
  }, [state, available, doStop, finalize]);

  const stop = useCallback(() => {
    doStop();
  }, [doStop]);

  const confirmUpload = async () => {
    if (!pendingBlob) return;
    setState('uploading');
    try {
      const form = new FormData();
      form.append('video', pendingBlob, 'incident.webm');
      if (description.trim()) form.append('description', description.trim());
      form.append('duration_s', String(pendingDurationS));

      const res = await fetch('/api/incidents', {
        method: 'POST',
        body: form,
        headers: {
          'x-track-user': user?.username ?? '',
          'x-track-userid': user?.id ?? '',
        },
      });

      // Bug Chrome: res.json() lanza SyntaxError si nginx devuelve HTML (502/504/413).
      // parseIncidentResponse() lee como texto y parsea defensivamente.
      const data = await parseIncidentResponse(res);

      if (!data.success) {
        setToast({ type: 'err', msg: data.error ?? 'Error subiendo el video.' });
        setState('confirming');
        return;
      }
      setToast({ type: 'ok', msg: `Incidencia #${data.id} reportada. Gracias!` });
      setDescription('');
      setPendingBlob(null);
      setPendingDurationS(0);
      setState('idle');
    } catch (e) {
      setToast({ type: 'err', msg: (e as Error).message });
      setState('confirming');
    }
  };

  const discard = () => {
    setDescription('');
    setPendingBlob(null);
    setPendingDurationS(0);
    setState('idle');
  };

  return (
    <RecorderContext.Provider value={{ state, seconds, start, stop, available }}>
      {children}
      {/* Modales renderizados al final del body via portal implícito (el root layout ya garantiza z-index alto) */}
      {state === 'confirming' && pendingBlob && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800">Reportar incidencia</h2>
                <p className="text-xs text-slate-500">Grabación lista para enviar</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Duración</div>
                  <div className="text-lg font-bold text-slate-800 tabular-nums">{formatDuration(pendingDurationS)}</div>
                </div>
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Tamaño</div>
                  <div className="text-lg font-bold text-slate-800">{formatSize(pendingBlob.size)}</div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  ¿Qué sucedió? <span className="font-normal normal-case text-slate-400">(opcional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contanos brevemente qué pasó para ayudar a reproducir el problema…"
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                />
              </div>
              <div className="rounded-lg overflow-hidden bg-slate-900 aspect-video">
                <video src={URL.createObjectURL(pendingBlob)} controls className="w-full h-full" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <button
                onClick={discard}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-white rounded-lg transition"
              >
                Descartar
              </button>
              <button
                onClick={confirmUpload}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold px-5 py-2 rounded-lg shadow-lg shadow-blue-500/20 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Enviar incidencia
              </button>
            </div>
          </div>
        </div>
      )}

      {state === 'uploading' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 flex items-center gap-4">
            <svg className="animate-spin w-6 h-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <div>
              <div className="text-sm font-semibold text-slate-800">Subiendo incidencia…</div>
              <div className="text-xs text-slate-500">No cierres la pestaña</div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] max-w-sm rounded-xl shadow-2xl px-4 py-3 text-sm font-medium flex items-start gap-3 ${
            toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          {toast.type === 'ok' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <div className="flex-1">{toast.msg}</div>
          <button onClick={() => setToast(null)} className="shrink-0 opacity-80 hover:opacity-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </RecorderContext.Provider>
  );
}

export function useIncidentRecorder() {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error('useIncidentRecorder debe usarse dentro de IncidentRecorderProvider');
  return ctx;
}
