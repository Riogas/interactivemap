'use client';

import { motion, AnimatePresence } from 'framer-motion';

type GuideCategory = 'moviles' | 'pedidos' | 'services' | 'pois';

interface MapGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: GuideCategory;
}

// Guía visual de Móviles
function MovilesGuide() {
  return (
    <div className="space-y-5">
      {/* Título */}
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-800">Guía de Indicadores de Móviles</h3>
        <p className="text-sm text-gray-500 mt-1">
          Aprenda a interpretar los iconos y colores en el mapa
        </p>
      </div>

      {/* Sección: Colores del ícono */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold">1</span>
          Color del Ícono — Capacidad de Entrega
        </h4>
        <div className="space-y-2.5">
          {/* Verde */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-green-50 border border-green-200">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-green-600 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                42
              </div>
            </div>
            <div>
              <p className="font-semibold text-green-800 text-sm">Verde — Capacidad ≥ 50%</p>
              <p className="text-xs text-green-700">El lote tiene más de la mitad de capacidad disponible para entregas.</p>
            </div>
          </div>

          {/* Amarillo */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-yellow-50 border border-yellow-200">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center shadow-md">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-yellow-600 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                15
              </div>
            </div>
            <div>
              <p className="font-semibold text-yellow-800 text-sm">Amarillo — Capacidad &lt; 50%</p>
              <p className="text-xs text-yellow-700">El lote tiene menos de la mitad de capacidad disponible.</p>
            </div>
          </div>

          {/* Negro */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-100 border border-gray-300">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center shadow-md">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-gray-700 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                8
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Negro — Sin Capacidad (Lote lleno)</p>
              <p className="text-xs text-gray-600">El lote está completo, no tiene capacidad de entrega disponible.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sección: Alarma / No reporta GPS */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-red-100 flex items-center justify-center text-red-600 text-xs font-bold">2</span>
          Alarma — No reporta GPS / Inactivo
        </h4>
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
          <div className="relative flex-shrink-0">
            {/* Simular el ícono de alarma con pulso */}
            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shadow-md animate-pulse">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
              </svg>
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full animate-ping" />
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-600 rounded-full" />
          </div>
          <div>
            <p className="font-semibold text-red-800 text-sm">Rojo con Animación de Pulso</p>
            <p className="text-xs text-red-700">
              El móvil no está reportando posición GPS o se encuentra inactivo.
              Se muestra un ícono de campana con un borde rojo pulsante para alertar visualmente.
            </p>
          </div>
        </div>
      </div>

      {/* Sección: Badge numérico */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-purple-100 flex items-center justify-center text-purple-600 text-xs font-bold">3</span>
          Badge Numérico
        </h4>
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-purple-50 border border-purple-200">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
              </svg>
            </div>
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[7px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center shadow">
              127
            </div>
          </div>
          <div>
            <p className="font-semibold text-purple-800 text-sm">Número de Identificación</p>
            <p className="text-xs text-purple-700">
              Debajo de cada ícono se muestra el número identificador del móvil
              para una rápida referencia visual en el mapa.
            </p>
          </div>
        </div>
      </div>

      {/* Nota adicional */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-800 flex items-start gap-2">
          <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>
            <strong>Consejo:</strong> Al hacer clic en un móvil en el mapa se abrirá un popup con
            información detallada incluyendo capacidad del lote, ubicación, conductor y más.
          </span>
        </p>
      </div>
    </div>
  );
}

// Placeholder para futuras guías
function DefaultGuide({ category }: { category: string }) {
  const labels: Record<string, string> = {
    pedidos: 'Pedidos',
    services: 'Services',
    pois: 'Puntos de Interés',
  };
  return (
    <div className="text-center py-8">
      <span className="text-4xl mb-3 block">🚧</span>
      <p className="text-gray-600 font-medium">Guía de {labels[category] || category}</p>
      <p className="text-sm text-gray-400 mt-1">Próximamente...</p>
    </div>
  );
}

export default function MapGuideModal({ isOpen, onClose, category }: MapGuideModalProps) {
  const guideContent: Record<GuideCategory, React.ReactNode> = {
    moviles: <MovilesGuide />,
    pedidos: <DefaultGuide category="pedidos" />,
    services: <DefaultGuide category="services" />,
    pois: <DefaultGuide category="pois" />,
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-gray-800">Guía del Mapa</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(85vh-60px)] scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {guideContent[category]}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
