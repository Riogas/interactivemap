'use client';

import { motion } from 'framer-motion';
import { MovilData } from '@/types';
import clsx from 'clsx';
import { useState, useMemo } from 'react';

interface MovilSelectorProps {
  moviles: MovilData[];
  selectedMovil?: number;
  onSelectMovil: (movilId: number | undefined) => void;
}

export default function MovilSelector({
  moviles,
  selectedMovil,
  onSelectMovil,
}: MovilSelectorProps) {
  const [searchFilter, setSearchFilter] = useState('');

  // Filtrar y ordenar móviles según el texto de búsqueda
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
    
    // Ordenar por ID ascendente
    return result.sort((a, b) => a.id - b.id);
  }, [moviles, searchFilter]);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Seleccionar Móvil</h2>
      
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
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelectMovil(undefined)}
          className={clsx(
            'w-full p-4 rounded-lg font-semibold transition-all duration-200',
            !selectedMovil
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Todos los Móviles
          </span>
        </motion.button>

        {filteredMoviles.map((movil) => (
          <motion.button
            key={movil.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectMovil(movil.id)}
            className={clsx(
              'w-full p-4 rounded-lg font-semibold transition-all duration-200',
              selectedMovil === movil.id
                ? 'text-white shadow-lg'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
            style={{
              backgroundColor: selectedMovil === movil.id ? movil.color : undefined,
            }}
          >
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: movil.color }}
                />
                {movil.name}
              </span>
              {movil.currentPosition && (
                <span className="text-sm opacity-80">
                  {new Date(movil.currentPosition.fechaInsLog).toLocaleTimeString('es-PY', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
