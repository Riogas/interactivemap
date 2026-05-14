'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import PreferencesModal, { UserPreferences } from '@/components/ui/PreferencesModal';
import { useAuth } from '@/contexts/AuthContext';
import { todayMontevideo, daysAgoMontevideo } from '@/lib/date-utils';
import { getMaxRoleAttribute } from '@/lib/role-attributes';
import { isRoot } from '@/lib/auth-scope';
import { hasFuncionalidad } from '@/lib/role-funcionalidades';

interface FloatingToolbarProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  onPreferencesChange?: (preferences: UserPreferences) => void;
}

export default function FloatingToolbar({
  selectedDate,
  onDateChange,
  onPreferencesChange,
}: FloatingToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const { user, escenarioId, logout, hasPermiso } = useAuth();
  // canChangeDate: el usuario puede navegar a fechas anteriores en el selector.
  // Pasa si:
  //   - es root (bypass), o
  //   - tiene la accion 'date' en su array `accesos` (sistema legacy
  //     consultado vía hasPermiso → /api/auth/permisos), o
  //   - tiene la funcionalidad "Ver Historico" en alguno de sus roles
  //     (sistema nuevo de funcionalidades en roles[]).
  // Cualquiera de los tres alcanza para habilitar el cambio de fecha.
  const canChangeDate = isRoot(user) || hasPermiso('date') || hasFuncionalidad(user?.roles, 'Ver Historico');
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Fecha mínima permitida en el selector de fecha del dashboard.
   * Derivada de HistoricoMaxPedidos del rol activo en el escenario actual.
   * Si el usuario es root o no tiene restricciones en su rol, se usa la anterior
   * lógica de 10 días (fallback conservador visible solo para usuarios con permiso 'date').
   */
  const minDatePreferences = useMemo(() => {
    // Root: sin restricción (se comporta como antes — no mostramos el input igual)
    if (isRoot(user)) return undefined;
    // Sin roles: sin restricción
    if (!user?.roles) return undefined;

    const dias = getMaxRoleAttribute(
      user.roles.map(r => ({ rolId: Number(r.RolId), rolNombre: r.RolNombre, atributos: r.atributos })),
      'HistoricoMaxPedidos',
      escenarioId,
    );

    // null = ningún rol aplica al escenario = sin restricción
    return dias !== null ? daysAgoMontevideo(dias) : undefined;
  }, [user, escenarioId]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
      {/* Botón Flotante - Centrado verticalmente con el header */}
      <div id="tour-floating-toolbar" className="fixed top-3 right-4 z-[9999]" ref={panelRef}>
        <button
          id="tour-gear-btn"
          onClick={() => setIsOpen(!isOpen)}
          className={`
            flex items-center justify-center w-10 h-10 rounded-full shadow-2xl
            transition-all duration-300 transform hover:scale-110
            ${isOpen
              ? 'bg-gradient-to-br from-blue-600 to-blue-700 rotate-90'
              : 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700'
            }
          `}
          title="Filtros y Configuración"
        >
          <svg
            className={`w-5 h-5 text-white transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            )}
          </svg>


        </button>

        {/* Panel Expandible */}
        <div
          className={`
            absolute top-16 right-0 w-80 bg-white rounded-2xl shadow-2xl
            transition-all duration-300 transform origin-top-right
            ${isOpen
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 -translate-y-4 pointer-events-none'
            }
          `}
        >
          {/* Header del Panel */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl px-6 py-4">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Filtros y Configuración
            </h3>
          </div>

          {/* Contenido del Panel */}
          <div className="p-6 space-y-5 max-h-[calc(100vh-180px)] overflow-y-auto">
            {/* Selector de Fecha */}
            <div id="tour-date-selector" className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <span className="text-lg">📅</span>
                Fecha
              </label>
              {canChangeDate ? (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => onDateChange(e.target.value)}
                  {...(minDatePreferences !== undefined ? { min: minDatePreferences } : {})}
                  max={todayMontevideo()}
                  className="w-full px-4 py-2.5 rounded-lg border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 text-gray-700 font-medium"
                />
              ) : (
                <div className="w-full px-4 py-2.5 rounded-lg border-2 border-gray-100 bg-gray-50 text-gray-500 font-medium flex items-center gap-2 cursor-not-allowed select-none">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {selectedDate}
                </div>
              )}
            </div>

            {/* Botón de Preferencias */}
            <button
              id="tour-preferences-btn"
              onClick={() => {
                setIsPreferencesOpen(true);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 hover:from-blue-50 hover:to-blue-100 border-2 border-gray-200 hover:border-blue-300 transition-all duration-200 group"
            >
              <svg
                className="w-5 h-5 text-gray-600 group-hover:text-blue-600 group-hover:rotate-90 transition-all duration-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-semibold text-gray-700 group-hover:text-blue-700 transition-colors">
                Preferencias
              </span>
              <svg
                className="w-5 h-5 text-gray-400 group-hover:text-blue-500 ml-auto transition-all duration-200 group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Botones Admin - Solo root */}
            {isRoot(user) && (
              <div className="space-y-2">
                <button
                  onClick={() => { window.open('/admin/incidencias', '_blank'); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 border-2 border-purple-200 hover:border-purple-300 transition-all duration-200 group"
                >
                  <svg className="w-5 h-5 text-purple-600 group-hover:text-purple-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-semibold text-purple-700 group-hover:text-purple-800 transition-colors flex-1 text-left">
                    Incidentes
                  </span>
                  <svg className="w-4 h-4 text-purple-400 group-hover:text-purple-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  onClick={() => { window.open("/admin/configuracion", "_blank"); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 border-2 border-green-200 hover:border-green-300 transition-all duration-200 group"
                >
                  <svg className="w-5 h-5 text-green-600 group-hover:text-green-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <span className="font-semibold text-green-700 group-hover:text-green-800 transition-colors flex-1 text-left">
                    Configuracion
                  </span>
                  <svg className="w-4 h-4 text-green-400 group-hover:text-green-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  onClick={() => { window.open("/admin/auditoria", "_blank"); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-200 border-2 border-slate-200 hover:border-slate-300 transition-all duration-200 group"
                >
                  <svg className="w-5 h-5 text-slate-600 group-hover:text-slate-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7h-9M14 17H5m11-5a3 3 0 11-6 0 3 3 0 016 0zM7 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-semibold text-slate-700 group-hover:text-slate-800 transition-colors flex-1 text-left">
                    Logs / Auditoría
                  </span>
                  <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  onClick={() => { window.open("/admin/login-blocks", "_blank"); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 border-2 border-red-200 hover:border-red-300 transition-all duration-200 group"
                >
                  <svg className="w-5 h-5 text-red-600 group-hover:text-red-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="font-semibold text-red-700 group-hover:text-red-800 transition-colors flex-1 text-left">
                    Bloqueos de Login
                  </span>
                  <svg className="w-4 h-4 text-red-400 group-hover:text-red-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>
            )}

            {/* Separador */}
            <div className="border-t border-gray-200"></div>

            {/* Info del Usuario */}
            <div id="tour-user-info" className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-100">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">
                  {user?.username || 'Usuario'}
                </p>
                <p className="text-xs text-gray-500">
                  {user?.email || 'Sin email'}
                </p>
              </div>
            </div>

            {/* Botón de Cerrar Sesión */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 border-2 border-red-200 hover:border-red-300 transition-all duration-200 group"
            >
              <svg
                className="w-5 h-5 text-red-600 group-hover:text-red-700 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="font-semibold text-red-700 group-hover:text-red-800 transition-colors">
                Cerrar Sesión
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Backdrop cuando está abierto */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[9998] transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Modal de Preferencias */}
      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onSave={handlePreferencesSave}
      />
    </>
  );
}
