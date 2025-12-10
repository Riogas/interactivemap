'use client';

import { useState, useEffect, useRef } from 'react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            className="absolute z-50 min-w-[320px] right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-blue-100 border-b">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800"> Empresas Fleteras</h3>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{selectedEmpresas.length} de {empresas.length}</span>
                <div className="flex gap-2">
                  <button onClick={handleSelectAll} className="text-xs text-blue-600 hover:text-blue-800">Todas</button>
                  <button onClick={handleDeselectAll} className="text-xs text-gray-600 hover:text-gray-800">Ninguna</button>
                </div>
              </div>
            </div>
            
            <div className="max-h-80 overflow-y-auto">
              {empresas.map((empresa) => (
                <label
                  key={empresa.empresa_fletera_id}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${selectedEmpresas.includes(empresa.empresa_fletera_id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEmpresas.includes(empresa.empresa_fletera_id)}
                    onChange={() => handleToggleEmpresa(empresa.empresa_fletera_id)}
                    className="w-5 h-5 rounded text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{empresa.nombre}</div>
                    <div className="text-xs text-gray-500">ID: {empresa.empresa_fletera_id}</div>
                  </div>
                </label>
              ))}
            </div>
            
            <div className="px-4 py-3 bg-gray-50">
              <button onClick={() => setIsOpen(false)} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Aplicar Filtro</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
