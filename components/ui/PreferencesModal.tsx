'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface UserPreferences {
  defaultMapLayer: 'streets' | 'satellite' | 'terrain' | 'cartodb' | 'dark' | 'light';
  showActiveMovilesOnly: boolean;
  maxCoordinateDelayMinutes: number;
  realtimeEnabled: boolean; // Modo Tiempo Real ON/OFF
  showRouteAnimation: boolean;
  showCompletedMarkers: boolean;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  defaultMapLayer: 'streets',
  showActiveMovilesOnly: false,
  maxCoordinateDelayMinutes: 30,
  realtimeEnabled: true, // Por defecto activado
  showRouteAnimation: true,
  showCompletedMarkers: true,
};

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}

export default function PreferencesModal({ isOpen, onClose, onSave }: PreferencesModalProps) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

  // Cargar preferencias desde localStorage al montar
  useEffect(() => {
    const saved = localStorage.getItem('userPreferences');
    if (saved) {
      try {
        const savedPrefs = JSON.parse(saved);
        // Asegurar que realtimeEnabled existe, si no, usar el valor por defecto
        if (savedPrefs.realtimeEnabled === undefined) {
          savedPrefs.realtimeEnabled = DEFAULT_PREFERENCES.realtimeEnabled;
        }
        setPreferences(savedPrefs);
      } catch (e) {
        console.error('Error al cargar preferencias:', e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    onSave(preferences);
    onClose();
  };

  const handleReset = () => {
    setPreferences(DEFAULT_PREFERENCES);
    localStorage.removeItem('userPreferences');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl z-[70]"
          >
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 rounded-t-2xl border-b border-blue-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-lg p-2">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Preferencias</h2>
                    <p className="text-xs text-blue-100">Configura la aplicación según tus necesidades</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Vista del Mapa por Defecto */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🗺️</span>
                  Vista del Mapa por Defecto
                </label>
                <select
                  value={preferences.defaultMapLayer}
                  onChange={(e) => setPreferences({ ...preferences, defaultMapLayer: e.target.value as any })}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  <option value="streets">🗺️ Calles (OpenStreetMap)</option>
                  <option value="satellite">🛰️ Satélite (Esri World Imagery)</option>
                  <option value="terrain">🗻 Terreno (OpenTopoMap)</option>
                  <option value="cartodb">🌊 CartoDB Voyager</option>
                  <option value="dark">🌙 Modo Oscuro (CartoDB Dark)</option>
                  <option value="light">🌞 Modo Claro (CartoDB Light)</option>
                </select>
                <p className="text-xs text-gray-500">Esta será la vista del mapa al cargar la aplicación</p>
              </div>

              <hr className="border-gray-200" />

              {/* Mostrar Solo Móviles Activos */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🚗</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                        Mostrar Solo Móviles Activos
                      </div>
                      <p className="text-xs text-gray-500">Oculta móviles sin actualizaciones recientes</p>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={preferences.showActiveMovilesOnly}
                      onChange={(e) => setPreferences({ ...preferences, showActiveMovilesOnly: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>

              <hr className="border-gray-200" />

              {/* Retraso Máximo de Coordenadas */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">⏱️</span>
                  Retraso Máximo de Coordenadas
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="5"
                    max="120"
                    step="5"
                    value={preferences.maxCoordinateDelayMinutes}
                    onChange={(e) => setPreferences({ ...preferences, maxCoordinateDelayMinutes: parseInt(e.target.value) })}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="min-w-[80px] px-3 py-2 bg-blue-50 text-blue-700 font-bold rounded-lg text-center">
                    {preferences.maxCoordinateDelayMinutes} min
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Mostrar solo coordenadas de los últimos {preferences.maxCoordinateDelayMinutes} minutos
                </p>
              </div>

              <hr className="border-gray-200" />

              {/* Modo Tiempo Real */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-green-400 to-emerald-600 rounded-lg shadow-md">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                        Modo Tiempo Real
                      </div>
                      <p className="text-xs text-gray-500">
                        {preferences.realtimeEnabled 
                          ? 'Actualizaciones automáticas activadas' 
                          : 'Modo estático (sin actualizaciones automáticas)'}
                      </p>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={preferences.realtimeEnabled}
                      onChange={(e) => setPreferences({ ...preferences, realtimeEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                  </div>
                </label>
              </div>

              <hr className="border-gray-200" />

              {/* Mostrar Animación de Rutas */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎬</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                        Habilitar Animación de Rutas
                      </div>
                      <p className="text-xs text-gray-500">Mostrar control de animación en el mapa</p>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={preferences.showRouteAnimation}
                      onChange={(e) => setPreferences({ ...preferences, showRouteAnimation: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>

              <hr className="border-gray-200" />

              {/* Mostrar Marcadores Completados */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">✅</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                        Mostrar Pedidos/Servicios Completados
                      </div>
                      <p className="text-xs text-gray-500">Ver marcadores de entregas finalizadas</p>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={preferences.showCompletedMarkers}
                      onChange={(e) => setPreferences({ ...preferences, showCompletedMarkers: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-2xl border-t border-gray-200 flex items-center justify-between gap-4">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              >
                🔄 Restablecer
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-lg hover:shadow-xl transition-all"
                >
                  💾 Guardar Preferencias
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook para usar preferencias en cualquier componente
export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    const saved = localStorage.getItem('userPreferences');
    if (saved) {
      try {
        const savedPrefs = JSON.parse(saved);
        // Asegurar que realtimeEnabled existe, si no, usar el valor por defecto
        if (savedPrefs.realtimeEnabled === undefined) {
          savedPrefs.realtimeEnabled = DEFAULT_PREFERENCES.realtimeEnabled;
        }
        setPreferences(savedPrefs);
      } catch (e) {
        console.error('Error al cargar preferencias:', e);
      }
    }
  }, []);

  const updatePreferences = (newPreferences: UserPreferences) => {
    setPreferences(newPreferences);
    localStorage.setItem('userPreferences', JSON.stringify(newPreferences));
  };

  return { preferences, updatePreferences };
}
