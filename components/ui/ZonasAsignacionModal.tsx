'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, PedidoSupabase } from '@/types';

// ========== Tipos internos ==========
interface Zona {
  zona_id: number;
  zona_nro?: number;
  zona_desc?: string;
  [key: string]: any;
}

type TipoAsignacion = 'prioridad' | 'transito';

interface AsignacionMovil {
  movilId: number;
  tipo: TipoAsignacion;
}

// Mapa: zonaId → array de asignaciones
type AsignacionesMap = Record<number, AsignacionMovil[]>;

// ========== Colores de zona ==========
const ZONA_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // emerald
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#14B8A6', // teal
  '#6366F1', // indigo
];

function getZonaColor(index: number) {
  return ZONA_COLORS[index % ZONA_COLORS.length];
}

// ========== Props ==========
interface ZonasAsignacionModalProps {
  isOpen: boolean;
  onClose: () => void;
  moviles: MovilData[];
  pedidos: PedidoSupabase[];
}

export default function ZonasAsignacionModal({ isOpen, onClose, moviles, pedidos }: ZonasAsignacionModalProps) {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [loadingZonas, setLoadingZonas] = useState(false);
  const [selectedZonaId, setSelectedZonaId] = useState<number | null>(null);
  const [asignaciones, setAsignaciones] = useState<AsignacionesMap>({});
  const [searchMovil, setSearchMovil] = useState('');
  const [draggedMovilId, setDraggedMovilId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<TipoAsignacion | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref para el drag ghost custom
  const dragGhostRef = useRef<HTMLDivElement | null>(null);

  // ========== Fetch zonas ==========
  useEffect(() => {
    if (!isOpen) return;
    setLoadingZonas(true);
    setError(null);
    fetch('/api/zonas')
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data) {
          setZonas(res.data);
          // Auto-seleccionar primera zona
          if (res.data.length > 0 && !selectedZonaId) {
            setSelectedZonaId(res.data[0].zona_id);
          }
        } else {
          setError('No se pudieron cargar las zonas');
        }
      })
      .catch(() => setError('Error de conexión al cargar zonas'))
      .finally(() => setLoadingZonas(false));
  }, [isOpen]);

  // ========== Moviles filtrados por búsqueda ==========
  const filteredMoviles = useMemo(() => {
    const search = searchMovil.toLowerCase().trim();
    let list = moviles.filter(m => {
      // No mostrar móviles inactivos / baja
      if (m.estadoNro === 3 || m.estadoNro === 4) return false;
      return true;
    });
    if (search) {
      list = list.filter(m =>
        m.id.toString().includes(search) ||
        m.name.toLowerCase().includes(search) ||
        (m.matricula?.toLowerCase().includes(search))
      );
    }
    return list.sort((a, b) => a.id - b.id);
  }, [moviles, searchMovil]);

  // ========== Moviles ya asignados en la zona seleccionada ==========
  const asignadosEnZona = useMemo(() => {
    if (!selectedZonaId) return [];
    return asignaciones[selectedZonaId] || [];
  }, [asignaciones, selectedZonaId]);

  const movilesEnPrioridad = useMemo(() => asignadosEnZona.filter(a => a.tipo === 'prioridad'), [asignadosEnZona]);
  const movilesEnTransito = useMemo(() => asignadosEnZona.filter(a => a.tipo === 'transito'), [asignadosEnZona]);

  // IDs de todos los moviles asignados en CUALQUIER zona
  const allAsignadosIds = useMemo(() => {
    const ids = new Set<number>();
    for (const zonaAsigns of Object.values(asignaciones)) {
      for (const a of zonaAsigns) ids.add(a.movilId);
    }
    return ids;
  }, [asignaciones]);

  // Moviles disponibles (no asignados a ninguna zona)
  const movilesDisponibles = useMemo(() => {
    return filteredMoviles.filter(m => !allAsignadosIds.has(m.id));
  }, [filteredMoviles, allAsignadosIds]);

  // ========== Conteo de pedidos por zona ==========
  const pedidosPorZona = useMemo(() => {
    const map: Record<number, number> = {};
    for (const p of pedidos) {
      if (p.zona_nro) {
        map[p.zona_nro] = (map[p.zona_nro] || 0) + 1;
      }
    }
    return map;
  }, [pedidos]);

  // ========== Drag and Drop handlers ==========
  const handleDragStart = useCallback((e: React.DragEvent, movilId: number) => {
    setDraggedMovilId(movilId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', movilId.toString());
    
    // Custom drag image
    const ghost = document.createElement('div');
    ghost.className = 'bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-medium shadow-xl';
    ghost.textContent = `Móvil ${movilId}`;
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 15);
    dragGhostRef.current = ghost;
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedMovilId(null);
    setDropTarget(null);
    // Cleanup ghost
    if (dragGhostRef.current) {
      document.body.removeChild(dragGhostRef.current);
      dragGhostRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tipo: TipoAsignacion) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(tipo);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, tipo: TipoAsignacion) => {
    e.preventDefault();
    setDropTarget(null);

    const movilIdStr = e.dataTransfer.getData('text/plain');
    const movilId = parseInt(movilIdStr, 10);
    if (isNaN(movilId) || !selectedZonaId) return;

    setAsignaciones(prev => {
      const zonaAsigns = [...(prev[selectedZonaId] || [])];
      // Si ya está asignado en esta zona, mover de categoría
      const existing = zonaAsigns.findIndex(a => a.movilId === movilId);
      if (existing >= 0) {
        zonaAsigns[existing] = { movilId, tipo };
      } else {
        // Remover de otras zonas si existía
        const newMap = { ...prev };
        for (const zId of Object.keys(newMap)) {
          newMap[Number(zId)] = newMap[Number(zId)].filter(a => a.movilId !== movilId);
        }
        newMap[selectedZonaId] = [...(newMap[selectedZonaId] || []), { movilId, tipo }];
        return newMap;
      }
      return { ...prev, [selectedZonaId]: zonaAsigns };
    });

    setDraggedMovilId(null);
  }, [selectedZonaId]);

  // ========== Remover asignación ==========
  const handleRemoveAsignacion = useCallback((movilId: number) => {
    if (!selectedZonaId) return;
    setAsignaciones(prev => ({
      ...prev,
      [selectedZonaId]: (prev[selectedZonaId] || []).filter(a => a.movilId !== movilId),
    }));
  }, [selectedZonaId]);

  // ========== Guardar ==========
  const handleGuardar = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // TODO: Implementar endpoint de guardado real
      // Por ahora simular delay
      await new Promise(res => setTimeout(res, 500));
      console.log('Asignaciones guardadas:', asignaciones);
      onClose();
    } catch {
      setError('Error al guardar asignaciones');
    } finally {
      setSaving(false);
    }
  }, [asignaciones, onClose]);

  // ========== Helper: buscar MovilData por ID ==========
  const getMovil = useCallback((movilId: number) => {
    return moviles.find(m => m.id === movilId);
  }, [moviles]);

  // ========== Zona seleccionada ==========
  const selectedZona = useMemo(() => zonas.find(z => z.zona_id === selectedZonaId), [zonas, selectedZonaId]);

  // ========== Total asignaciones por zona ==========
  const totalAsigPorZona = useCallback((zonaId: number) => {
    return (asignaciones[zonaId] || []).length;
  }, [asignaciones]);

  // ========== Reset on close ==========
  useEffect(() => {
    if (!isOpen) {
      setSearchMovil('');
      setDraggedMovilId(null);
      setDropTarget(null);
      setError(null);
    }
  }, [isOpen]);

  // ========== Render movil chip (draggable) ==========
  const renderMovilChip = (movilData: MovilData, inDropZone = false, tipo?: TipoAsignacion) => {
    const isDragging = draggedMovilId === movilData.id;
    return (
      <div
        key={movilData.id}
        draggable
        onDragStart={(e) => handleDragStart(e, movilData.id)}
        onDragEnd={handleDragEnd}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing
          transition-all duration-200 select-none group
          ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
          ${inDropZone
            ? 'bg-gray-700/50 hover:bg-gray-600/50 border border-gray-600'
            : 'bg-gray-700/60 hover:bg-gray-600/60 border border-gray-600/50'
          }
        `}
      >
        {/* Grip icon */}
        <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
        </svg>

        {/* Color dot */}
        <div
          className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
          style={{ backgroundColor: movilData.color }}
        />

        {/* Name */}
        <span className="text-sm font-medium text-gray-200 truncate">
          {movilData.name || `Móvil ${movilData.id}`}
        </span>

        {/* ID badge */}
        <span className="text-[10px] font-mono text-gray-400 bg-gray-800/50 px-1.5 py-0.5 rounded ml-auto flex-shrink-0">
          #{movilData.id}
        </span>

        {/* Remove button if in drop zone */}
        {inDropZone && (
          <button
            onClick={(e) => { e.stopPropagation(); handleRemoveAsignacion(movilData.id); }}
            className="ml-1 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
            title="Quitar asignación"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  // ========== Render drop zone ==========
  const renderDropZone = (tipo: TipoAsignacion, label: string, items: AsignacionMovil[], color: string) => {
    const isOver = dropTarget === tipo;
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

        {/* Drop area */}
        <div
          onDragOver={(e) => handleDragOver(e, tipo)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, tipo)}
          className={`
            flex-1 min-h-[120px] rounded-xl border-2 border-dashed p-3 transition-all duration-200 overflow-y-auto
            ${isOver
              ? `${tipo === 'prioridad' ? 'border-amber-400 bg-amber-400/10' : 'border-cyan-400 bg-cyan-400/10'} scale-[1.01]`
              : 'border-gray-600/50 bg-gray-800/30 hover:border-gray-500/50'
            }
          `}
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              <span className="text-xs">Arrastrá móviles aquí</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map(a => {
                const movilData = getMovil(a.movilId);
                if (!movilData) return null;
                return renderMovilChip(movilData, true, tipo);
              })}
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
            id="tour-modal-zonas"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ========== Header ========== */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-gray-900/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Asignación de Móviles a Zonas</h2>
                  <p className="text-xs text-gray-400">Arrastrá los móviles para asignarlos a Prioridad o Tránsito en cada zona</p>
                </div>
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

            {/* ========== Error banner ========== */}
            {error && (
              <div className="mx-6 mt-3 px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* ========== Body: 3 panels ========== */}
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
                      const count = totalAsigPorZona(zona.zona_id);
                      const pedidosCount = pedidosPorZona[zona.zona_nro || zona.zona_id] || 0;
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
                            {pedidosCount > 0 && (
                              <div className="text-[10px] text-gray-500">
                                {pedidosCount} pedido{pedidosCount !== 1 ? 's' : ''}
                              </div>
                            )}
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

              {/* ===== Panel central: DROP ZONES ===== */}
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
                        {asignadosEnZona.length} móvil{asignadosEnZona.length !== 1 ? 'es' : ''} asignado{asignadosEnZona.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Two columns: Prioridad & Tránsito */}
                    <div className="flex-1 flex gap-4 min-h-0">
                      {renderDropZone('prioridad', 'Prioridad', movilesEnPrioridad, 'amber')}
                      {renderDropZone('transito', 'Tránsito', movilesEnTransito, 'cyan')}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      <p className="text-sm">Seleccioná una zona para comenzar</p>
                    </div>
                  </div>
                )}
              </div>

              {/* ===== Panel derecho: MÓVILES DISPONIBLES ===== */}
              <div className="w-60 flex-shrink-0 border-l border-gray-700/50 flex flex-col bg-gray-850">
                <div className="px-4 py-3 border-b border-gray-700/30">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Móviles Disponibles
                    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full ml-auto">
                      {movilesDisponibles.length}
                    </span>
                  </h3>

                  {/* Search */}
                  <div className="relative">
                    <svg className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Buscar móvil..."
                      value={searchMovil}
                      onChange={(e) => setSearchMovil(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20"
                    />
                  </div>
                </div>

                {/* Moviles list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {movilesDisponibles.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 text-xs">
                      {searchMovil ? 'Sin resultados' : 'Todos los móviles fueron asignados'}
                    </div>
                  ) : (
                    movilesDisponibles.map(m => renderMovilChip(m))
                  )}
                </div>
              </div>
            </div>

            {/* ========== Footer ========== */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700/50 bg-gray-900/80">
              <div className="text-xs text-gray-500">
                {Object.values(asignaciones).reduce((sum, arr) => sum + arr.length, 0)} móvil{Object.values(asignaciones).reduce((sum, arr) => sum + arr.length, 0) !== 1 ? 'es' : ''} asignado{Object.values(asignaciones).reduce((sum, arr) => sum + arr.length, 0) !== 1 ? 's' : ''} en total
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleGuardar}
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 rounded-lg transition-all shadow-lg shadow-teal-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Guardar asignaciones
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
