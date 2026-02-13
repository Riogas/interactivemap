'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData } from '@/types';

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (movilId: number, date: string) => void;
  moviles: MovilData[];
  selectedDate: string; // Fecha actual del dashboard (default)
  selectedMovil?: number; // Si ya hay un móvil seleccionado
}

export default function TrackingModal({
  isOpen,
  onClose,
  onConfirm,
  moviles,
  selectedDate,
  selectedMovil: preSelectedMovil,
}: TrackingModalProps) {
  const [movilId, setMovilId] = useState<number | ''>(preSelectedMovil || '');
  const [date, setDate] = useState(selectedDate);
  const [search, setSearch] = useState('');

  // Reset cuando se abre el modal
  const handleOpen = () => {
    setMovilId(preSelectedMovil || '');
    setDate(selectedDate);
    setSearch('');
  };

  // Filtrar móviles por búsqueda
  const filteredMoviles = useMemo(() => {
    if (!search.trim()) return moviles;
    const q = search.toLowerCase();
    return moviles.filter(m => 
      String(m.id).includes(q) ||
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.matricula && m.matricula.toLowerCase().includes(q))
    );
  }, [moviles, search]);

  // Móvil seleccionado actualmente
  const selectedMovilData = useMemo(() => {
    if (!movilId) return null;
    return moviles.find(m => m.id === movilId) || null;
  }, [moviles, movilId]);

  const handleConfirm = () => {
    if (!movilId) return;
    onConfirm(movilId as number, date);
  };

  return (
    <AnimatePresence onExitComplete={handleOpen}>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="bg-white rounded-2xl shadow-2xl w-[440px] max-h-[80vh] overflow-hidden border border-gray-200"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-lg p-2">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg">Ver Recorrido</h2>
                  <p className="text-white/70 text-xs">Selecciona un móvil y una fecha</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 transition-all flex items-center justify-center"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Selector de móvil */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🚗 Móvil
                </label>
                
                {/* Búsqueda */}
                <div className="relative mb-2">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por ID, descripción o patente..."
                    className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-400 focus:outline-none transition-colors"
                  />
                </div>

                {/* Lista de móviles */}
                <div className="max-h-[200px] overflow-y-auto border-2 border-gray-200 rounded-xl">
                  {filteredMoviles.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                      No se encontraron móviles
                    </div>
                  ) : (
                    filteredMoviles.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMovilId(m.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all border-b border-gray-100 last:border-b-0 ${
                          movilId === m.id
                            ? 'bg-purple-50 border-l-4 border-l-purple-500'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          movilId === m.id
                            ? 'bg-purple-500 text-white'
                            : m.isInactive
                              ? 'bg-gray-200 text-gray-500'
                              : 'bg-green-100 text-green-700'
                        }`}>
                          {m.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">
                            {m.name || `Móvil ${m.id}`}
                          </div>
                          <div className="text-xs text-gray-400 truncate">
                            {m.matricula || 'Sin patente'} • {m.isInactive ? '⚠️ Sin reportar' : '🟢 Activo'}
                          </div>
                        </div>
                        {movilId === m.id && (
                          <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Selector de fecha */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📅 Fecha del recorrido
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-medium focus:border-purple-400 focus:outline-none transition-colors"
                />
              </div>

              {/* Info del móvil seleccionado */}
              {selectedMovilData && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-purple-50 rounded-xl p-3 border border-purple-200"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-purple-600 font-semibold">Seleccionado:</span>
                    <span className="text-gray-700">
                      Móvil {selectedMovilData.id} — {selectedMovilData.name || 'Sin descripción'}
                    </span>
                  </div>
                  {selectedMovilData.matricula && (
                    <div className="text-xs text-gray-500 mt-1">
                      Patente: {selectedMovilData.matricula}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={!movilId}
                className={`px-5 py-2.5 text-sm font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 ${
                  movilId
                    ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 hover:shadow-xl transform hover:scale-105'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Ver Recorrido
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
