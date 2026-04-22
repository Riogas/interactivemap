'use client';

/**
 * IncidentRecorderButton
 *
 * Botón compacto 40x40 con el mismo estilo que los otros botones de
 * acción rápida del dashboard (FAB group). Idle = rojo gradient con
 * círculo punto; recording = rojo pulsante con timer mm:ss al lado.
 */

import { useIncidentRecorder } from '@/contexts/IncidentRecorderContext';

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function IncidentRecorderButton({ id }: { id?: string }) {
  const { state, seconds, start, stop, available } = useIncidentRecorder();

  if (!available) return null;

  const isRecording = state === 'recording';
  const isBusy = state === 'stopping' || state === 'uploading' || state === 'confirming';

  return (
    <button
      id={id}
      onClick={isRecording ? stop : isBusy ? undefined : start}
      disabled={isBusy}
      title={
        isRecording ? 'Detener grabación'
        : isBusy ? 'Procesando…'
        : 'Reportar incidencia (grabar pantalla)'
      }
      className={`flex items-center justify-center shadow-2xl transition-all duration-300 transform hover:scale-110 text-white ${
        isRecording
          ? 'rounded-full gap-1.5 pl-3 pr-3 h-10 bg-gradient-to-br from-red-500 to-rose-600 animate-pulse'
          : 'rounded-full w-10 h-10 bg-gradient-to-br from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700'
      } ${isBusy ? 'opacity-60 cursor-wait' : ''}`}
    >
      {isRecording ? (
        <>
          <span className="w-2.5 h-2.5 bg-white rounded-sm shrink-0" />
          <span className="text-xs font-bold tabular-nums">{formatDuration(seconds)}</span>
        </>
      ) : isBusy ? (
        <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
