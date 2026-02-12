'use client';

import React from 'react';
import { ServiceSupabase } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion } from '@/utils/estadoPedido';

interface ServiceInfoPopupProps {
  service: ServiceSupabase | null;
  onClose: () => void;
}

export const ServiceInfoPopup: React.FC<ServiceInfoPopupProps> = ({ 
  service, 
  onClose,
}) => {
  if (!service) return null;

  const getEstadoColor = (estadoNro: number | null) => {
    if (!estadoNro) return '#6B7280';
    if (estadoNro <= 2) return '#8B5CF6'; // Violeta para services
    if (estadoNro <= 5) return '#EAB308';
    if (estadoNro === 7) return '#22C55E';
    return '#EF4444';
  };

  const estadoColor = getEstadoColor(service.estado_nro);

  const delayMinutes = computeDelayMinutes(service.fch_hora_max_ent_comp);
  const delayInfo = getDelayInfo(delayMinutes);

  const formatPrecio = (precio: number | null) => {
    if (!precio) return 'N/A';
    return new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency: 'UYU',
      minimumFractionDigits: 0,
    }).format(precio);
  };

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
        <div className="bg-white rounded-xl shadow-2xl border-2 overflow-hidden" style={{ borderColor: estadoColor }}>
          {/* Header */}
          <div 
            className="px-3 py-2.5 text-white relative overflow-hidden"
            style={{ backgroundColor: estadoColor }}
          >
            <div className="absolute inset-0 bg-black bg-opacity-10"></div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-white bg-opacity-20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                  <span className="text-lg">🔧</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm">Service #{service.id}</h3>
                  <p className="text-[10px] opacity-90">{service.tipo || 'Services'}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-white hover:bg-gray-100 transition-all flex items-center justify-center shadow-md"
              >
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Contenido */}
          <div className="p-3 space-y-2.5">
            {/* Etiqueta de Atraso/Demora */}
            {Number(service.estado_nro) !== 2 ? (
            <div 
              className="flex items-center justify-between rounded-lg px-3 py-2 border"
              style={{ 
                backgroundColor: `${delayInfo.color}15`,
                borderColor: `${delayInfo.color}40`,
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: delayInfo.color }} />
                <span className="text-xs font-bold" style={{ color: delayInfo.color }}>
                  {delayInfo.label}
                </span>
              </div>
              <span 
                className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: delayInfo.color }}
              >
                ⏱ {delayInfo.badgeText}
              </span>
            </div>
            ) : (
            <div 
              className="flex items-center justify-between rounded-lg px-3 py-2 border"
              style={{ backgroundColor: '#22c55e15', borderColor: '#22c55e40' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                <span className="text-xs font-bold" style={{ color: '#22c55e' }}>Completado</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#22c55e' }}>
                ✔ Completado
              </span>
            </div>
            )}

            {/* Defecto */}
            {service.defecto && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Defecto</h4>
                <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-2 border border-violet-200">
                  <div className="font-bold text-violet-900 text-sm">{service.defecto}</div>
                </div>
              </div>
            )}

            {/* Cliente */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cliente</h4>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 border border-blue-200">
                <div className="font-bold text-blue-900 text-sm">{service.cliente_nombre || 'Sin nombre'}</div>
                {service.cliente_tel && (
                  <div className="text-[10px] text-blue-700 mt-0.5">📞 {service.cliente_tel}</div>
                )}
                {service.cliente_direccion && (
                  <div className="text-[10px] text-blue-600 mt-1">📍 {service.cliente_direccion}</div>
                )}
              </div>
            </div>

            {/* Producto y Estado */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Detalles del Service</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-2 border border-purple-200">
                  <div className="text-[9px] text-purple-600 font-semibold mb-0.5">Producto</div>
                  <div className="font-bold text-purple-900 text-xs truncate">
                    {service.producto_nom || service.producto_cod || 'N/A'}
                  </div>
                  {service.producto_cant && (
                    <div className="text-[10px] text-purple-700 mt-0.5">Cant: {service.producto_cant}</div>
                  )}
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 border border-green-200">
                  <div className="text-[9px] text-green-600 font-semibold mb-0.5">Estado</div>
                  <div className="font-bold text-green-900 text-xs">
                    {getEstadoDescripcion(service.sub_estado_nro, service.sub_estado_desc)}
                  </div>
                </div>
              </div>
            </div>

            {/* Móvil y Prioridad */}
            {(service.movil || service.prioridad !== null) && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Asignación</h4>
                <div className="grid grid-cols-2 gap-2">
                  {service.movil && (
                    <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-2 border border-indigo-200">
                      <div className="text-[9px] text-indigo-600 font-semibold mb-0.5">Móvil</div>
                      <div className="font-bold text-indigo-900 text-sm">#{service.movil}</div>
                    </div>
                  )}
                  {service.prioridad !== null && (
                    <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-2 border border-orange-200">
                      <div className="text-[9px] text-orange-600 font-semibold mb-0.5">Prioridad</div>
                      <div className="font-bold text-orange-900 text-sm">{service.prioridad}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Importe */}
            {(service.imp_bruto || service.precio) && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Importe</h4>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-2 border border-emerald-200">
                  <div className="flex justify-between items-center">
                    <div className="text-[9px] text-emerald-600 font-semibold">Total</div>
                    <div className="text-lg font-bold text-emerald-900">
                      {formatPrecio(service.imp_bruto || service.precio || null)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Observaciones */}
            {service.pedido_obs && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Observaciones</h4>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-2 border border-amber-200">
                  <div className="text-[10px] text-amber-900 leading-relaxed">{service.pedido_obs}</div>
                </div>
              </div>
            )}

            {/* Fecha */}
            {service.fch_hora_para && (
              <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-2.5 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[9px] text-gray-500 font-semibold">Fecha Programada</div>
                      <div className="text-xs font-bold text-gray-900">
                        {format(new Date(service.fch_hora_para), "dd/MM/yyyy HH:mm", { locale: es })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
