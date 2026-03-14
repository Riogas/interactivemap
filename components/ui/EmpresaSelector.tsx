'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EmpresaFleteraSupabase } from '@/types';

interface EmpresaSelectorProps {
  empresas: EmpresaFleteraSupabase[];
  selectedEmpresas: number[];
  onSelectionChange: (empresaIds: number[]) => void;
  isLoading?: boolean;
}

export default function EmpresaSelector({
  empresas,
  selectedEmpresas,
  onSelectionChange,
  isLoading = false,
}: EmpresaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const filteredEmpresas = useMemo(() => {
    if (!search.trim()) return empresas;
    const q = search.toLowerCase();
    return empresas.filter(e => e.nombre.toLowerCase().includes(q));
  }, [empresas, search]);

  const handleToggleEmpresa = (empresaId: number) => {
    if (selectedEmpresas.includes(empresaId)) {
      onSelectionChange(selectedEmpresas.filter(id => id !== empresaId));
    } else {
      onSelectionChange([...selectedEmpresas, empresaId]);
    }
  };

  const handleSelectAll = () => {
    onSelectionChange(empresas.map(e => e.empresa_fletera_id));
  };

  const handleDeselectAll = () => {
    onSelectionChange([]);
  };

  const getButtonText = () => {
    if (selectedEmpresas.length === 0) {
      return 'Ninguna';
    } else if (selectedEmpresas.length === empresas.length) {
      return `Todas (${empresas.length})`;
    } else if (selectedEmpresas.length === 1) {
      const empresa = empresas.find(e => e.empresa_fletera_id === selectedEmpresas[0]);
      return empresa?.nombre || 'Sin nombre';
    } else {
      return `${selectedEmpresas.length} seleccionadas`;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-md">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <span className="text-sm text-gray-600">Cargando...</span>
      </div>
    );
  }

  if (empresas.length === 0) {
    return (
      <div className="px-3 py-1.5 bg-gray-100 rounded-md">
        <span className="text-sm text-gray-600">No hay empresas</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="min-w-[200px] flex items-center justify-between px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span></span>
          <span className="font-medium text-gray-800 text-sm truncate">{getButtonText()}</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 min-w-[280px] right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-3 py-2 bg-gradient-to-r from-blue-50 to-blue-100 border-b">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-800 text-sm">Empresas Fleteras</h3>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{selectedEmpresas.length} de {empresas.length}</span>
                <div className="flex gap-2">
                  <button onClick={handleSelectAll} className="text-xs text-blue-600 hover:text-blue-800">Todas</button>
                  <button onClick={handleDeselectAll} className="text-xs text-gray-600 hover:text-gray-800">Ninguna</button>
                </div>
              </div>
            </div>

            {/* Buscador */}
            <div className="px-3 py-2 border-b bg-white">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar empresa..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
              </div>
            </div>
            
            <div className="max-h-72 overflow-y-auto">
              {filteredEmpresas.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-gray-400">Sin resultados</div>
              ) : (
                filteredEmpresas.map((empresa) => (
                  <label
                    key={empresa.empresa_fletera_id}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                      selectedEmpresas.includes(empresa.empresa_fletera_id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmpresas.includes(empresa.empresa_fletera_id)}
                      onChange={() => handleToggleEmpresa(empresa.empresa_fletera_id)}
                      className="w-4 h-4 rounded text-blue-600 flex-shrink-0"
                    />
                    <span className="font-medium text-gray-800 truncate">{empresa.nombre}</span>
                  </label>
                ))
              )}
            </div>
            
            <div className="px-3 py-2 bg-gray-50 border-t">
              <button onClick={() => setIsOpen(false)} className="w-full py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">Aplicar Filtro</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
