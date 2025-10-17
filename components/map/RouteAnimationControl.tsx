'use client';

import { motion } from 'framer-motion';

interface RouteAnimationControlProps {
  isPlaying: boolean;
  progress: number; // 0-100
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  startTime?: string;
  endTime?: string;
  onTimeRangeChange?: (startTime: string, endTime: string) => void;
}

const SPEED_OPTIONS = [
  { value: 0.1, label: '0.1x' },
  { value: 0.25, label: '0.25x' },
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 5, label: '5x' },
  { value: 10, label: '10x' },
];

export default function RouteAnimationControl({
  isPlaying,
  progress,
  speed,
  onPlayPause,
  onReset,
  onSpeedChange,
  startTime = '00:00',
  endTime = '23:59',
  onTimeRangeChange,
}: RouteAnimationControlProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000]"
    >
      <div className="bg-white rounded-2xl shadow-2xl p-4 min-w-[600px] border-2 border-blue-500">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎬</span>
            <h3 className="font-bold text-gray-800">Animación del Recorrido</h3>
          </div>
          <div className="text-xs text-gray-600 font-semibold">
            {progress.toFixed(1)}% completado
          </div>
        </div>

        {/* Time Range Selector */}
        {onTimeRangeChange && (
          <div className="mb-3 pb-3 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <label className="text-xs text-gray-600 font-medium whitespace-nowrap">
                  🕐 Desde:
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => onTimeRangeChange(e.target.value, endTime)}
                  className="flex-1 px-3 py-1.5 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm font-medium transition-colors"
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <label className="text-xs text-gray-600 font-medium whitespace-nowrap">
                  🕐 Hasta:
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => onTimeRangeChange(startTime, e.target.value)}
                  className="flex-1 px-3 py-1.5 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm font-medium transition-colors"
                />
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600"
              style={{ 
                width: `${progress}%`,
              }}
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3">
          {/* Play/Pause Button */}
          <button
            onClick={onPlayPause}
            className="flex items-center justify-center w-12 h-12 bg-blue-600 hover:bg-blue-700 rounded-full transition-all hover:scale-110 active:scale-95 shadow-lg"
          >
            {isPlaying ? (
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Reset Button */}
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium"
            title="Reiniciar desde el inicio"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reiniciar
          </button>

          {/* Speed Controls */}
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-600 font-medium">Velocidad:</span>
            <div className="flex gap-1">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onSpeedChange(option.value)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    speed === option.value
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 text-center">
          💡 {onTimeRangeChange 
            ? 'Selecciona el rango horario para filtrar el recorrido animado' 
            : 'La animación muestra el recorrido del vehículo desde el inicio del día'}
        </div>
      </div>
    </motion.div>
  );
}
