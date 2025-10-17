'use client';

import React from 'react';
import { MovilData } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface MovilInfoPopupProps {
  movil: MovilData | null;
  onClose: () => void;
  onShowAnimation?: () => void;
  onShowPendientes?: () => void;
}

export const MovilInfoPopup: React.FC<MovilInfoPopupProps> = ({ 
  movil, 
  onClose,
  onShowAnimation,
  onShowPendientes
}) => {
  if (!movil || !movil.currentPosition) return null;

  const totalPendientes = (movil.pedidosPendientes || 0) + (movil.serviciosPendientes || 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 100, opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[999] pointer-events-auto"
        style={{ maxWidth: '420px', width: '90%' }}
      >
        <div className="bg-white rounded-xl shadow-2xl border-2 overflow-hidden" style={{ borderColor: movil.color }}>
          {/* Header con color del móvil */}
          <div 
            className="px-3 py-2.5 text-white relative overflow-hidden"
            style={{ backgroundColor: movil.color }}
          >
            <div className="absolute inset-0 bg-black bg-opacity-10"></div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-white bg-opacity-20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                  <span className="text-lg">🚚</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm">{movil.name}</h3>
                  <p className="text-[10px] opacity-90">Móvil #{movil.id}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 transition-all flex items-center justify-center backdrop-blur-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Contenido */}
          <div className="p-3 space-y-2.5">
            {/* Estado y Origen */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Estado Actual</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 border border-blue-200">
                  <div className="text-[9px] text-blue-600 font-semibold mb-0.5">Estado</div>
                  <div className="font-bold text-blue-900 text-xs">{movil.currentPosition.auxIn2}</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 border border-green-200">
                  <div className="text-[9px] text-green-600 font-semibold mb-0.5">Origen</div>
                  <div className="font-bold text-green-900 text-xs">{movil.currentPosition.origen}</div>
                </div>
              </div>
            </div>

            {/* Coordenadas GPS y Distancia */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Información GPS</h4>
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg p-2.5 border border-purple-200">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-[9px] text-purple-600 font-semibold mb-0.5">📍 Coordenadas</div>
                    <div className="font-mono text-[10px] text-gray-900 leading-tight">
                      <div>Lat: {movil.currentPosition.coordX.toFixed(6)}</div>
                      <div>Lng: {movil.currentPosition.coordY.toFixed(6)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-purple-600 font-semibold mb-0.5">📏 Distancia</div>
                    <div className="text-lg font-bold text-purple-900">
                      {movil.currentPosition.distRecorrida.toFixed(2)}
                      <span className="text-[10px] font-normal text-purple-600 ml-0.5">km</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pedidos y Servicios Pendientes */}
            {totalPendientes > 0 && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Pendientes del Día</h4>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-2.5 border-2 border-orange-300">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="text-center bg-white bg-opacity-60 rounded-lg p-1.5">
                      <div className="text-xl font-bold text-orange-600">{movil.pedidosPendientes || 0}</div>
                      <div className="text-[9px] text-gray-700 font-semibold flex items-center justify-center gap-0.5">
                        <span>📦</span>
                        <span>Pedidos</span>
                      </div>
                    </div>
                    <div className="text-center bg-white bg-opacity-60 rounded-lg p-1.5">
                      <div className="text-xl font-bold text-red-600">{movil.serviciosPendientes || 0}</div>
                      <div className="text-[9px] text-gray-700 font-semibold flex items-center justify-center gap-0.5">
                        <span>🔧</span>
                        <span>Servicios</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[9px] text-center text-gray-600 bg-white bg-opacity-60 rounded-lg py-1 px-2">
                    💡 Visibles en el mapa como puntos naranjas y rojos
                  </div>
                </div>
              </div>
            )}

            {/* Historial del Recorrido */}
            {movil.history && movil.history.length > 0 && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Recorrido del Día</h4>
                <div className="bg-gradient-to-br from-gray-50 to-slate-100 rounded-lg p-2.5 border border-gray-200">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="text-center">
                      <div className="text-xl font-bold text-blue-600">{movil.history.length}</div>
                      <div className="text-[9px] text-gray-600 font-semibold">Puntos GPS</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-green-600">
                        {movil.currentPosition.distRecorrida.toFixed(1)}
                      </div>
                      <div className="text-[9px] text-gray-600 font-semibold">Kilómetros</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="flex items-center justify-center gap-1.5 text-[9px] text-gray-500 pt-1.5 border-t border-gray-200">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                {format(new Date(movil.currentPosition.fechaInsLog), "dd/MM/yyyy HH:mm:ss", { locale: es })}
              </span>
            </div>

            {/* Botones de acción */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {/* Botón para ver animación del recorrido - Siempre visible */}
              {onShowAnimation && (
                <button
                  onClick={onShowAnimation}
                  className="py-2.5 px-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-1.5 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Ver Animación</span>
                </button>
              )}

              {/* Botón para ver pedidos pendientes */}
              {totalPendientes > 0 && onShowPendientes && (
                <button
                  onClick={onShowPendientes}
                  className="py-2.5 px-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-1.5 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <span>Pendientes ({totalPendientes})</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
