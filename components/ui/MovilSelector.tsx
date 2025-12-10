'use client';

import { motion } from 'framer-motion';
import { MovilData } from '@/types';
import clsx from 'clsx';
import { useState, useMemo } from 'react';

interface MovilSelectorProps {
  moviles: MovilData[];
  selectedMoviles: number[]; // Cambiado a array
  onToggleMovil: (movilId: number) => void; // Toggle individual
  onSelectAll: () => void; // Seleccionar todos
  onClearAll: () => void; // Deseleccionar todos
}

export default function MovilSelector({
  moviles,
  selectedMoviles,
  onToggleMovil,
  onSelectAll,
  onClearAll,
}: MovilSelectorProps) {
  const [searchFilter, setSearchFilter] = useState('');

  // Filtrar y ordenar móviles según el texto de búsqueda y hora de actualización
  const filteredMoviles = useMemo(() => {
    let result = [...moviles]; // Crear copia para no mutar el original
    
    // Filtrar si hay texto de búsqueda
    if (searchFilter.trim()) {
      const searchLower = searchFilter.toLowerCase();
      result = result.filter(movil => 
        movil.id.toString().includes(searchLower) ||
        movil.name.toLowerCase().includes(searchLower)
      );
    }
    
    // Ordenar por hora de última actualización descendente (más recientes primero)
    return result.sort((a, b) => {
      // Si alguno no tiene posición actual, va al final
      if (!a.currentPosition && !b.currentPosition) return a.id - b.id;
      if (!a.currentPosition) return 1;
      if (!b.currentPosition) return -1;
      
      // Ordenar por fecha de actualización (más reciente primero)
      const dateA = new Date(a.currentPosition.fechaInsLog).getTime();
      const dateB = new Date(b.currentPosition.fechaInsLog).getTime();
      return dateB - dateA; // Descendente (más reciente primero)
    });
  }, [moviles, searchFilter]);

  const allSelected = filteredMoviles.length > 0 && filteredMoviles.every(m => selectedMoviles.includes(m.id));

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center justify-between">
        <span>Móviles</span>
        <span className="text-sm font-normal text-gray-500">
          {selectedMoviles.length} de {moviles.length} seleccionados
        </span>
      </h2>
      
      {/* Buscador de móviles */}
      <div className="mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar móvil por número..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full px-4 py-2 pl-10 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors"
          />
          <svg 
            className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {searchFilter && (
          <p className="text-xs text-gray-500 mt-1">
            {filteredMoviles.length} móvil(es) encontrado(s)
          </p>
        )}
      </div>
      
      {/* Lista de móviles con scroll */}
      <div className="space-y-3 flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        {/* Botón Todos/Ninguno */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={allSelected ? onClearAll : onSelectAll}
          className={clsx(
            'w-full p-4 rounded-lg font-semibold transition-all duration-200',
            allSelected
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            {allSelected ? 'Deseleccionar Todos' : 'Seleccionar Todos'}
          </span>
        </motion.button>

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
                'w-full p-4 rounded-lg font-semibold transition-all duration-200 border-2',
                isSelected
                  ? 'text-white shadow-lg border-transparent'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-200',
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
                        style={{ animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
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
                  {movil.name}
                </span>
                {movil.currentPosition && (
                  <div className="flex flex-col items-end">
                    <span className={clsx("text-sm", isInactive ? "text-red-500 font-semibold" : "opacity-80")}>
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
                        return <span className="text-xs text-green-600 font-medium">Ahora</span>;
                      } else if (minutesDiff < 5) {
                        return <span className="text-xs text-green-500">{minutesDiff}m</span>;
                      } else if (minutesDiff < 15) {
                        return <span className="text-xs text-yellow-600">{minutesDiff}m</span>;
                      } else if (minutesDiff < 30) {
                        return <span className="text-xs text-orange-600">{minutesDiff}m</span>;
                      } else {
                        return <span className="text-xs text-red-600 font-semibold">{minutesDiff}m ⚠️</span>;
                      }
                    })()}
                  </div>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
