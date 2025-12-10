'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmpresaFleteraSupabase } from '@/types';
import EmpresaSelector from '@/components/ui/EmpresaSelector';
import PreferencesModal, { UserPreferences } from '@/components/ui/PreferencesModal';
import { useAuth } from '@/contexts/AuthContext';

interface NavbarProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  empresas: EmpresaFleteraSupabase[];
  selectedEmpresas: number[];
  onEmpresasChange: (empresas: number[]) => void;
  isLoadingEmpresas: boolean;
  onPreferencesChange?: (preferences: UserPreferences) => void;
}

export default function Navbar({
  selectedDate,
  onDateChange,
  empresas,
  selectedEmpresas,
  onEmpresasChange,
  isLoadingEmpresas,
  onPreferencesChange,
}: NavbarProps) {
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const { user, logout } = useAuth();
  const router = useRouter();

  const handlePreferencesSave = (preferences: UserPreferences) => {
    if (onPreferencesChange) {
      onPreferencesChange(preferences);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <>
      <nav className="bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 shadow-xl sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between py-4">
          {/* Logo y Título */}
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg p-2 shadow-lg">
              <svg
                className="w-8 h-8 text-blue-600"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">TrackMovil</h1>
              <p className="text-xs text-blue-200">Rastreo en tiempo real</p>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-6">
            {/* Selector de Fecha */}
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/20">
              <span className="text-white font-medium text-sm">📅 Fecha:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onDateChange(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="px-3 py-1.5 rounded-md border-0 focus:ring-2 focus:ring-blue-300 transition-all duration-200 text-gray-700 font-medium text-sm bg-white shadow-sm"
              />
            </div>

            {/* Selector de Empresas */}
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/20">
              <span className="text-white font-medium text-sm">🏢 Empresas:</span>
              {isLoadingEmpresas ? (
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span className="text-white text-sm">Cargando...</span>
                </div>
              ) : (
                <div className="min-w-[200px]">
                  <EmpresaSelector
                    empresas={empresas}
                    selectedEmpresas={selectedEmpresas}
                    onSelectionChange={onEmpresasChange}
                  />
                </div>
              )}
            </div>

            {/* Botón de Preferencias */}
            <button
              onClick={() => setIsPreferencesOpen(true)}
              className="flex items-center gap-2 bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg px-4 py-2 border border-white/20 transition-all group"
              title="Preferencias"
            >
              <svg 
                className="w-5 h-5 text-white group-hover:rotate-90 transition-transform duration-300" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-white font-medium text-sm hidden md:inline">Preferencias</span>
            </button>

            {/* Usuario y Logout */}
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/20">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-sm">
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <span className="text-white font-medium text-sm hidden lg:inline">
                  {user?.username || 'Usuario'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-white/80 hover:text-white transition-colors"
                title="Cerrar sesión"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm hidden md:inline">Salir</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>

      {/* Modal de Preferencias */}
      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onSave={handlePreferencesSave}
      />
    </>
  );
}
