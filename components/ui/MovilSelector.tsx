'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, MovilFilters, ServiceFilters, PedidoFilters, PedidoSupabase } from '@/types';
import clsx from 'clsx';
import { useState, useMemo } from 'react';
import FilterBar from './FilterBar';

interface MovilSelectorProps {
  moviles: MovilData[];
  selectedMoviles: number[];
  onToggleMovil: (movilId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  pedidos?: PedidoSupabase[]; // Nueva prop para pedidos
  onPedidoClick?: (pedidoId: number) => void; // Callback para click en pedido
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
}: MovilSelectorProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set(['moviles']));
  
  // Estados de búsqueda por categoría
  const [movilesSearch, setMovilesSearch] = useState('');
  const [pedidosSearch, setPedidosSearch] = useState('');
  const [servicesSearch, setServicesSearch] = useState('');
  const [poisSearch, setPoisSearch] = useState('');
  
  // Estados de filtros por categoría
  const [movilesFilters, setMovilesFilters] = useState<MovilFilters>({ capacidad: 'all' });
  const [servicesFilters, setServicesFilters] = useState<ServiceFilters>({ atraso: 'all' });
  const [pedidosFilters, setPedidosFilters] = useState<PedidoFilters>({ 
    atraso: 'all', 
    tipoServicio: 'all' 
  });

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
    
    // Ordenar por número de móvil (ascendente)
    return result.sort((a, b) => a.id - b.id);
  }, [moviles, movilesSearch, movilesFilters]);

  const allSelected = filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));

  // Filtrar y ordenar pedidos
  const filteredPedidos = useMemo(() => {
    let result = [...pedidos];
    
    // Filtrar por búsqueda
    if (pedidosSearch.trim()) {
      const searchLower = pedidosSearch.toLowerCase();
      result = result.filter(pedido => 
        pedido.id.toString().includes(searchLower) ||
        (pedido.cliente_nombre && pedido.cliente_nombre.toLowerCase().includes(searchLower)) ||
        (pedido.producto_nom && pedido.producto_nom.toLowerCase().includes(searchLower)) ||
        (pedido.cliente_tel && pedido.cliente_tel.includes(searchLower))
      );
    }
    
    // Ordenar por prioridad (desc) y fecha (asc)
    return result.sort((a, b) => {
      // Primero por prioridad (mayor a menor)
      const prioridadDiff = (b.prioridad || 0) - (a.prioridad || 0);
      if (prioridadDiff !== 0) return prioridadDiff;
      
      // Luego por fecha
      if (a.fch_hora_para && b.fch_hora_para) {
        return new Date(a.fch_hora_para).getTime() - new Date(b.fch_hora_para).getTime();
      }
      return 0;
    });
  }, [pedidos, pedidosSearch, pedidosFilters]);

  // Categorías disponibles
  const categories: Category[] = [
    { key: 'moviles', title: 'Móviles', icon: '🚗', count: moviles.length },
    { key: 'pedidos', title: 'Pedidos', icon: '📦', count: pedidos.length },
    { key: 'services', title: 'Services', icon: '🔧', count: 0 },
    { key: 'pois', title: 'Puntos de Interés', icon: '📍', count: 0 },
  ];

  const toggleCategory = (categoryKey: CategoryKey) => {
    setExpandedCategories(new Set([categoryKey])); // Solo una categoría abierta a la vez
  };

  // Determinar qué categoría está activa
  const activeCategory = Array.from(expandedCategories)[0] || 'moviles';

  // Obtener filtros contextuales según la categoría activa
  const getContextualFilters = () => {
    switch (activeCategory) {
      case 'moviles':
        return {
          searchValue: movilesSearch,
          onSearchChange: setMovilesSearch,
          searchPlaceholder: 'Buscar móvil por número...',
          filters: [
            {
              id: 'capacidad',
              label: 'Capacidad',
              options: [
                { value: 'all', label: 'Todas las capacidades' },
                { value: '1-3', label: '1-3 garrafas' },
                { value: '4-6', label: '4-6 garrafas' },
                { value: '7-10', label: '7-10 garrafas' },
                { value: '10+', label: '10+ garrafas' },
              ],
              value: movilesFilters.capacidad,
            }
          ],
          onFilterChange: (filterId: string, value: string) => {
            if (filterId === 'capacidad') {
              setMovilesFilters(prev => ({ 
                ...prev, 
                capacidad: value as 'all' | '1-3' | '4-6' | '7-10' | '10+' 
              }));
            }
          }
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
            <FilterBar
              searchValue={contextualFilters.searchValue}
              onSearchChange={contextualFilters.onSearchChange}
              searchPlaceholder={contextualFilters.searchPlaceholder}
              filters={contextualFilters.filters}
              onFilterChange={contextualFilters.onFilterChange}
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
                                  'w-full p-3 rounded-lg font-medium transition-all duration-200 border-2',
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
                                    {/* 🔥 Formato compacto: NroMovil – PedAsignados/Capacidad – Matricula */}
                                    <span className="text-sm font-medium leading-tight">
                                      {movil.id}
                                      {' – '}
                                      {movil.pedidosAsignados ?? 0}/{movil.tamanoLote ?? 0}
                                      {movil.matricula && movil.matricula.trim() && (
                                        <> – {movil.matricula.trim()}</>
                                      )}
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

                      {/* Contenido de Pedidos */}
                      {category.key === 'pedidos' && (
                        <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
                          {filteredPedidos.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">
                              <p>📦 Sin pedidos</p>
                              <p className="text-xs mt-1">No hay pedidos para mostrar</p>
                            </div>
                          ) : (
                            filteredPedidos.map((pedido) => {
                              // Determinar color según estado
                              const getEstadoColor = () => {
                                if (!pedido.estado_nro) return 'bg-gray-100 hover:bg-gray-200 border-gray-300';
                                if (pedido.estado_nro <= 2) return 'bg-blue-50 hover:bg-blue-100 border-blue-300';
                                if (pedido.estado_nro <= 5) return 'bg-yellow-50 hover:bg-yellow-100 border-yellow-300';
                                if (pedido.estado_nro === 7) return 'bg-green-50 hover:bg-green-100 border-green-300';
                                return 'bg-red-50 hover:bg-red-100 border-red-300';
                              };

                              return (
                                <motion.button
                                  key={pedido.id}
                                  onClick={() => onPedidoClick && onPedidoClick(pedido.id)}
                                  className={clsx(
                                    'w-full text-left px-3 py-2 rounded-lg transition-all duration-200 border',
                                    getEstadoColor()
                                  )}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-gray-900">#{pedido.id}</span>
                                        {pedido.prioridad && pedido.prioridad > 0 && (
                                          <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                                            P{pedido.prioridad}
                                          </span>
                                        )}
                                        {pedido.movil && (
                                          <span className="text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full font-semibold">
                                            M{pedido.movil}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-700 font-medium truncate mt-0.5">
                                        {pedido.cliente_nombre || 'Sin nombre'}
                                      </div>
                                      <div className="text-[10px] text-gray-600 truncate">
                                        {pedido.producto_nom || pedido.tipo || 'Pedido'}
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-end text-right">
                                      <span className="text-[10px] text-gray-500">
                                        Estado {pedido.estado_nro || 'N/A'}
                                      </span>
                                      {pedido.fch_hora_para && (
                                        <span className="text-[10px] text-gray-600 font-medium">
                                          {new Date(pedido.fch_hora_para).toLocaleDateString('es-PY', { 
                                            day: '2-digit', 
                                            month: '2-digit' 
                                          })}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </motion.button>
                              );
                            })
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
                        <div className="text-center py-4 text-gray-500 text-sm">
                          <p>📍 Sin puntos de interés</p>
                          <p className="text-xs mt-1">Próximamente...</p>
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
    </div>
  );
}
