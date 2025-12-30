'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CustomMarkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (marker: {
    nombre: string;
    observacion: string;
    icono: string;
  }) => void;
  initialData?: {
    nombre: string;
    observacion: string;
    icono: string;
  };
}

const iconOptions = [
  { emoji: '📍', label: 'Marcador' },
  { emoji: '🏢', label: 'Edificio' },
  { emoji: '🏭', label: 'Fábrica' },
  { emoji: '🏪', label: 'Tienda' },
  { emoji: '🏥', label: 'Hospital' },
  { emoji: '⛽', label: 'Gasolinera' },
  { emoji: '🅿️', label: 'Parking' },
  { emoji: '🚧', label: 'Obra' },
  { emoji: '⚠️', label: 'Advertencia' },
  { emoji: '🔴', label: 'Punto Rojo' },
  { emoji: '🟢', label: 'Punto Verde' },
  { emoji: '🟡', label: 'Punto Amarillo' },
  { emoji: '⭐', label: 'Estrella' },
  { emoji: '📦', label: 'Paquete' },
  { emoji: '🎯', label: 'Objetivo' },
  { emoji: '🏁', label: 'Meta' },
  { emoji: '🚩', label: 'Bandera' },
  { emoji: '💡', label: 'Idea' },
  { emoji: '🔔', label: 'Campana' },
  { emoji: '📌', label: 'Pin' },
];

export default function CustomMarkerModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: CustomMarkerModalProps) {
  const [nombre, setNombre] = useState(initialData?.nombre || '');
  const [observacion, setObservacion] = useState(initialData?.observacion || '');
  const [selectedIcon, setSelectedIcon] = useState(initialData?.icono || '📍');

  useEffect(() => {
    if (initialData) {
      setNombre(initialData.nombre);
      setObservacion(initialData.observacion);
      setSelectedIcon(initialData.icono);
    }
  }, [initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      alert('Por favor ingresa un nombre para el marcador');
      return;
    }
    onSave({
      nombre: nombre.trim(),
      observacion: observacion.trim(),
      icono: selectedIcon,
    });
    handleClose();
  };

  const handleClose = () => {
    setNombre('');
    setObservacion('');
    setSelectedIcon('📍');
    onClose();
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
            className="fixed inset-0 bg-black/50 z-[10000]"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[10001] w-full max-w-md"
          >
            <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="text-2xl">{selectedIcon}</span>
                    Crear Marcador Personalizado
                  </h3>
                  <button
                    onClick={handleClose}
                    className="text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {/* Nombre */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Nombre del Marcador *
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: Depósito Central"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    maxLength={50}
                    autoFocus
                  />
                </div>

                {/* Observación */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Observación (opcional)
                  </label>
                  <textarea
                    value={observacion}
                    onChange={(e) => setObservacion(e.target.value)}
                    placeholder="Ej: Punto de entrega preferencial, horario 8-17hs"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none"
                    rows={3}
                    maxLength={200}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {observacion.length}/200 caracteres
                  </p>
                </div>

                {/* Selector de Icono */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Selecciona un Icono
                  </label>
                  <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                    {iconOptions.map((option) => (
                      <button
                        key={option.emoji}
                        type="button"
                        onClick={() => setSelectedIcon(option.emoji)}
                        className={`
                          flex flex-col items-center justify-center p-3 rounded-lg transition-all
                          ${selectedIcon === option.emoji
                            ? 'bg-blue-500 text-white shadow-lg scale-110'
                            : 'bg-white hover:bg-blue-50 text-gray-700 hover:scale-105'
                          }
                        `}
                        title={option.label}
                      >
                        <span className="text-2xl">{option.emoji}</span>
                        <span className="text-[8px] mt-1 truncate w-full text-center">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium rounded-lg shadow-lg transition-all transform hover:scale-105"
                  >
                    Guardar Marcador
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
