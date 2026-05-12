'use client';

import { useEffect, useState } from 'react';

/**
 * Banner amarillo no-bloqueante que se muestra en el dashboard cuando el usuario
 * acaba de loguearse con nombre de usuario == contraseña. La señal se levanta en
 * /login (sessionStorage flag) y este componente la consume + la borra al
 * descartarse.
 *
 * Persiste durante la sesión hasta que el usuario lo cierra explícitamente.
 */

const STORAGE_KEY = 'trackmovil:user_eq_pass_warning';

export default function UserEqPassBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') {
        setVisible(true);
      }
    } catch {
      // sessionStorage puede no estar disponible (SSR / privado), ignorar.
    }
  }, []);

  const dismiss = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[10040] pointer-events-none"
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-2.5 shadow-2xl backdrop-blur max-w-xl">
        <span className="text-lg mt-0.5" aria-hidden="true">⚠️</span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-amber-900">
            Tu nombre de usuario y contraseña son iguales
          </span>
          <span className="text-[11px] text-amber-700">
            Por seguridad, cambiá tu contraseña lo antes posible.
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar aviso"
          className="ml-1 rounded-lg p-1.5 text-amber-700 transition-colors hover:bg-amber-200/60"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
