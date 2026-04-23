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

  const available =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    if (!available) {
      setToast({ type: 'err', msg: 'Tu navegador no soporta grabación de pantalla.' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          // Cap a 720p: reduce tamaño ~4x vs 1080p con pérdida visual
          // mínima para debug de UI.
          width: { max: 1280 },
          height: { max: 720 },
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      });

      streamRef.current = stream;
      chunksRef.current = [];

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

      recorder.onstop = () => {
        const mime = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setPendingDurationS((currentSecs) => {
          // Capturamos las seconds actuales; el setter es la forma segura de leer el último valor
          return currentSecs;
        });
        // Al momento de stop, ya teníamos el último seconds renderizado
        setPendingBlob(blob);
        setState('confirming');
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
      };

      recorder.start(1000);
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
      const msg = (e as Error).message.toLowerCase();
      if (msg.includes('permission') || msg.includes('denied')) {
        setState('idle');
      } else {
        setToast({ type: 'err', msg: `Error: ${(e as Error).message}` });
        setState('idle');
      }
    }
  }, [state, available]);

  const stop = useCallback(() => {
    if (state !== 'recording') return;
    setState('stopping');
    try {
      recorderRef.current?.stop();
    } catch {
      // no-op
    }
  }, [state]);

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
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: 'err', msg: data.error ?? 'Error subiendo el video' });
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
