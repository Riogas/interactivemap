'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData } from '@/types';
import type { MovilZonaRecord } from '@/components/map/MovilesZonasLayer';

// ========== Tipos internos ==========
interface Zona {
  zona_id: number;
  zona_nro?: number;
  zona_desc?: string;
  [key: string]: any;
}

/** Estados de móvil que se muestran tachados (inactivos) */
const ESTADOS_TACHADOS = new Set([3, 5, 15]);

/** Opciones fijas de tipo de servicio */
const TIPOS_SERVICIO = ['URGENTE', 'SERVICE', 'NOCTURNO'] as const;

// ========== Colores de zona ==========
const ZONA_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1',
];

function getZonaColor(index: number) {
  return ZONA_COLORS[index % ZONA_COLORS.length];
}

// ========== Props ==========
interface ZonaMovilesViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Zona ID a preseleccionar al abrir */
  initialZonaId?: number | null;
  /** Todos los móviles cargados */
  moviles: MovilData[];
  /** Registros crudos de moviles_zonas */
  movilesZonasData: MovilZonaRecord[];
}

export default function ZonaMovilesViewModal({
  isOpen,
  onClose,
  initialZonaId,
  moviles,
  movilesZonasData,
}: ZonaMovilesViewModalProps) {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [loadingZonas, setLoadingZonas] = useState(false);
  const [selectedZonaId, setSelectedZonaId] = useState<number | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string>('URGENTE');

  // ========== Fetch zonas ==========
  useEffect(() => {
    if (!isOpen) return;
    setLoadingZonas(true);
    fetch('/api/zonas')
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data) {
          setZonas(res.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingZonas(false));
  }, [isOpen]);

  // ========== Auto-seleccionar zona inicial cuando llegan los datos ==========
  useEffect(() => {
    if (!isOpen || zonas.length === 0) return;
    if (initialZonaId) {
      setSelectedZonaId(initialZonaId);
    } else {
      setSelectedZonaId(zonas[0].zona_id);
    }
  }, [isOpen, zonas, initialZonaId]);

  // ========== Mapa movil_id → estadoNro (desde API, cubre TODOS los moviles) ==========
  const [allMovilEstados, setAllMovilEstados] = useState<Map<string, number>>(new Map());
  
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/moviles-extended')
      .then(r => r.json())
      .then(res => {
        if (res.success && Array.isArray(res.data)) {
          const m = new Map<string, number>();
          for (const movil of res.data) {
            if (movil.estadoNro !== undefined && movil.estadoNro !== null) {
              m.set(String(movil.nro), movil.estadoNro);
            }
          }
          setAllMovilEstados(m);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Combinar: primero los de la API (completos), luego override con los del prop moviles
  const movilEstadosMap = useMemo(() => {
    const m = new Map<string, number>(allMovilEstados);
    for (const movil of moviles) {
      if (movil.estadoNro !== undefined && movil.estadoNro !== null) {
        m.set(String(movil.id), movil.estadoNro);
      }
    }
    return m;
  }, [moviles, allMovilEstados]);

  // ========== Filtrar registros por tipo de servicio ==========
  const filteredData = useMemo(() => {
    return movilesZonasData.filter(
      mz => (mz.tipo_de_servicio || '').toUpperCase() === serviceFilter.toUpperCase()
    );
  }, [movilesZonasData, serviceFilter]);

  // ========== Asignaciones por zona (desde filteredData) ==========
  const asignacionesPorZona = useMemo(() => {
    const map = new Map<number, { prioridad: MovilZonaRecord[]; transito: MovilZonaRecord[] }>();
    for (const mz of filteredData) {
      const existing = map.get(mz.zona_id) || { prioridad: [], transito: [] };
      if (mz.prioridad_o_transito === 1) {
        existing.prioridad.push(mz);
      } else {
        existing.transito.push(mz);
      }
      map.set(mz.zona_id, existing);
    }
    return map;
  }, [filteredData]);

  // ========== Conteo total por zona (para badge) ==========
  const countPorZona = useCallback((zonaId: number) => {
    const data = asignacionesPorZona.get(zonaId);
    if (!data) return 0;
    return data.prioridad.length + data.transito.length;
  }, [asignacionesPorZona]);

  // ========== Zona seleccionada ==========
  const selectedZona = useMemo(() => zonas.find(z => z.zona_id === selectedZonaId), [zonas, selectedZonaId]);
  const selectedAsignaciones = useMemo(() => {
    if (!selectedZonaId) return { prioridad: [], transito: [] };
    return asignacionesPorZona.get(selectedZonaId) || { prioridad: [], transito: [] };
  }, [selectedZonaId, asignacionesPorZona]);

  // ========== Helper: buscar MovilData por ID ==========
  const getMovil = useCallback((movilId: string) => {
    return moviles.find(m => String(m.id) === String(movilId));
  }, [moviles]);

  // ========== Reset on close ==========
  useEffect(() => {
    if (!isOpen) {
      setSelectedZonaId(null);
      setServiceFilter('URGENTE');
    }
  }, [isOpen]);

  // ========== Render movil chip (read-only, tachado si estado 3/5/15) ==========
  const renderMovilChip = (record: MovilZonaRecord) => {
    const movilData = getMovil(record.movil_id);
    const estado = movilEstadosMap.get(String(record.movil_id));
    const isTachado = estado !== undefined && ESTADOS_TACHADOS.has(estado);

    return (
      <div
        key={record.movil_id}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg
          ${isTachado
            ? 'bg-gray-800/60 border border-gray-700/40 opacity-60'
            : 'bg-gray-700/50 border border-gray-600'
          }
        `}
      >
        {/* Color dot */}
        <div
          className={`w-3 h-3 rounded-full flex-shrink-0 border border-white/20 ${isTachado ? 'opacity-40' : ''}`}
          style={{ backgroundColor: movilData?.color || '#6b7280' }}
        />

        {/* Name - tachado si corresponde */}
        <span className={`text-sm font-medium truncate ${isTachado ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
          {movilData?.name || `Móvil ${record.movil_id}`}
        </span>

        {/* ID badge */}
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ml-auto flex-shrink-0 ${isTachado ? 'text-gray-600 bg-gray-800/30' : 'text-gray-400 bg-gray-800/50'}`}>
          #{record.movil_id}
        </span>

        {/* Estado badge si tachado */}
        {isTachado && (
          <span className="text-[9px] font-medium text-red-400/70 bg-red-500/10 px-1.5 py-0.5 rounded flex-shrink-0">
            Est.{estado}
          </span>
        )}
      </div>
    );
  };

  // ========== Render column (prioridad o transito) ==========
  const renderColumn = (tipo: 'prioridad' | 'transito', label: string, items: MovilZonaRecord[], color: string) => {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2.5 h-2.5 rounded-full ${tipo === 'prioridad' ? 'bg-amber-400' : 'bg-cyan-400'}`} />
          <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{label}</h4>
          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full ml-auto">
            {items.length}
          </span>
        </div>

        {/* List area */}
        <div className="flex-1 min-h-[120px] rounded-xl border border-gray-600/30 bg-gray-800/30 p-3 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H4" />
              </svg>
              <span className="text-xs">Sin móviles asignados</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map(record => renderMovilChip(record))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ========== Header ========== */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-gray-900/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Móviles por Zona</h2>
                  <p className="text-xs text-gray-400">Visualización de asignaciones de móviles en cada zona</p>
                </div>
              </div>

              {/* Filtro tipo servicio */}
              <div className="flex items-center gap-2 mr-4">
                <span className="text-xs text-gray-400 font-medium">Tipo Servicio:</span>
                <select
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-1.5 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20"
                >
                  {TIPOS_SERVICIO.map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-700/50 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ========== Body: 2 panels (zonas + moviles) ========== */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* ===== Panel izquierdo: ZONAS ===== */}
              <div className="w-56 flex-shrink-0 border-r border-gray-700/50 flex flex-col bg-gray-850">
                <div className="px-4 py-3 border-b border-gray-700/30">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Zonas
                  </h3>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                  {loadingZonas ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-400" />
                    </div>
                  ) : zonas.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm px-4">
                      No hay zonas configuradas
                    </div>
                  ) : (
                    zonas.map((zona, index) => {
                      const isSelected = zona.zona_id === selectedZonaId;
                      const count = countPorZona(zona.zona_id);
                      const zonaColor = getZonaColor(index);
                      
                      return (
                        <button
                          key={zona.zona_id}
                          onClick={() => setSelectedZonaId(zona.zona_id)}
                          className={`
                            w-full text-left px-4 py-3 flex items-center gap-3 transition-all duration-150
                            ${isSelected
                              ? 'bg-gray-700/60 border-l-3 border-l-teal-400'
                              : 'hover:bg-gray-800/50 border-l-3 border-l-transparent'
                            }
                          `}
                        >
                          {/* Color indicator */}
                          <div
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: zonaColor }}
                          />

                          {/* Zona info */}
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                              {zona.zona_desc || `Zona ${zona.zona_nro || zona.zona_id}`}
                            </div>
                          </div>

                          {/* Counter badge */}
                          {count > 0 && (
                            <span className="bg-teal-500/20 text-teal-300 text-xs font-bold px-2 py-0.5 rounded-full">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ===== Panel central: Prioridad & Tránsito ===== */}
              <div className="flex-1 flex flex-col min-w-0 p-5 overflow-hidden">
                {selectedZona ? (
                  <>
                    {/* Selected zona header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: getZonaColor(zonas.findIndex(z => z.zona_id === selectedZonaId)) }}
                      />
                      <h3 className="text-base font-bold text-white">
                        {selectedZona.zona_desc || `Zona ${selectedZona.zona_nro || selectedZona.zona_id}`}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {selectedAsignaciones.prioridad.length + selectedAsignaciones.transito.length} móvil{(selectedAsignaciones.prioridad.length + selectedAsignaciones.transito.length) !== 1 ? 'es' : ''} asignado{(selectedAsignaciones.prioridad.length + selectedAsignaciones.transito.length) !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Two columns: Prioridad & Tránsito */}
                    <div className="flex-1 flex gap-4 min-h-0">
                      {renderColumn('prioridad', 'Prioridad', selectedAsignaciones.prioridad, 'amber')}
                      {renderColumn('transito', 'Tránsito', selectedAsignaciones.transito, 'cyan')}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      <p className="text-sm">Seleccioná una zona para ver sus móviles</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ========== Footer ========== */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700/50 bg-gray-900/80">
              <div className="text-xs text-gray-500">
                {filteredData.length} asignación{filteredData.length !== 1 ? 'es' : ''} ({serviceFilter})
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
