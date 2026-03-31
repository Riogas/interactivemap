'use client';

import React, { useState, useEffect } from 'react';
import { PedidoSupabase } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion } from '@/utils/estadoPedido';

/**
 * La DB almacena horas locales (Uruguay) con offset +00 incorrecto.
 * Ej: "2026-02-10 13:51:46+00" realmente significa 13:51 hora local.
 * Stripeamos el offset para que JS lo interprete como hora local del navegador.
 */
function parseLocalDate(dateStr: string): Date {
  const stripped = dateStr.replace(/[+-]\d{2}(:\d{2})?$/, '').trim();
  return new Date(stripped);
}

interface PedidoInfoPopupProps {
  pedido: PedidoSupabase | null;
  onClose: () => void;
}

export const PedidoInfoPopup: React.FC<PedidoInfoPopupProps> = ({ 
  pedido, 
  onClose,
}) => {
  const [movilTel, setMovilTel] = useState<string | null>(null);
  const [movilChofer, setMovilChofer] = useState<string | null>(null);

  useEffect(() => {
    setMovilTel(null);
    setMovilChofer(null);
    if (!pedido?.movil) return;
    const fetchMovilSession = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/movil-session/${pedido.movil}?fecha=${today}`);
        if (res.ok) {
          const data = await res.json();
          setMovilTel(data.telefono || null);
          setMovilChofer(data.chofer || null);
        }
      } catch (err) {
        console.error('Error fetching movil session:', err);
      }
    };
    fetchMovilSession();
  }, [pedido?.movil]);

  if (!pedido) return null;

  // Determinar color según estado
  const getEstadoColor = (estadoNro: number | null) => {
    if (!estadoNro) return '#6B7280'; // Gris
    if (estadoNro <= 2) return '#3B82F6'; // Azul - Asignado
    if (estadoNro <= 5) return '#EAB308'; // Amarillo - En proceso
    if (estadoNro === 7) return '#22C55E'; // Verde - Completado
    return '#EF4444'; // Rojo - Cancelado/Error
  };

  const estadoColor = getEstadoColor(pedido.estado_nro);

  // Calcular atraso/demora
  const delayMinutes = computeDelayMinutes(pedido.fch_hora_max_ent_comp);
  const delayInfo = getDelayInfo(delayMinutes);

  // Formatear precio con símbolo de peso
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
        className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[10001] pointer-events-auto"
        style={{ maxWidth: '420px', width: '90%', maxHeight: 'calc(100vh - 2rem)' }}
      >
        <div className="bg-white rounded-xl shadow-2xl border-2 flex flex-col" style={{ borderColor: estadoColor, maxHeight: 'calc(100vh - 2rem)' }}>
          {/* Header con color según estado */}
          <div 
            className="px-3 py-2.5 text-white relative overflow-hidden flex-shrink-0"
            style={{ backgroundColor: estadoColor }}
          >
            <div className="absolute inset-0 bg-black bg-opacity-10"></div>
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-white bg-opacity-20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                  <span className="text-lg">📦</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm">Pedido #{pedido.id}</h3>
                  {pedido.servicio_nombre && (
                    <p className="text-[10px] font-medium opacity-95">{pedido.servicio_nombre}</p>
                  )}
                  <p className="text-[10px] opacity-90">{pedido.tipo || 'Pedido'}</p>
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
          <div className="p-3 space-y-2.5 overflow-y-auto flex-1">
            {/* Etiqueta de Atraso/Demora - solo para pedidos NO entregados */}
            {Number(pedido.estado_nro) !== 2 ? (
            <div 
              className="flex items-center justify-between rounded-lg px-3 py-2 border"
              style={{ 
                backgroundColor: `${delayInfo.color}15`,
                borderColor: `${delayInfo.color}40`,
              }}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: delayInfo.color }}
                />
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
            ) : (() => {
              const esEntregado = [3,16].includes(Number(pedido.sub_estado_desc));
              const bannerColor = esEntregado ? '#22c55e' : '#ef4444';
              const estadoDesc = getEstadoDescripcion(pedido.sub_estado_nro, pedido.sub_estado_desc);
              return (
                <div 
                  className="flex items-center justify-between rounded-lg px-3 py-2 border"
                  style={{ 
                    backgroundColor: `${bannerColor}15`,
                    borderColor: `${bannerColor}40`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: bannerColor }} />
                    <span className="text-xs font-bold" style={{ color: bannerColor }}>
                      {estadoDesc}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: bannerColor }}>
                    {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
                  </span>
                </div>
              );
            })()}
            {/* Cliente */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cliente</h4>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-2 border border-blue-200">
                {pedido.cliente_tel && (
                  <a
                    href={`tel:${pedido.cliente_tel}`}
                    className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-200/60 hover:bg-blue-300/60 rounded-md transition-colors"
                  >
                    <span className="text-sm">📞</span>
                    <span className="text-sm font-bold text-blue-900 tracking-wide">{pedido.cliente_tel}</span>
                  </a>
                )}
                <div className="text-[10px] text-blue-700 mt-1 leading-relaxed">
                  {pedido.cliente_nombre && <span className="font-semibold">{pedido.cliente_nombre}</span>}
                  {pedido.cliente_nombre && pedido.cliente_direccion && ' – '}
                  {pedido.cliente_direccion && <span className="text-blue-600">{pedido.cliente_direccion}</span>}
                  {!pedido.cliente_nombre && !pedido.cliente_direccion && <span className="text-blue-400">Sin datos</span>}
                </div>
              </div>
            </div>

            {/* Producto y Estado */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Detalles del Pedido</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-2 border border-purple-200">
                  <div className="text-[9px] text-purple-600 font-semibold mb-0.5">Producto</div>
                  <div className="font-bold text-purple-900 text-xs truncate">
                    {pedido.producto_nom || pedido.producto_cod || 'N/A'}
                  </div>
                  {pedido.producto_cant && (
                    <div className="text-[10px] text-purple-700 mt-0.5">
                      Cant: {pedido.producto_cant}
                    </div>
                  )}
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-2 border border-green-200">
                  <div className="text-[9px] text-green-600 font-semibold mb-0.5">Móvil</div>
                  <div className="font-bold text-green-900 text-xs">
                    {(!pedido.movil || Number(pedido.movil) === 0) ? 'Sin Asignar' : `Asignado #${pedido.movil}`}
                  </div>
                </div>
              </div>
              {/* Otros productos (prodsadicionales) */}
              {pedido.prodsadicionales && pedido.prodsadicionales.trim() !== '' && (
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-2 border border-orange-200 mt-2">
                  <div className="text-[9px] text-orange-600 font-semibold mb-0.5">Otros productos</div>
                  <div className="text-[10px] text-orange-900 leading-relaxed">{pedido.prodsadicionales}</div>
                </div>
              )}
              {/* Teléfono y Chofer del Móvil */}
              {!!pedido.movil && Number(pedido.movil) !== 0 && (movilTel || movilChofer) && (
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-2 border border-indigo-200 mt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[9px] text-indigo-600 font-semibold mb-0.5">Móvil #{pedido.movil}</div>
                      {movilChofer && <div className="text-[10px] text-indigo-800 font-medium">{movilChofer}</div>}
                    </div>
                    {movilTel && (
                      <a
                        href={`tel:${movilTel}`}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-200/60 hover:bg-indigo-300/60 rounded-md transition-colors"
                      >
                        <span className="text-xs">📞</span>
                        <span className="text-xs font-bold text-indigo-900">{movilTel}</span>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Obs Pedido y Obs Cliente */}
            {(pedido.pedido_obs || pedido.cliente_obs) && (
              <div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-2 border border-amber-200">
                    <div className="text-[9px] text-amber-600 font-semibold mb-0.5">Obs Pedido</div>
                    <div className="text-[10px] text-amber-900 leading-relaxed">{pedido.pedido_obs || '—'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-2 border border-teal-200">
                    <div className="text-[9px] text-teal-600 font-semibold mb-0.5">Obs Cliente</div>
                    <div className="text-[10px] text-teal-900 leading-relaxed">{pedido.cliente_obs || '—'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Importe */}
            {!!(pedido.imp_bruto || pedido.precio) && (
              <div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-2 border border-emerald-200">
                  <div className="flex justify-between items-center">
                    <div className="text-[9px] text-emerald-600 font-semibold">Total</div>
                    <div className="text-sm font-bold text-emerald-900">
                      {formatPrecio(pedido.imp_bruto || pedido.precio || null)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Obs. Forma de Pago (campana) */}
            {pedido.campana && pedido.campana.trim() !== '' && (
              <div>
                <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-lg p-2 border border-rose-200">
                  <div className="text-[9px] text-rose-600 font-semibold mb-0.5">Obs. Forma de Pago</div>
                  <div className="text-[10px] text-rose-900 leading-relaxed">{pedido.campana}</div>
                </div>
              </div>
            )}



            {/* Fecha */}
            {(pedido.fch_hora_mov || pedido.fch_hora_para || pedido.fch_hora_max_ent_comp) && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Fechas y Horarios</h4>
                <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-2.5 border border-gray-200 space-y-2">
                  {/* Hora de Asignación */}
                  {pedido.fch_hora_mov && (
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-500 font-semibold">Hora Asignación</div>
                        <div className="text-xs font-bold text-gray-900">
                          {format(parseLocalDate(pedido.fch_hora_mov), "dd/MM/yyyy HH:mm", { locale: es })}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Desde - Hasta */}
                  {(pedido.fch_hora_para || pedido.fch_hora_max_ent_comp) && (
                    <div className="grid grid-cols-2 gap-2">
                      {pedido.fch_hora_para && (
                        <div className="bg-white rounded-md p-1.5 border border-gray-200">
                          <div className="text-[9px] text-green-600 font-semibold mb-0.5">Desde</div>
                          <div className="text-[10px] font-bold text-gray-900">
                            {format(parseLocalDate(pedido.fch_hora_para), "dd/MM HH:mm", { locale: es })}
                          </div>
                        </div>
                      )}
                      {pedido.fch_hora_max_ent_comp && (
                        <div className="bg-white rounded-md p-1.5 border border-gray-200">
                          <div className="text-[9px] text-red-600 font-semibold mb-0.5">Hasta</div>
                          <div className="text-[10px] font-bold text-gray-900">
                            {format(parseLocalDate(pedido.fch_hora_max_ent_comp), "dd/MM HH:mm", { locale: es })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
