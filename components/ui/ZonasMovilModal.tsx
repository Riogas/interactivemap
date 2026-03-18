'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MovilZonaRecord {
  movil_id: string;
  zona_id: number;
  prioridad_o_transito: number; // 1=prioridad, 2=tránsito
  tipo_de_servicio: string;     // 'NOCTURNO', 'URGENTE', 'SERVICE', etc.
  escenario_id: number;
  activa: boolean;
}

interface ZonaInfo {
  zona_id: number;
  nombre: string | null;
}

interface ZonasMovilModalProps {
  isOpen: boolean;
  onClose: () => void;
  movilId: number;
  movilName: string;
  movilColor: string;
  zonaRecords: MovilZonaRecord[];
  zonas: ZonaInfo[];
}

const TIPO_COLORS: Record<string, string> = {
  'URGENTE': 'bg-red-500/20 text-red-300 border-red-500/30',
  'NOCTURNO': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  'SERVICE': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const TIPO_DOT_COLORS: Record<string, string> = {
  'URGENTE': 'bg-red-400',
  'NOCTURNO': 'bg-indigo-400',
  'SERVICE': 'bg-amber-400',
};

export default function ZonasMovilModal({
  isOpen,
  onClose,
  movilId,
  movilName,
  movilColor,
  zonaRecords,
  zonas,
}: ZonasMovilModalProps) {
  const [tipoFilter, setTipoFilter] = useState<string>('all');

  // Zones for this movil
  const movilZonas = useMemo(() => {
    return zonaRecords.filter(r => String(r.movil_id) === String(movilId));
  }, [zonaRecords, movilId]);

  // Available service types
  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    movilZonas.forEach(r => {
      if (r.tipo_de_servicio) set.add(r.tipo_de_servicio.toUpperCase());
    });
    return [...set].sort();
  }, [movilZonas]);

  // Filtered records
  const filtered = useMemo(() => {
    if (tipoFilter === 'all') return movilZonas;
    return movilZonas.filter(r => (r.tipo_de_servicio || '').toUpperCase() === tipoFilter);
  }, [movilZonas, tipoFilter]);

  // Zone name lookup
  const getZonaNombre = useCallback((zonaId: number) => {
    const z = zonas.find(z => z.zona_id === zonaId);
    return z?.nombre || null;
  }, [zonas]);

  // Stats per tipo
  const statsByTipo = useMemo(() => {
    const map: Record<string, number> = {};
    movilZonas.forEach(r => {
      const tipo = (r.tipo_de_servicio || 'SIN TIPO').toUpperCase();
      map[tipo] = (map[tipo] || 0) + 1;
    });
    return map;
  }, [movilZonas]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-full max-w-lg bg-gray-900 rounded-xl shadow-2xl border border-gray-700/50 flex flex-col overflow-hidden"
            style={{ maxHeight: '80vh' }}
          >
            {/* Header */}
            <div
              className="px-5 py-3.5 text-white relative overflow-hidden flex-shrink-0"
              style={{ backgroundColor: movilColor }}
            >
              <div className="absolute inset-0 bg-black/15" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                    <span className="text-base">📍</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Zonas de {movilName}</h3>
                    <p className="text-[10px] opacity-80">
                      {movilZonas.length} zona{movilZonas.length !== 1 ? 's' : ''} asignada{movilZonas.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 transition-all flex items-center justify-center"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="px-5 py-3 border-b border-gray-700/50 bg-gray-800/50 flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mr-1">Tipo:</span>
                <button
                  onClick={() => setTipoFilter('all')}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                    tipoFilter === 'all'
                      ? 'bg-white/15 text-white border-white/30'
                      : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  Todos <span className="ml-1 opacity-70">({movilZonas.length})</span>
                </button>
                {tiposDisponibles.map(tipo => (
                  <button
                    key={tipo}
                    onClick={() => setTipoFilter(tipo === tipoFilter ? 'all' : tipo)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                      tipoFilter === tipo
                        ? (TIPO_COLORS[tipo] || 'bg-teal-500/20 text-teal-300 border-teal-500/30')
                        : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                      tipoFilter === tipo
                        ? (TIPO_DOT_COLORS[tipo] || 'bg-teal-400')
                        : 'bg-gray-600'
                    }`} />
                    {tipo}
                    <span className="ml-1.5 opacity-70">({statsByTipo[tipo] || 0})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Zone list */}
            <div className="flex-1 overflow-auto min-h-0 p-2">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <p className="text-sm">No hay zonas asignadas</p>
                  {tipoFilter !== 'all' && (
                    <p className="text-xs mt-1 text-gray-600">para el filtro seleccionado</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((record, idx) => {
                    const zonaNombre = getZonaNombre(record.zona_id);
                    const esPrioridad = record.prioridad_o_transito === 1;
                    const esTransito = record.prioridad_o_transito === 2;
                    const tipo = (record.tipo_de_servicio || '').toUpperCase();

                    return (
                      <div
                        key={`${record.zona_id}-${record.tipo_de_servicio}-${idx}`}
                        className={`rounded-lg border transition-colors ${
                          esPrioridad
                            ? 'bg-green-500/10 border-green-500/30'
                            : esTransito
                            ? 'bg-blue-500/10 border-blue-500/30'
                            : 'bg-gray-800/50 border-gray-700/50'
                        }`}
                      >
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            {/* Zone number badge */}
                            <div className="w-10 h-10 rounded-lg bg-gray-700/60 flex items-center justify-center flex-shrink-0">
                              <span className="text-sm font-bold text-white">{record.zona_id}</span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-100">
                                Zona {record.zona_id}
                                {zonaNombre && (
                                  <span className="text-gray-400 font-normal ml-1.5 text-xs">
                                    {zonaNombre}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {/* Service type badge */}
                                {tipo && (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                    TIPO_COLORS[tipo] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
                                  }`}>
                                    {tipo}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Priority / Transit badge */}
                          <div className="flex-shrink-0">
                            {esPrioridad ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/25 text-green-300">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                                Prioridad
                              </span>
                            ) : esTransito ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/25 text-blue-300">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Tránsito
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">
                                Sin asignar
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700/50 bg-gray-900/80 flex-shrink-0">
              <div className="text-xs text-gray-500">
                {filtered.length} de {movilZonas.length} zona{movilZonas.length !== 1 ? 's' : ''}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
