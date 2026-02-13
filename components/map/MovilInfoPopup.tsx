'use client';

import React, { useState, useEffect } from 'react';
import { MovilData } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface SessionHistorial {
  chofer: string;
  inicio: string;
}

interface SessionData {
  chofer: string | null;
  telefono: string | null;
  fechaInicio: string | null;
  idTerminal: string | null;
  historial: SessionHistorial[];
}

interface MovilInfoPopupProps {
  movil: MovilData | null;
  onClose: () => void;
  onShowAnimation?: () => void;
  onShowPendientes?: () => void;
  selectedMovilesCount?: number;
}

export const MovilInfoPopup: React.FC<MovilInfoPopupProps> = ({ 
  movil, 
  onClose,
  onShowAnimation,
  onShowPendientes,
  selectedMovilesCount = 0
}) => {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  
  // Estado local para pendientes del popup (evita race conditions con setMoviles)
  const [pendientesData, setPendientesData] = useState<{ pedidos: number; servicios: number } | null>(null);
  const [pendientesLoading, setPendientesLoading] = useState(false);

  // Enviar SMS al móvil
  const handleSendSms = async () => {
    if (!smsMessage.trim() || !movil) return;
    setSmsSending(true);
    try {
      // TODO: Integrar con API real de envío SMS
      const res = await fetch(`/api/movil-sms/${movil.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: smsMessage.trim() }),
      });
      if (res.ok) {
        setSmsSent(true);
        setSmsMessage('');
        setTimeout(() => {
          setSmsSent(false);
          setSmsOpen(false);
        }, 2000);
      }
    } catch (err) {
      console.error('Error enviando SMS:', err);
    } finally {
      setSmsSending(false);
    }
  };

  // Fetch session data when popup opens
  useEffect(() => {
    if (!movil) return;

    const fetchSession = async () => {
      setSessionLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/movil-session/${movil.id}?fecha=${today}`);
        if (res.ok) {
          const data = await res.json();
          setSessionData({
            chofer: data.chofer,
            telefono: data.telefono,
            fechaInicio: data.fechaInicio,
            idTerminal: data.idTerminal,
            historial: data.historial || [],
          });
        }
      } catch (err) {
        console.error('Error fetching session data:', err);
      } finally {
        setSessionLoading(false);
      }
    };

    fetchSession();
  }, [movil?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch pendientes data directly in the popup (self-contained, no race conditions)
  useEffect(() => {
    if (!movil) {
      setPendientesData(null);
      return;
    }

    const fetchPendientes = async () => {
      setPendientesLoading(true);
      setPendientesData(null);
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`/api/pedidos-servicios-pendientes/${movil.id}?fecha=${today}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setPendientesData({
              pedidos: data.pedidosPendientes || 0,
              servicios: data.serviciosPendientes || 0,
            });
          } else {
            setPendientesData({ pedidos: 0, servicios: 0 });
          }
        } else {
          setPendientesData({ pedidos: 0, servicios: 0 });
        }
      } catch (err) {
        console.error('Error fetching pendientes:', err);
        setPendientesData({ pedidos: 0, servicios: 0 });
      } finally {
        setPendientesLoading(false);
      }
    };

    fetchPendientes();
  }, [movil?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!movil || !movil.currentPosition) return null;

  const totalPendientes = pendientesData ? (pendientesData.pedidos + pendientesData.servicios) : 0;
  const isLoadingPendientes = pendientesLoading || pendientesData === null;
  const canShowAnimation = selectedMovilesCount === 1;

  // Historial ordenado ascendente por fecha
  const sortedHistorial = sessionData?.historial
    ? [...sessionData.historial].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
    : [];

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
              <div className="flex items-center gap-1.5">
                {/* Botón enviar mensaje */}
                <button
                  onClick={() => { setSmsOpen(!smsOpen); setSmsSent(false); }}
                  className={`w-7 h-7 rounded-full transition-all flex items-center justify-center shadow-md ${
                    smsOpen ? 'bg-green-500 hover:bg-green-600' : 'bg-white bg-opacity-90 hover:bg-white'
                  }`}
                  title="Enviar mensaje al móvil"
                >
                  <svg className={`w-3.5 h-3.5 ${smsOpen ? 'text-white' : 'text-gray-700'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </button>
                {/* Botón cerrar */}
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
          </div>

          {/* Panel de envío de SMS - colapsable */}
          <AnimatePresence>
            {smsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-gray-200"
              >
                <div className="p-3 bg-gradient-to-r from-green-50 to-emerald-50">
                  {smsSent ? (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm font-semibold text-green-700">Mensaje enviado</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        <span className="text-[10px] font-semibold text-green-700">Enviar mensaje al móvil #{movil.id}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={smsMessage}
                          onChange={(e) => setSmsMessage(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !smsSending) handleSendSms(); }}
                          placeholder="Escribe tu mensaje..."
                          maxLength={160}
                          className="flex-1 text-xs border border-green-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent bg-white placeholder-gray-400"
                          disabled={smsSending}
                        />
                        <button
                          onClick={handleSendSms}
                          disabled={!smsMessage.trim() || smsSending}
                          className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center gap-1 shadow-md hover:shadow-lg"
                        >
                          {smsSending ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-400">{smsMessage.length}/160 caracteres</span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Contenido */}
          <div className="p-3 space-y-2.5">
            {/* Estado Actual e Id Terminal */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Estado Actual</h4>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const isNoActivo = movil.estadoNro === 3;
                  const isBajaMomentanea = movil.estadoNro === 4;
                  const hasSpecialState = isNoActivo || isBajaMomentanea;
                  return (
                    <div className={`bg-gradient-to-br rounded-lg p-2 border ${
                      isNoActivo ? 'from-red-50 to-red-100 border-red-300' 
                      : isBajaMomentanea ? 'from-orange-50 to-orange-100 border-orange-300'
                      : 'from-blue-50 to-blue-100 border-blue-200'
                    }`}>
                      <div className={`text-[9px] font-semibold mb-0.5 ${
                        isNoActivo ? 'text-red-600' : isBajaMomentanea ? 'text-orange-600' : 'text-blue-600'
                      }`}>Estado</div>
                      <div className={`font-bold text-xs flex items-center gap-1 ${
                        isNoActivo ? 'text-red-800' : isBajaMomentanea ? 'text-orange-800' : 'text-blue-900'
                      }`}>
                        {isNoActivo && (
                          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                          </svg>
                        )}
                        {isBajaMomentanea && (
                          <svg className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                          </svg>
                        )}
                        {isNoActivo ? 'NO ACTIVO' : isBajaMomentanea ? 'BAJA MOMENTÁNEA' : (movil.estadoDesc || 'Sin estado')}
                      </div>
                    </div>
                  );
                })()}
                <div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-lg p-2 border border-gray-200">
                  <div className="text-[9px] text-gray-500 font-semibold mb-0.5">Id Terminal</div>
                  <div className="font-bold text-gray-800 text-[10px] font-mono truncate" title={movil.terminalId || 'N/A'}>{movil.terminalId || 'N/A'}</div>
                </div>
              </div>
            </div>

            {/* Datos de Sesión del Chofer */}
            <div>
              <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sesión del Chofer</h4>
              {sessionLoading ? (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">Cargando datos de sesión...</span>
                </div>
              ) : sessionData?.chofer ? (
                <div className="space-y-2">
                  {/* Chofer actual + Teléfono */}
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-2.5 border border-indigo-200">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-indigo-600 font-semibold">Chofer</div>
                        <div className="font-bold text-indigo-900 text-xs truncate">{sessionData.chofer}</div>
                      </div>
                      {sessionData.telefono && (
                        <div className="text-right flex-shrink-0">
                          <div className="text-[9px] text-gray-500">📞 Teléfono</div>
                          <div className="text-[10px] font-semibold text-gray-800">{sessionData.telefono}</div>
                        </div>
                      )}
                    </div>
                    {/* Hora de inicio de sesión */}
                    {sessionData.fechaInicio && (
                      <div className="mt-2 pt-2 border-t border-indigo-200 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-[9px] text-indigo-500">Inicio de sesión:</span>
                        <span className="text-[10px] font-bold text-indigo-800">
                          {format(new Date(sessionData.fechaInicio), "HH:mm", { locale: es })}
                        </span>
                        <span className="text-[9px] text-indigo-400">
                          ({format(new Date(sessionData.fechaInicio), "dd/MM/yyyy", { locale: es })})
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Historial de sesiones - Colapsable */}
                  {sortedHistorial.length > 1 && (
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => setHistorialOpen(!historialOpen)}
                        className="w-full flex items-center justify-between px-2.5 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-[10px] font-semibold text-gray-600">
                            Sesiones del día
                          </span>
                          <span className="text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">
                            {sortedHistorial.length}
                          </span>
                        </div>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${historialOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <AnimatePresence>
                        {historialOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-gray-200">
                              <table className="w-full text-[10px]">
                                <thead>
                                  <tr className="bg-gray-50">
                                    <th className="text-left py-1.5 px-2.5 text-gray-500 font-semibold">#</th>
                                    <th className="text-left py-1.5 px-2.5 text-gray-500 font-semibold">Chofer</th>
                                    <th className="text-right py-1.5 px-2.5 text-gray-500 font-semibold">Hora Inicio</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedHistorial.map((h, idx) => (
                                    <tr
                                      key={idx}
                                      className={`border-t border-gray-100 ${
                                        idx === sortedHistorial.length - 1
                                          ? 'bg-indigo-50'
                                          : idx % 2 === 0
                                          ? 'bg-white'
                                          : 'bg-gray-50'
                                      }`}
                                    >
                                      <td className="py-1.5 px-2.5 text-gray-400 font-mono">{idx + 1}</td>
                                      <td className="py-1.5 px-2.5 font-medium text-gray-800 truncate max-w-[160px]">
                                        {h.chofer}
                                        {idx === sortedHistorial.length - 1 && (
                                          <span className="ml-1 text-[8px] bg-indigo-200 text-indigo-700 px-1 py-0.5 rounded font-bold">
                                            ACTUAL
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 px-2.5 text-right font-mono text-gray-600">
                                        {format(new Date(h.inicio), "HH:mm", { locale: es })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-200 text-center">
                  <span className="text-[10px] text-gray-400">Sin datos de sesión disponibles</span>
                </div>
              )}
            </div>

            {/* Pedidos y Servicios Pendientes */}
            {(totalPendientes > 0 || isLoadingPendientes) && (
              <div>
                <h4 className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Pendientes del Día</h4>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-2.5 border-2 border-orange-300">
                  {isLoadingPendientes ? (
                    <div className="text-center py-2">
                      <div className="animate-spin inline-block w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full" />
                      <div className="text-[9px] text-gray-500 mt-1">Cargando...</div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="text-center bg-white bg-opacity-60 rounded-lg p-1.5">
                          <div className="text-xl font-bold text-orange-600">{pendientesData?.pedidos ?? 0}</div>
                          <div className="text-[9px] text-gray-700 font-semibold flex items-center justify-center gap-0.5">
                            <span>📦</span>
                            <span>Pedidos</span>
                          </div>
                        </div>
                        <div className="text-center bg-white bg-opacity-60 rounded-lg p-1.5">
                          <div className="text-xl font-bold text-red-600">{pendientesData?.servicios ?? 0}</div>
                          <div className="text-[9px] text-gray-700 font-semibold flex items-center justify-center gap-0.5">
                            <span>🔧</span>
                            <span>Servicios</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-[9px] text-center text-gray-600 bg-white bg-opacity-60 rounded-lg py-1 px-2">
                        💡 Visibles en el mapa como puntos naranjas y rojos
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Timestamp - Último envío de Coordenadas */}
            <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-2.5 border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 font-semibold">Último envío de Coordenadas</div>
                    <div className="text-xs font-bold text-gray-900">
                      {format(new Date(movil.currentPosition.fechaInsLog), "HH:mm:ss", { locale: es })}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-gray-500">Fecha</div>
                  <div className="text-[10px] font-semibold text-gray-700">
                    {format(new Date(movil.currentPosition.fechaInsLog), "dd/MM/yyyy", { locale: es })}
                  </div>
                </div>
              </div>
            </div>

            {/* Botones de acción */}
            <div className={`grid gap-2 pt-1 ${canShowAnimation && (totalPendientes > 0 || isLoadingPendientes) ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* Botón para ver animación del recorrido - Solo si hay 1 móvil seleccionado */}
              {onShowAnimation && canShowAnimation && (
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
              {(totalPendientes > 0 || isLoadingPendientes) && onShowPendientes && (
                <button
                  onClick={onShowPendientes}
                  disabled={isLoadingPendientes}
                  className="py-2.5 px-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:opacity-60 text-white rounded-lg font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-1.5 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <span>{isLoadingPendientes ? 'Cargando...' : `Pendientes (${totalPendientes})`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
