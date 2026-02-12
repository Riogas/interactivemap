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

// Guía visual de Pedidos
function PedidosGuide() {
  return (
    <div className="space-y-5">
      {/* Título */}
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-800">Guía de Iconos de Pedidos</h3>
        <p className="text-sm text-gray-500 mt-1">
          Referencia visual de cómo se muestran los pedidos y servicios en el mapa
        </p>
      </div>

      {/* Sección 1: Pedidos por Atraso (desde tabla de pedidos) */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold">1</span>
          Pedidos por Atraso — Color según hora de entrega
        </h4>
        <p className="text-xs text-gray-500 mb-3">Los pedidos de la tabla se colorean según la diferencia con la hora máxima de entrega.</p>
        <div className="space-y-2.5">
          {/* En Hora - Verde */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-green-50 border border-green-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #22C55E 0%, #86EFAC 100%)', border: '2px solid white' }}>
                <span className="text-base">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-green-800 text-sm">Verde — En Hora</p>
              <p className="text-xs text-green-700">Faltan 10 minutos o más para la hora límite de entrega. El pedido va bien.</p>
            </div>
          </div>

          {/* Hora Límite Cercana - Amarillo */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-yellow-50 border border-yellow-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #EAB308 0%, #FDE047 100%)', border: '2px solid white' }}>
                <span className="text-base">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-yellow-800 text-sm">Amarillo — Hora Límite Cercana</p>
              <p className="text-xs text-yellow-700">Faltan entre 0 y 9 minutos para la hora límite de entrega. Atención.</p>
            </div>
          </div>

          {/* Atrasado - Rosa */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-pink-50 border border-pink-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #EC4899 0%, #F9A8D4 100%)', border: '2px solid white' }}>
                <span className="text-base">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-pink-800 text-sm">Rosa — Atrasado</p>
              <p className="text-xs text-pink-700">Se pasó entre 1 y 10 minutos de la hora límite de entrega.</p>
            </div>
          </div>

          {/* Muy Atrasado - Rojo */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #EF4444 0%, #FCA5A5 100%)', border: '2px solid white' }}>
                <span className="text-base">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-red-800 text-sm">Rojo — Muy Atrasado</p>
              <p className="text-xs text-red-700">Se pasó más de 10 minutos de la hora límite. Requiere atención urgente.</p>
            </div>
          </div>

          {/* Sin móvil asignado - Gris */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #6B7280 0%, #D1D5DB 100%)', border: '2px solid white' }}>
                <span className="text-base">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Gris — Sin Móvil Asignado</p>
              <p className="text-xs text-gray-600">El pedido no tiene un móvil asignado para la entrega.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sección 2: Completados */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs font-bold">2</span>
          Completados
        </h4>
        <div className="space-y-2.5">
          {/* Pedido completado */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)', border: '2px solid white' }}>
                <span className="text-sm">📦</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-emerald-800 text-sm">Verde Circular — Pedido Completado</p>
              <p className="text-xs text-emerald-700">Pedido entregado exitosamente. El ícono circular lo distingue de los pendientes.</p>
            </div>
          </div>

        </div>
      </div>

      {/* Sección 3: Agrupamiento */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold">3</span>
          Agrupamiento (Cluster)
        </h4>
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-indigo-50 border border-indigo-200">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center shadow-md text-white font-bold text-sm">
              12
            </div>
          </div>
          <div>
            <p className="font-semibold text-indigo-800 text-sm">Número en Círculo — Pedidos Agrupados</p>
            <p className="text-xs text-indigo-700">Cuando hay muchos pedidos cercanos, se agrupan en un cluster que muestra la cantidad. Haga zoom para verlos individualmente.</p>
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
            <strong>Consejo:</strong> Los iconos cuadrados (con bordes redondeados) son pedidos pendientes.
            Los iconos circulares verdes son completados. Al hacer clic en cualquier icono se abre un popup con detalles.
          </span>
        </p>
      </div>
    </div>
  );
}

// Placeholder para futuras guías
function DefaultGuide({ category }: { category: string }) {
  const labels: Record<string, string> = {
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
    pedidos: <PedidosGuide />,
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
