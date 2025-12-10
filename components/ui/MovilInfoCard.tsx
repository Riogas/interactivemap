'use client';

import React from 'react';
import { MovilData } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

interface MovilInfoCardProps {
  movil: MovilData | null;
  onShowAnimation?: () => void;
  onShowPendientes?: () => void;
  onShowCompletados?: () => void;
}

export const MovilInfoCard: React.FC<MovilInfoCardProps> = ({ 
  movil, 
  onShowAnimation,
  onShowPendientes,
  onShowCompletados
}) => {
  if (!movil || !movil.currentPosition) return null;

  const totalPendientes = (movil.pedidosPendientes || 0) + (movil.serviciosPendientes || 0);
  const hasHistory = movil.history && movil.history.length > 0;
  
  // Calcular completados del historial (UPDPEDIDOS o DYLPEDIDOS)
  const totalCompletados = hasHistory && movil.history
    ? new Set(
        movil.history
          .filter(coord => 
            (coord.origen?.trim() === 'UPDPEDIDOS' || coord.origen?.trim() === 'DYLPEDIDOS') 
            && coord.pedidoId && coord.pedidoId > 0
          )
          .map(coord => coord.pedidoId)
      ).size
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="bg-white rounded-lg shadow-lg border-2 overflow-hidden"
        style={{ borderColor: movil.color }}
      >
        {/* Header con color del móvil - MÁS COMPACTO */}
        <div 
          className="px-3 py-2 text-white relative overflow-hidden"
          style={{ backgroundColor: movil.color }}
        >
          <div className="absolute inset-0 bg-black bg-opacity-10"></div>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white bg-opacity-20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                <span className="text-lg">🚚</span>
              </div>
              <div>
                <h3 className="font-bold text-sm">{movil.name}</h3>
                <p className="text-[10px] opacity-90">Móvil #{movil.id}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contenido - MÁS COMPACTO */}
        <div className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            {/* Estado Actual */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-md p-2 border border-blue-200">
              <div className="text-[10px] text-blue-600 font-semibold mb-0.5">Estado</div>
              <div className="font-bold text-blue-900 text-xs">{movil.currentPosition.auxIn2}</div>
            </div>

            {/* Origen */}
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-md p-2 border border-green-200">
              <div className="text-[10px] text-green-600 font-semibold mb-0.5">Origen</div>
              <div className="font-bold text-green-900 text-xs">{movil.currentPosition.origen}</div>
            </div>

            {/* Coordenadas */}
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-md p-2 border border-purple-200">
              <div className="text-[10px] text-purple-600 font-semibold mb-0.5">📍 Coordenadas</div>
              <div className="font-mono text-[9px] text-gray-900 leading-tight">
                <div>Lat: {movil.currentPosition.coordX.toFixed(5)}</div>
                <div>Lng: {movil.currentPosition.coordY.toFixed(5)}</div>
              </div>
            </div>

            {/* Distancia - CONVERTIDA A KM */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-md p-2 border border-orange-200">
              <div className="text-[10px] text-orange-600 font-semibold mb-0.5">📏 Distancia</div>
              <div className="text-lg font-bold text-orange-900">
                {(movil.currentPosition.distRecorrida / 1000).toFixed(2)}
                <span className="text-[10px] font-normal text-orange-600 ml-1">km</span>
              </div>
            </div>
          </div>

          {/* Estadísticas del Recorrido - MÁS COMPACTAS */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {/* Puntos GPS */}
            {hasHistory && (
              <div className="text-center bg-gradient-to-br from-gray-50 to-slate-100 rounded-md p-2 border border-gray-200">
                <div className="text-lg font-bold text-blue-600">{movil.history!.length}</div>
                <div className="text-[10px] text-gray-600 font-semibold">Puntos GPS</div>
              </div>
            )}

            {/* Pendientes */}
            <div className="text-center bg-gradient-to-br from-amber-50 to-orange-50 rounded-md p-2 border-2 border-orange-300">
              <div className="text-lg font-bold text-orange-600">{totalPendientes}</div>
              <div className="text-[10px] text-gray-700 font-semibold flex items-center justify-center gap-1">
                <span>📦</span>
                <span>Pendientes</span>
              </div>
            </div>

            {/* Completados */}
            <div className="text-center bg-gradient-to-br from-green-50 to-emerald-50 rounded-md p-2 border-2 border-green-300">
              <div className="text-lg font-bold text-green-600">{totalCompletados}</div>
              <div className="text-[10px] text-gray-700 font-semibold flex items-center justify-center gap-1">
                <span>✅</span>
                <span>Completados</span>
              </div>
            </div>
          </div>

          {/* Botones de Acción - MÁS COMPACTOS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* Ver Animación */}
            {hasHistory && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onShowAnimation}
                className="bg-gradient-to-r from-purple-500 to-purple-600 text-white px-3 py-2 rounded-md font-semibold hover:from-purple-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 text-xs"
              >
                <span className="text-sm">🎬</span>
                <span>Ver Animación</span>
              </motion.button>
            )}

            {/* Ver Pendientes */}
            {totalPendientes > 0 && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onShowPendientes}
                className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-3 py-2 rounded-md font-semibold hover:from-orange-600 hover:to-orange-700 transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 text-xs"
              >
                <span className="text-sm">📦</span>
                <span>Ver Pendientes ({totalPendientes})</span>
              </motion.button>
            )}

            {/* Ver Completados */}
            {totalCompletados > 0 && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onShowCompletados}
                className="bg-gradient-to-r from-green-500 to-green-600 text-white px-3 py-2 rounded-md font-semibold hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 text-xs"
              >
                <span className="text-sm">✅</span>
                <span>Ver Completados ({totalCompletados})</span>
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MovilInfoCard;
