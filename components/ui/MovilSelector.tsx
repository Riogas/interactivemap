'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, MovilFilters, ServiceFilters, PedidoFilters, PedidoSupabase, CustomMarker } from '@/types';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import clsx from 'clsx';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import FilterBar from './FilterBar';
import { VirtualList } from './VirtualList';
import MapGuideModal from './MapGuideModal';

interface MovilSelectorProps {
  moviles: MovilData[];
  selectedMoviles: number[];
  onToggleMovil: (movilId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  pedidos?: PedidoSupabase[]; // Nueva prop para pedidos
  onPedidoClick?: (pedidoId: number) => void; // Callback para click en pedido
  puntosInteres?: CustomMarker[]; // Nueva prop para puntos de interés
  onPuntoInteresClick?: (puntoId: string) => void; // Callback para click en punto
  onFiltersChange?: (filters: MovilFilters) => void; // 🆕 Callback para comunicar filtros activos
}

// Definir las categorías del árbol
type CategoryKey = 'moviles' | 'pedidos' | 'services' | 'pois';

interface Category {
  key: CategoryKey;
  title: string;
  icon: string;
  count: number;
}

export default function MovilSelector({
  moviles,
  selectedMoviles,
  onToggleMovil,
  onSelectAll,
  onClearAll,
  pedidos = [],
  onPedidoClick,
  puntosInteres = [],
  onPuntoInteresClick,
  onFiltersChange, // 🆕 Recibir el callback
}: MovilSelectorProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set(['moviles']));
  const [guideCategory, setGuideCategory] = useState<CategoryKey | null>(null);
  
  // Ref para calcular altura del contenedor virtual  
  const listContainerRef = useRef<HTMLDivElement>(null);
  
  // Estados de búsqueda por categoría
  const [movilesSearch, setMovilesSearch] = useState('');
  const [pedidosSearch, setPedidosSearch] = useState('');
  const [servicesSearch, setServicesSearch] = useState('');
  const [poisSearch, setPoisSearch] = useState('');
  
  // Estados de filtros por categoría
  const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ 
    capacidad: 'all',
    estado: [] // Inicialmente ningún filtro de estado activo
  });
  const [servicesFilters, setServicesFilters] = useState<ServiceFilters>({ atraso: 'all' });
  const [pedidosFilters, setPedidosFilters] = useState<PedidoFilters>({ 
    atraso: 'all', 
    tipoServicio: 'all' 
  });

  // 🆕 Notificar al padre cuando cambien los filtros de móviles
  useEffect(() => {
    if (onFiltersChange) {
      onFiltersChange(movilesFilters);
    }
  }, [movilesFilters, onFiltersChange]);

  // Filtrar y ordenar móviles
  const filteredMoviles = useMemo(() => {
    let result = [...moviles];
    
    // Filtrar por búsqueda
    if (movilesSearch.trim()) {
      const searchLower = movilesSearch.toLowerCase();
      result = result.filter(movil => 
        movil.id.toString().includes(searchLower) ||
        movil.name.toLowerCase().includes(searchLower) ||
        (movil.matricula && movil.matricula.toLowerCase().includes(searchLower))
      );
    }
    
    // 🔥 Filtrar por capacidad (tamano_lote)
    if (movilesFilters.capacidad !== 'all') {
      result = result.filter(movil => {
        const capacidad = movil.tamanoLote || 0;
        switch (movilesFilters.capacidad) {
          case '1-3': return capacidad >= 1 && capacidad <= 3;
          case '4-6': return capacidad >= 4 && capacidad <= 6;
          case '7-10': return capacidad >= 7 && capacidad <= 10;
          case '10+': return capacidad > 10;
          default: return true;
        }
      });
    }
    
    // 🆕 Filtrar por estado (multi-selección)
    if (movilesFilters.estado.length > 0) {
      result = result.filter(movil => {
        const tamanoLote = movil.tamanoLote || 6;
        const pedidosAsignados = movil.pedidosAsignados || 0;
        const capacidadRestante = tamanoLote - pedidosAsignados;
        const porcentajeDisponible = (capacidadRestante / tamanoLote) * 100;
        
        // Verificar cada estado seleccionado
        return movilesFilters.estado.some(estado => {
          switch (estado) {
            case 'no_reporta_gps':
              // Móviles sin posición o inactivos
              return !movil.currentPosition || movil.isInactive;
            
            case 'baja_momentanea':
              // Móviles con baja momentánea (puedes definir tu lógica aquí)
              // Por ahora, consideramos móviles sin historial reciente
              return movil.currentPosition && !movil.history?.length;
            
            case 'con_capacidad':
              // Móviles con capacidad disponible (> 0%)
              return capacidadRestante > 0;
            
            case 'sin_capacidad':
              // Móviles sin capacidad (0% disponible)
              return capacidadRestante === 0;
            
            default:
              return true;
          }
        });
      });
    }
    
    // Ordenar por número de móvil (ascendente)
    return result.sort((a, b) => a.id - b.id);
  }, [moviles, movilesSearch, movilesFilters]);

  const allSelected = filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));

  // Filtrar y ordenar pedidos
  const filteredPedidos = useMemo(() => {
    let result = [...pedidos];
    
    // Filtrar pedidos pendientes (estado 1) con móvil asignado
    result = result.filter(pedido => {
      const estado = Number(pedido.estado_nro);
      return estado === 1 && pedido.movil && Number(pedido.movil) > 0;
    });
    
    // 🔥 FILTRO: Si hay móviles seleccionados, mostrar solo pedidos de esos móviles
    if (selectedMoviles.length > 0) {
      result = result.filter(pedido => pedido.movil && selectedMoviles.some(id => Number(id) === Number(pedido.movil)));
    }
    
    // Filtrar por búsqueda
    if (pedidosSearch.trim()) {
      const searchLower = pedidosSearch.toLowerCase();
      result = result.filter(pedido => 
        pedido.id.toString().includes(searchLower) ||
        (pedido.servicio_nombre && pedido.servicio_nombre.toLowerCase().includes(searchLower)) ||
        (pedido.cliente_tel && pedido.cliente_tel.includes(searchLower))
      );
    }
    
    // Ordenar por mayor atraso primero (menor delay = más atrasado)
    const sorted = result.sort((a, b) => {
      const delayA = computeDelayMinutes(a.fch_hora_max_ent_comp);
      const delayB = computeDelayMinutes(b.fch_hora_max_ent_comp);
      return delayA - delayB; // Más negativo (más atrasado) primero
    });
    
    return sorted;
  }, [pedidos, pedidosSearch, pedidosFilters, selectedMoviles]);

  // Categorías disponibles
  const categories: Category[] = [
    { key: 'moviles', title: 'Móviles', icon: '🚗', count: moviles.length },
    { key: 'pedidos', title: 'Pedidos', icon: '📦', count: filteredPedidos.length }, // Usar filteredPedidos para el conteo
    { key: 'services', title: 'Services', icon: '🔧', count: 0 },
    { key: 'pois', title: 'Puntos de Interés', icon: '📍', count: puntosInteres.length },
  ];

  const toggleCategory = (categoryKey: CategoryKey) => {
    // Si la categoría ya está abierta, cerrarla (toggle)
    if (expandedCategories.has(categoryKey)) {
      setExpandedCategories(new Set()); // Cerrar todas
    } else {
      setExpandedCategories(new Set([categoryKey])); // Abrir solo esta categoría
    }
  };

  // Determinar qué categoría está activa (puede ser null si todas están cerradas)
  const activeCategory = Array.from(expandedCategories)[0] || null;

  // Obtener filtros contextuales según la categoría activa
  const getContextualFilters = () => {
    switch (activeCategory) {
      case 'moviles':
        return {
          searchValue: movilesSearch,
          onSearchChange: setMovilesSearch,
          searchPlaceholder: 'Buscar móvil por número...',
          filters: [], // ✅ Quitamos el filtro de capacidad
          onFilterChange: () => {}, // No hay filtros normales
        };

      case 'services':
        return {
          searchValue: servicesSearch,
          onSearchChange: setServicesSearch,
          searchPlaceholder: 'Buscar service...',
          filters: [
            {
              id: 'atraso',
              label: 'Atraso',
              options: [
                { value: 'all', label: 'Todos' },
                { value: 'sin_atraso', label: 'Sin atraso' },
                { value: '1-3_dias', label: '1-3 días' },
                { value: '4-7_dias', label: '4-7 días' },
                { value: '7+_dias', label: 'Más de 7 días' },
              ],
              value: servicesFilters.atraso,
            }
          ],
          onFilterChange: (filterId: string, value: string) => {
            if (filterId === 'atraso') {
              setServicesFilters(prev => ({ 
                ...prev, 
                atraso: value as 'all' | 'sin_atraso' | '1-3_dias' | '4-7_dias' | '7+_dias' 
              }));
            }
          }
        };

      case 'pedidos':
        return {
          searchValue: pedidosSearch,
          onSearchChange: setPedidosSearch,
          searchPlaceholder: 'Buscar pedido...',
          filters: [
            {
              id: 'atraso',
              label: 'Atraso',
              options: [
                { value: 'all', label: 'Todos' },
                { value: 'sin_atraso', label: 'Sin atraso' },
                { value: '1-3_dias', label: '1-3 días' },
                { value: '4-7_dias', label: '4-7 días' },
                { value: '7+_dias', label: 'Más de 7 días' },
              ],
              value: pedidosFilters.atraso,
            },
            {
              id: 'tipoServicio',
              label: 'Tipo de Servicio',
              options: [
                { value: 'all', label: 'Todos' },
                { value: 'urgente', label: 'Urgente' },
                { value: 'especial', label: 'Especial' },
              ],
              value: pedidosFilters.tipoServicio,
            }
          ],
          onFilterChange: (filterId: string, value: string) => {
            if (filterId === 'atraso') {
              setPedidosFilters(prev => ({ 
                ...prev, 
                atraso: value as 'all' | 'sin_atraso' | '1-3_dias' | '4-7_dias' | '7+_dias' 
              }));
            } else if (filterId === 'tipoServicio') {
              setPedidosFilters(prev => ({ 
                ...prev, 
                tipoServicio: value as 'all' | 'urgente' | 'especial' 
              }));
            }
          }
        };

      case 'pois':
        return {
          searchValue: poisSearch,
          onSearchChange: setPoisSearch,
          searchPlaceholder: 'Buscar punto de interés...',
          filters: [],
          onFilterChange: () => {}
        };

      default:
        return {
          searchValue: '',
          onSearchChange: () => {},
          searchPlaceholder: 'Buscar...',
          filters: [],
          onFilterChange: () => {}
        };
    }
  };

  const contextualFilters = getContextualFilters();

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center justify-between">
        <span>Capas del Mapa</span>
        <span className="text-sm font-normal text-gray-500">
          {selectedMoviles.length} seleccionado{selectedMoviles.length !== 1 ? 's' : ''}
        </span>
      </h2>
      
      {/* Buscador y Filtros Contextuales - Cambian según la categoría activa */}
      <AnimatePresence mode="wait">
        {expandedCategories.size > 0 && (
          <motion.div
            key={activeCategory}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-4 overflow-hidden"
          >
            {/* Barra de filtros con filtros avanzados integrados */}
            <FilterBar
              searchValue={contextualFilters.searchValue}
              onSearchChange={contextualFilters.onSearchChange}
              searchPlaceholder={contextualFilters.searchPlaceholder}
              filters={contextualFilters.filters}
              onFilterChange={contextualFilters.onFilterChange}
              customFilters={
                activeCategory === 'moviles' ? (
                  <div className="mt-3 pt-3 border-t border-gray-300">
                    <h5 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" />
                      </svg>
                      Filtros Avanzados
                    </h5>
                    <div className="space-y-2">
                      {[
                        { value: 'no_reporta_gps', label: 'No reporta GPS', icon: '📡', color: 'text-red-600' },
                        { value: 'baja_momentanea', label: 'Baja Momentánea', icon: '⏸️', color: 'text-orange-600' },
                        { value: 'con_capacidad', label: 'Con Capacidad de Entrega', icon: '🟢', color: 'text-green-600' },
                        { value: 'sin_capacidad', label: 'Sin Capacidad de Entrega', icon: '⚫', color: 'text-gray-700' },
                      ].map((opcion) => {
                        const isChecked = movilesFilters.estado.includes(opcion.value);
                        return (
                          <label
                            key={opcion.value}
                            className={clsx(
                              "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-all",
                              isChecked
                                ? "bg-blue-50 border border-blue-300"
                                : "hover:bg-gray-50"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newChecked = e.target.checked;
                                setMovilesFilters(prev => ({
                                  ...prev,
                                  estado: newChecked
                                    ? [...prev.estado, opcion.value]
                                    : prev.estado.filter(v => v !== opcion.value)
                                }));
                              }}
                              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <span className="text-lg">{opcion.icon}</span>
                            <span className={clsx("text-sm font-medium flex-1", opcion.color)}>
                              {opcion.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {movilesFilters.estado.length > 0 && (
                      <button
                        onClick={() => setMovilesFilters(prev => ({ ...prev, estado: [] }))}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Limpiar filtros avanzados
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
            
            {activeCategory === 'moviles' && contextualFilters.searchValue && (
              <p className="text-xs text-gray-500 mt-2">
                {filteredMoviles.length} móvil(es) encontrado(s)
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Estructura de árbol con categorías colapsables */}
      <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        <div className="space-y-2">
          {categories.map((category) => (
            <div key={category.key} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Header de la categoría */}
              <button
                onClick={() => toggleCategory(category.key)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{category.icon}</span>
                  <span className="font-semibold text-gray-700">{category.title}</span>
                  {category.count > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {category.count}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {/* Botón de ayuda */}
                  {category.key === 'moviles' && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGuideCategory(category.key);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          setGuideCategory(category.key);
                        }
                      }}
                      className="p-1 rounded-full hover:bg-blue-100 transition-colors group"
                      title="Ver guía de indicadores"
                    >
                      <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                  <svg
                    className={clsx(
                      'w-5 h-5 text-gray-500 transition-transform duration-200',
                      expandedCategories.has(category.key) && 'rotate-180'
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Contenido de la categoría */}
              <AnimatePresence>
                {expandedCategories.has(category.key) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 bg-white border-t border-gray-200">
                      {/* Contenido según la categoría */}
                      {category.key === 'moviles' && (
                        <div className="space-y-2">
                          {/* Botón Seleccionar Todos */}
                          <button
                            onClick={allSelected ? onClearAll : onSelectAll}
                            className="w-full flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
                          >
                            <div className={clsx(
                              'flex items-center justify-center w-5 h-5 border-2 rounded transition-colors',
                              allSelected
                                ? 'bg-blue-500 border-blue-500'
                                : 'border-gray-300 bg-white'
                            )}>
                              {allSelected && (
                                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <span className="font-medium text-gray-700">
                              {allSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
                            </span>
                          </button>

                          {/* Lista de móviles */}
                          {filteredMoviles.map((movil) => {
                            const isSelected = selectedMoviles.includes(movil.id);
                            const isInactive = movil.isInactive;
                            
                            return (
                              <motion.button
                                key={movil.id}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => onToggleMovil(movil.id)}
                                className={clsx(
                                  'w-full py-2 px-3 rounded-lg font-medium transition-all duration-200 border-2',
                                  isSelected
                                    ? 'text-white shadow-md border-transparent'
                                    : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-200',
                                  isInactive && !isSelected && 'bg-red-50 border-red-200',
                                  isInactive && 'animate-pulse-slow'
                                )}
                                style={{
                                  backgroundColor: isSelected ? (isInactive ? '#DC2626' : movil.color) : undefined,
                                }}
                              >
                                <span className="flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    {/* Checkbox visual */}
                                    <div className={clsx(
                                      "w-5 h-5 rounded flex items-center justify-center border-2 transition-all",
                                      isSelected 
                                        ? "bg-white border-white" 
                                        : "bg-white border-gray-300"
                                    )}>
                                      {isSelected && (
                                        <svg className="w-3 h-3" style={{ color: isInactive ? '#DC2626' : movil.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                    
                                    {isInactive ? (
                                      <span className="relative inline-block">
                                        <svg 
                                          className="w-5 h-5 text-red-600 animate-pulse" 
                                          fill="currentColor" 
                                          viewBox="0 0 24 24"
                                        >
                                          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                                        </svg>
                                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                        </span>
                                      </span>
                                    ) : (
                                      <div
                                        className="w-4 h-4 rounded-full"
                                        style={{ backgroundColor: movil.color }}
                                      />
                                    )}
                                    {/* 🔥 Formato compacto: NroMovil – PedAsignados/Capacidad */}
                                    <span className="text-sm font-medium leading-tight">
                                      {movil.id}
                                      {' – '}
                                      {movil.pedidosAsignados ?? 0}/{movil.tamanoLote ?? 0}
                                    </span>
                                  </span>
                                  {movil.currentPosition && (
                                    <div className="flex flex-col items-end">
                                      <span className={clsx("text-[11px]", isInactive ? "text-red-100 font-semibold" : isSelected ? "opacity-90" : "text-gray-600")}>
                                        {new Date(movil.currentPosition.fechaInsLog).toLocaleTimeString('es-PY', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                      {(() => {
                                        const now = Date.now();
                                        const coordDate = new Date(movil.currentPosition.fechaInsLog).getTime();
                                        const minutesDiff = Math.floor((now - coordDate) / (1000 * 60));
                                        
                                        if (minutesDiff < 1) {
                                          return <span className={clsx("text-[10px] font-medium", isSelected ? "text-green-200" : "text-green-600")}>Ahora</span>;
                                        } else if (minutesDiff < 5) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-green-200" : "text-green-500")}>{minutesDiff}m</span>;
                                        } else if (minutesDiff < 15) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-yellow-200" : "text-yellow-600")}>{minutesDiff}m</span>;
                                        } else if (minutesDiff < 30) {
                                          return <span className={clsx("text-[10px]", isSelected ? "text-orange-200" : "text-orange-600")}>{minutesDiff}m</span>;
                                        } else {
                                          return <span className={clsx("text-[10px] font-semibold", isSelected ? "text-red-200" : "text-red-600")}>{minutesDiff}m ⚠️</span>;
                                        }
                                      })()}
                                    </div>
                                  )}
                                </span>
                              </motion.button>
                            );
                          })}
                        </div>
                      )}

                      {/* Contenido de Pedidos - 🚀 VIRTUALIZADO para 600+ pedidos */}
                      {category.key === 'pedidos' && (
                        <div ref={listContainerRef}>
                          {filteredPedidos.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>📦 Sin pedidos</p>
                              <p className="text-xs mt-1">No hay pedidos para mostrar</p>
                            </div>
                          ) : (
                            <VirtualList
                              items={filteredPedidos}
                              height={Math.min(filteredPedidos.length * 38, Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 600) - 350))}
                              itemHeight={38}
                              overscanCount={8}
                              renderItem={(pedido, _index) => {
                                if (!pedido) return null;
                                const delayMins = computeDelayMinutes(pedido.fch_hora_max_ent_comp);
                                const delayInfo = getDelayInfo(delayMins);

                                return (
                                  <button
                                    key={pedido.id}
                                    onClick={() => onPedidoClick && onPedidoClick(pedido.id)}
                                    className={clsx(
                                      'w-full text-left px-2.5 py-1.5 rounded-lg transition-colors duration-100 border mb-1',
                                      delayInfo.bgClass
                                    )}
                                  >
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-bold text-gray-900">#{pedido.id}</span>
                                      {(!pedido.latitud || !pedido.longitud) && (
                                        <span className="text-[10px] bg-amber-500 text-white px-1 py-0.5 rounded" title="Sin coordenadas">
                                          📍❌
                                        </span>
                                      )}
                                      <span className="text-gray-700">🚗{pedido.movil}</span>
                                      {pedido.servicio_nombre && (
                                        <span className="text-gray-600 truncate flex-1">📋{pedido.servicio_nombre}</span>
                                      )}
                                      <span 
                                        className={clsx(
                                          'text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                                          delayInfo.textColor
                                        )}
                                        style={{ backgroundColor: `${delayInfo.color}22` }}
                                        title={delayInfo.label}
                                      >
                                        ⏱{delayInfo.badgeText}
                                      </span>
                                    </div>
                                  </button>
                                );
                              }}
                            />
                          )}
                        </div>
                      )}

                      {category.key === 'services' && (
                        <div className="text-center py-4 text-gray-500 text-sm">
                          <p>🔧 Sin datos de services</p>
                          <p className="text-xs mt-1">Próximamente...</p>
                        </div>
                      )}

                      {category.key === 'pois' && (
                        <div className="space-y-1">
                          {puntosInteres.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>📍 Sin puntos de interés</p>
                              <p className="text-xs mt-1">Crea uno haciendo clic en el botón verde del header</p>
                            </div>
                          ) : (
                            puntosInteres.map((punto) => (
                              <motion.button
                                key={punto.id}
                                onClick={() => onPuntoInteresClick?.(punto.id)}
                                className="w-full text-left px-3 py-2.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-400 dark:from-cyan-600 dark:to-blue-600 hover:from-cyan-500 hover:to-blue-500 dark:hover:from-cyan-700 dark:hover:to-blue-700 border border-cyan-300 dark:border-cyan-500 transition-all duration-200 group shadow-sm hover:shadow-md"
                                whileHover={{ scale: 1.01, x: 2 }}
                                whileTap={{ scale: 0.98 }}
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="text-2xl bg-white dark:bg-gray-800 rounded-lg p-1.5 shadow-sm">
                                    {punto.icono}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-white drop-shadow-sm truncate">
                                        {punto.nombre}
                                      </span>
                                    </div>
                                    {punto.observacion && (
                                      <p className="text-xs text-white/90 truncate mt-0.5">
                                        {punto.observacion}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-2 text-xs text-white/80 mt-1">
                                      <span>📍 {punto.latitud.toFixed(4)}, {punto.longitud.toFixed(4)}</span>
                                    </div>
                                  </div>
                                </div>
                              </motion.button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Modal de guía del mapa */}
      <MapGuideModal
        isOpen={guideCategory !== null}
        onClose={() => setGuideCategory(null)}
        category={guideCategory || 'moviles'}
      />
    </div>
  );
}
