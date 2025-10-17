'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EmpresaFletera } from '@/types';

interface EmpresaSelectorProps {
  empresas: EmpresaFletera[];
  selectedEmpresas: number[];
  onSelectionChange: (empresaIds: number[]) => void;
}

export default function EmpresaSelector({
  empresas,
  selectedEmpresas,
  onSelectionChange,
}: EmpresaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Cerrar dropdown al hacer click fuera
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
      // Deseleccionar
      onSelectionChange(selectedEmpresas.filter(id => id !== empresaId));
    } else {
      // Seleccionar
      onSelectionChange([...selectedEmpresas, empresaId]);
    }
  };

  const handleSelectAll = () => {
    onSelectionChange(empresas.map(e => e.eflid));
  };

  const handleDeselectAll = () => {
    onSelectionChange([]);
  };

  const getButtonText = () => {
    if (selectedEmpresas.length === 0) {
      return 'Seleccione empresas fleteras';
    } else if (selectedEmpresas.length === empresas.length) {
      return `Todas las empresas (${empresas.length})`;
    } else if (selectedEmpresas.length === 1) {
      const empresa = empresas.find(e => e.eflid === selectedEmpresas[0]);
      return empresa?.eflnom || 'Sin nombre';
    } else {
      return `${selectedEmpresas.length} empresas seleccionadas`;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón principal */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white border-2 border-gray-300 rounded-xl hover:border-blue-500 transition-colors shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🏢</span>
          <span className="font-medium text-gray-800">{getButtonText()}</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Header con acciones */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-600">
                {selectedEmpresas.length} de {empresas.length} seleccionadas
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Todas
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={handleDeselectAll}
                  className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                >
                  Ninguna
                </button>
              </div>
            </div>

            {/* Lista de empresas */}
            <div className="max-h-64 overflow-y-auto">
              {empresas.map((empresa) => {
                const isSelected = selectedEmpresas.includes(empresa.eflid);
                
                return (
                  <label
                    key={empresa.eflid}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleEmpresa(empresa.eflid)}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-800">{empresa.eflnom}</div>
                      <div className="text-xs text-gray-500">
                        ID: {empresa.eflid} • Estado: {empresa.eflestado}
                      </div>
                    </div>
                    {isSelected && (
                      <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
              <button
                onClick={() => setIsOpen(false)}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Aplicar Filtro
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
