'use client';

import { motion } from 'framer-motion';
import { MovilData } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface InfoPanelProps {
  moviles: MovilData[];
  selectedMovil?: number;
  lastUpdate: Date;
}

export default function InfoPanel({ moviles, selectedMovil, lastUpdate }: InfoPanelProps) {
  const displayMoviles = selectedMovil
    ? moviles.filter(m => m.id === selectedMovil)
    : moviles;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">Información en Tiempo Real</h2>
        <motion.div
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex items-center gap-2 text-green-600"
        >
          <div className="w-2 h-2 bg-green-600 rounded-full" />
          <span className="text-sm font-medium">En vivo</span>
        </motion.div>
      </div>

      <p className="text-xs text-gray-500 mb-4">
        Última actualización: {format(lastUpdate, "HH:mm:ss", { locale: es })}
      </p>

      <div className="space-y-4 max-h-96 overflow-y-auto">
        {displayMoviles.map((movil) => (
          <motion.div
            key={movil.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-l-4 pl-4 py-3 rounded-r-lg bg-gray-50"
            style={{ borderColor: movil.color }}
          >
            <h3 className="font-bold text-lg mb-2" style={{ color: movil.color }}>
              {movil.name}
            </h3>
            
            {movil.currentPosition ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Estado:</span>
                  <span className="font-semibold">{movil.currentPosition.auxIn2}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Origen:</span>
                  <span className="font-semibold">{movil.currentPosition.origen}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Distancia:</span>
                  <span className="font-semibold">
                    {movil.currentPosition.distRecorrida.toFixed(2)} km
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Coordenadas:</span>
                  <span className="font-mono text-xs">
                    {movil.currentPosition.coordX.toFixed(6)}, {movil.currentPosition.coordY.toFixed(6)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 pt-2 border-t">
                  <span>Última posición:</span>
                  <span>
                    {format(new Date(movil.currentPosition.fechaInsLog), "dd/MM/yyyy HH:mm:ss", {
                      locale: es,
                    })}
                  </span>
                </div>
                
                {/* Información del recorrido si hay historial */}
                {movil.history && movil.history.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                      <span>📍</span>
                      Recorrido del Día
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Puntos registrados:</span>
                        <span className="font-semibold">{movil.history.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Frecuencia:</span>
                        <span className="font-semibold">~3 minutos</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Hora inicio:</span>
                        <span className="font-semibold">
                          {format(new Date(movil.history[movil.history.length - 1].fechaInsLog), "HH:mm", {
                            locale: es,
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Hora actual:</span>
                        <span className="font-semibold">
                          {format(new Date(movil.history[0].fechaInsLog), "HH:mm", {
                            locale: es,
                          })}
                        </span>
                      </div>
                    </div>
                    
                    {/* Leyenda visual */}
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-xs font-semibold text-blue-900 mb-2">📖 Leyenda del Mapa:</p>
                      <div className="space-y-1.5 text-xs text-blue-800">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-0.5 border-t-2 border-dashed" style={{ borderColor: movil.color }}></div>
                          <span>Línea discontinua = recorrido aproximado</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span>🎯 ACTUAL = posición más reciente</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span>🏁 INICIO = primer registro del día</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full opacity-60" style={{ backgroundColor: movil.color }}></div>
                          <span>#N = punto intermedio numerado</span>
                        </div>
                        <p className="text-xs text-blue-700 italic mt-2 pt-2 border-t border-blue-200">
                          💡 Las coordenadas se registran cada ~3 minutos, por lo que la línea no sigue exactamente las calles.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No hay datos disponibles</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
