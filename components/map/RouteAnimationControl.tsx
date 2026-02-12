'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MovilData } from '@/types';

interface RouteAnimationControlProps {
  isPlaying: boolean;
  progress: number; // 0-100
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  onClose?: () => void; // Función para cerrar la animación
  startTime?: string;
  endTime?: string;
  onTimeRangeChange?: (startTime: string, endTime: string) => void;
  simplifiedPath?: boolean;
  onSimplifiedPathChange?: (value: boolean) => void;
  // Props para cambiar móvil y fecha
  allMoviles?: MovilData[];
  selectedMovilId?: number;
  secondaryMovilId?: number;
  onSecondaryMovilChange?: (movilId: number | undefined) => void;
  selectedDate?: string;
  onMovilDateChange?: (movilId: number, date: string) => void;
  currentAnimTimeStr?: string; // Hora actual de la animación (modo timeline unificado)
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
  onClose,
  startTime = '00:00',
  endTime = '23:59',
  onTimeRangeChange,
  simplifiedPath = true,
  onSimplifiedPathChange,
  allMoviles = [],
  selectedMovilId,
  secondaryMovilId,
  onSecondaryMovilChange,
  selectedDate = '',
  onMovilDateChange,
  currentAnimTimeStr = '',
}: RouteAnimationControlProps) {
  const [movilSearch, setMovilSearch] = useState('');
  const [isMovilDropdownOpen, setIsMovilDropdownOpen] = useState(false);
  const [isSecondaryDropdownOpen, setIsSecondaryDropdownOpen] = useState(false);
  const [secondarySearch, setSecondarySearch] = useState('');

  const filteredMoviles = useMemo(() => {
    if (!movilSearch.trim()) return allMoviles;
    const q = movilSearch.toLowerCase();
    return allMoviles.filter(m =>
      String(m.id).includes(q) ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.matricula && m.matricula.toLowerCase().includes(q))
    );
  }, [allMoviles, movilSearch]);

  const currentMovil = allMoviles.find(m => m.id === selectedMovilId);
  const secondaryMovil = allMoviles.find(m => m.id === secondaryMovilId);

  // Filtrar móviles para el dropdown secundario (excluir el primario)
  const filteredSecondaryMoviles = useMemo(() => {
    const available = allMoviles.filter(m => m.id !== selectedMovilId);
    if (!secondarySearch.trim()) return available;
    const q = secondarySearch.toLowerCase();
    return available.filter(m =>
      String(m.id).includes(q) ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.matricula && m.matricula.toLowerCase().includes(q))
    );
  }, [allMoviles, selectedMovilId, secondarySearch]);

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: isPlaying ? 0.35 : 1 }}
      whileHover={{ opacity: 1 }}
      transition={{ opacity: { duration: 0.4 } }}
      className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000]"
    >
      <div className="bg-white rounded-2xl shadow-2xl p-4 min-w-[600px] border-2 border-blue-500">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎬</span>
            <h3 className="font-bold text-gray-800">Animación del Recorrido</h3>
          </div>
          <div className="flex items-center gap-3">
            {currentAnimTimeStr && (
              <div className="text-xs font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200">
                🕓 {currentAnimTimeStr}
              </div>
            )}
            <div className="text-xs text-gray-600 font-semibold">
              {progress.toFixed(1)}% completado
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 transition-all flex items-center justify-center shadow-sm"
                title="Cerrar animación"
              >
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Time Range Selector */}
        {onTimeRangeChange && (
          <div className="mb-3 pb-3 border-b border-gray-200">
            {/* Selector de Móvil y Fecha */}
            {onMovilDateChange && allMoviles.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                {/* Combo de Móvil */}
                <div className="relative flex-1">
                  <button
                    onClick={() => setIsMovilDropdownOpen(!isMovilDropdownOpen)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 border-2 border-purple-300 rounded-lg text-sm font-medium bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                  >
                    <span className="text-purple-600">🚗</span>
                    <span className="flex-1 truncate text-gray-700">
                      {currentMovil ? `${currentMovil.id} — ${currentMovil.name || 'Sin desc.'}` : 'Seleccionar móvil'}
                    </span>
                    <svg className={`w-4 h-4 text-purple-400 transition-transform ${isMovilDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isMovilDropdownOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border-2 border-purple-300 rounded-xl shadow-2xl z-50 max-h-[250px] overflow-hidden flex flex-col">
                      <div className="p-2 border-b border-gray-100">
                        <input
                          type="text"
                          value={movilSearch}
                          onChange={(e) => setMovilSearch(e.target.value)}
                          placeholder="Buscar móvil..."
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-purple-400 focus:outline-none"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto max-h-[200px]">
                        {filteredMoviles.map(m => (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (m.id !== selectedMovilId) {
                                onMovilDateChange(m.id, selectedDate);
                              }
                              setIsMovilDropdownOpen(false);
                              setMovilSearch('');
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                              m.id === selectedMovilId ? 'bg-purple-100 font-semibold' : 'hover:bg-gray-50'
                            }`}
                          >
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              m.id === selectedMovilId ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-600'
                            }`}>{m.id}</span>
                            <span className="flex-1 truncate text-gray-700">{m.name || `Móvil ${m.id}`}</span>
                            {m.id === selectedMovilId && (
                              <svg className="w-4 h-4 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Selector de Fecha */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium">📅</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (selectedMovilId && e.target.value) {
                        onMovilDateChange(selectedMovilId, e.target.value);
                      }
                    }}
                    max={new Date().toISOString().split('T')[0]}
                    className="px-2 py-1.5 border-2 border-purple-300 rounded-lg text-sm font-medium bg-purple-50 focus:border-purple-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            {/* Selector de 2do Móvil (máx 2 simultáneos) */}
            {onSecondaryMovilChange && allMoviles.length > 1 && (
              <div className="flex items-center gap-2 mb-3">
                {secondaryMovilId && secondaryMovil ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-1.5 border-2 border-teal-300 rounded-lg bg-teal-50 text-sm font-medium">
                    <span className="text-teal-600">🚗</span>
                    <span className="flex-1 truncate text-gray-700">
                      2do: {secondaryMovil.id} — {secondaryMovil.name || 'Sin desc.'}
                    </span>
                    <button
                      onClick={() => onSecondaryMovilChange(undefined)}
                      className="w-5 h-5 rounded-full bg-teal-200 hover:bg-red-300 flex items-center justify-center transition-colors"
                      title="Quitar 2do móvil"
                    >
                      <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="relative flex-1">
                    <button
                      onClick={() => setIsSecondaryDropdownOpen(!isSecondaryDropdownOpen)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 border-2 border-dashed border-teal-300 rounded-lg text-sm font-medium bg-white hover:bg-teal-50 transition-colors text-teal-600"
                    >
                      <span>➕</span>
                      <span>Agregar 2do móvil (comparar)</span>
                    </button>
                    {isSecondaryDropdownOpen && (
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border-2 border-teal-300 rounded-xl shadow-2xl z-50 max-h-[250px] overflow-hidden flex flex-col">
                        <div className="p-2 border-b border-gray-100">
                          <input
                            type="text"
                            value={secondarySearch}
                            onChange={(e) => setSecondarySearch(e.target.value)}
                            placeholder="Buscar 2do móvil..."
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-teal-400 focus:outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="overflow-y-auto max-h-[200px]">
                          {filteredSecondaryMoviles.map(m => (
                            <button
                              key={m.id}
                              onClick={() => {
                                onSecondaryMovilChange(m.id);
                                setIsSecondaryDropdownOpen(false);
                                setSecondarySearch('');
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-teal-50"
                            >
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-teal-100 text-teal-700">{m.id}</span>
                              <span className="flex-1 truncate text-gray-700">{m.name || `Móvil ${m.id}`}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 mb-3">
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
            
            {/* Switch para simplificar trayectoria */}
            {onSimplifiedPathChange && (
              <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 border border-blue-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">🎯 Ruta Simplificada</span>
                  <span className="text-xs text-gray-500">(Solo últimas 3 líneas)</span>
                </div>
                <button
                  onClick={() => onSimplifiedPathChange(!simplifiedPath)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    simplifiedPath ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      simplifiedPath ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}
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
