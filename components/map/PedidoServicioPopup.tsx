'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { PedidoServicio } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PedidoServicioPopupProps {
  item: PedidoServicio | null;
  onClose: () => void;
}

export default function PedidoServicioPopup({ item, onClose }: PedidoServicioPopupProps) {
  if (!item) return null;

  const isPedido = item.tipo === 'PEDIDO';
  const color = isPedido ? '#f97316' : '#ef4444'; // Orange for pedidos, red for servicios
  const icon = isPedido ? '📦' : '🔧';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 100, opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[999] pointer-events-auto"
        style={{ maxWidth: '450px', width: '90%' }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border-2 overflow-hidden" style={{ borderColor: color }}>
          {/* Header */}
          <div 
            className="px-6 py-4 text-white flex items-center justify-between"
            style={{ backgroundColor: color }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center backdrop-blur-sm">
                <span className="text-2xl">{icon}</span>
              </div>
              <div>
                <h3 className="font-bold text-lg">{item.tipo}</h3>
                <p className="text-xs opacity-90">ID: {item.id}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 transition-all flex items-center justify-center backdrop-blur-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Contenido */}
          <div className="p-6 space-y-4">
            {/* Cliente */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-200 rounded-full flex items-center justify-center">
                  <span className="text-xl">👤</span>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-600 mb-1">Cliente</div>
                  <div className="font-bold text-blue-900">{item.clinom}</div>
                  <div className="text-xs text-gray-600 mt-1">ID: {item.cliid}</div>
                </div>
              </div>
            </div>

            {/* Estado */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3">
                <div className="text-xs text-gray-600 mb-1">Estado</div>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${item.estado === 1 ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                  <div className="font-bold text-green-900">
                    {item.estado === 1 ? 'Pendiente' : `Estado ${item.estado}`}
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3">
                <div className="text-xs text-gray-600 mb-1">SubEstado</div>
                <div className="font-bold text-purple-900">{item.subestado}</div>
              </div>
            </div>

            {/* Ubicación */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📍</span>
                <h4 className="font-semibold text-sm">Ubicación</h4>
              </div>
              <div className="font-mono text-xs text-gray-700 bg-white rounded p-2">
                Lat: {item.x?.toFixed(6) || 'N/A'}<br />
                Lng: {item.y?.toFixed(6) || 'N/A'}
              </div>
            </div>

            {/* Fecha */}
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pt-2 border-t">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>
                {item.fecha ? format(new Date(item.fecha), "dd/MM/yyyy HH:mm", { locale: es }) : 'Sin fecha'}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
