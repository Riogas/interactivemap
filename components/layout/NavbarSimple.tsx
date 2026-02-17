'use client';

import { ReactNode } from 'react';
import { EmpresaFleteraSupabase } from '@/types';
import EmpresaSelector from '@/components/ui/EmpresaSelector';

interface NavbarProps {
  children?: ReactNode;
  empresas?: EmpresaFleteraSupabase[];
  selectedEmpresas?: number[];
  onEmpresasChange?: (empresas: number[]) => void;
  isLoadingEmpresas?: boolean;
  showEmpresaSelector?: boolean;
}

export default function Navbar({ children, empresas, selectedEmpresas, onEmpresasChange, isLoadingEmpresas, showEmpresaSelector = true }: NavbarProps) {
  return (
    <nav className="bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 shadow-xl sticky top-0 z-50">
      <div className="w-full px-3">
        <div className="flex items-center justify-between py-2.5">
          {/* Logo + Empresas */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="bg-white rounded-lg p-1.5 shadow-lg">
                <svg
                  className="w-6 h-6 text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
                </svg>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-white leading-tight">TrackMovil</h1>
                <p className="text-[9px] text-blue-200 leading-tight">Rastreo en tiempo real</p>
              </div>
            </div>

            {/* Selector de Empresas Fleteras - junto al logo */}
            {showEmpresaSelector && empresas && selectedEmpresas && onEmpresasChange && (
              <div className="hidden lg:block">
                {isLoadingEmpresas ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-lg">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    <span className="text-xs text-white/80">Cargando...</span>
                  </div>
                ) : (
                  <EmpresaSelector
                    empresas={empresas}
                    selectedEmpresas={selectedEmpresas}
                    onSelectionChange={onEmpresasChange}
                  />
                )}
              </div>
            )}
          </div>

          {/* Indicadores - Centrados */}
          {/* mr-14: esquivar solo el gear icon (~56px) en < xl */}
          {/* mr-52 en xl+: esquivar los 4 botones flotantes horizontales (~200px) */}
          <div className="flex items-center flex-1 justify-center ml-2 mr-14 xl:mr-52 min-w-0">
            {children}
          </div>
        </div>
      </div>
    </nav>
  );
}
