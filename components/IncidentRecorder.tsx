'use client';

/**
 * IncidentRecorder
 *
 * Botón flotante fijo en la esquina inferior derecha.
 * Flujo:
 *   1. idle → click → getDisplayMedia (popup del browser: elegir pantalla/ventana/tab)
 *   2. recording → click → stop → modal de confirmación con descripción opcional
 *   3. uploading → sube el Blob a /api/incidents como multipart
 *   4. done → toast de éxito + vuelve a idle
 *
 * El cursor se graba nativamente cuando el user elige "Pantalla completa".
 * Audio está activado por default (voz del usuario), se puede togglear.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type State = 'idle' | 'recording' | 'stopping' | 'uploading' | 'confirming';

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

export function IncidentRecorder() {
  const { user } = useAuth();
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const [description, setDescription] = useState('');
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingDurationS, setPendingDurationS] = useState(0);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup al desmontar
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

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function startRecording() {
    if (state !== 'idle') return;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setToast({ type: 'err', msg: 'Tu navegador no soporta grabación de pantalla.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Si el user cierra la share desde el popup del browser, lo detectamos
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const mime = recorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        // Detener tracks
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        // Capturar duración y pasar a confirmación
        setPendingDurationS(seconds);
        setPendingBlob(blob);
        setState('confirming');
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
      };

      recorder.start(1000); // chunks cada 1s
      setSeconds(0);
      setState('recording');
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        // User canceló el popup, no es error
        setState('idle');
      } else {
        setToast({ type: 'err', msg: `Error: ${msg}` });
        setState('idle');
      }
    }
  }

  function stopRecording() {
    if (state !== 'recording') return;
    setState('stopping');
    try {
      recorderRef.current?.stop();
    } catch {
      // no-op
    }
  }

  async function confirmUpload() {
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
  }

  function discardRecording() {
    setDescription('');
    setPendingBlob(null);
    setPendingDurationS(0);
    setState('idle');
  }

  // No mostrar si no hay usuario logueado
  if (!user) return null;

  return (
    <>
      {/* FAB */}
      <button
        onClick={state === 'idle' ? startRecording : state === 'recording' ? stopRecording : undefined}
        disabled={state === 'stopping' || state === 'uploading' || state === 'confirming'}
        title={
          state === 'idle' ? 'Reportar incidencia (graba pantalla)'
          : state === 'recording' ? 'Detener grabación'
          : 'Procesando…'
        }
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full shadow-2xl font-semibold text-sm transition-all duration-200 ${
          state === 'recording'
            ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white pl-3 pr-4 py-2.5 scale-105 animate-pulse-slow'
            : state === 'idle'
            ? 'bg-gradient-to-r from-slate-800 to-slate-900 text-white w-12 h-12 justify-center hover:w-auto hover:pl-3 hover:pr-4 hover:scale-105'
            : 'bg-slate-400 text-white w-12 h-12 justify-center cursor-not-allowed'
        }`}
      >
        {state === 'recording' ? (
          <>
            <span className="w-2.5 h-2.5 bg-white rounded-sm" />
            <span className="tabular-nums">{formatDuration(seconds)}</span>
            <span className="text-xs font-normal opacity-90">· Detener</span>
          </>
        ) : state === 'uploading' || state === 'stopping' ? (
          <svg className="animate-spin w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
            </svg>
            <span className="hidden group-hover:inline whitespace-nowrap">Reportar incidencia</span>
          </>
        )}
      </button>

      {/* Modal de confirmación */}
      {state === 'confirming' && pendingBlob && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
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

              {/* Preview */}
              <div className="rounded-lg overflow-hidden bg-slate-900 aspect-video">
                <video
                  src={URL.createObjectURL(pendingBlob)}
                  controls
                  className="w-full h-full"
                  onLoadedMetadata={(e) => {
                    // Opcional: revocar URL si se cierra
                    const target = e.currentTarget as HTMLVideoElement;
                    target.dataset.blob = 'loaded';
                  }}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <button
                onClick={discardRecording}
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

      {/* Estado uploading overlay */}
      {state === 'uploading' && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
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

      {/* Toasts */}
      {toast && (
        <div
          className={`fixed bottom-24 right-6 z-50 max-w-sm rounded-xl shadow-2xl px-4 py-3 text-sm font-medium flex items-start gap-3 ${
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
    </>
  );
}
