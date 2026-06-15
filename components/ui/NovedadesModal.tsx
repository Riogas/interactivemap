'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authStorage } from '@/lib/auth-storage';
import type { Notificacion } from '@/types/supabase';

// ==============================================================================
// HELPERS
// ==============================================================================

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = authStorage.getItem('trackmovil_token') ?? '';
  let isRoot = 'N';
  let username = '';
  try {
    const raw = authStorage.getItem('trackmovil_user');
    if (raw) {
      const u = JSON.parse(raw) as { isRoot?: string; username?: string };
      isRoot = u.isRoot ?? 'N';
      username = u.username ?? '';
    }
  } catch { /* silencioso */ }
  return {
    Authorization: 'Bearer ' + token,
    'x-track-isroot': isRoot,
    'x-track-user': username,
    'Content-Type': 'application/json',
  };
}

// ==============================================================================
// COMPONENTE
// ==============================================================================

/**
 * NovedadesModal — muestra la notificacion de novedad pendiente al cargar el dashboard.
 *
 * Self-contained: lee el user del AuthContext y hace fetch por su cuenta.
 * No necesita props — se instancia como <NovedadesModal /> en dashboard/page.tsx.
 *
 * Flujo:
 *   1. Al montarse con un usuario valido, hace fetch a /api/notificaciones/pending.
 *   2. Si hay una notificacion pendiente → muestra el modal.
 *   3. "Entendido" → cierra + POST state viewed.
 *   4. "No recordar mas" → cierra + POST state dismissed.
 */
export default function NovedadesModal() {
  const { user } = useAuth();
  const [notif, setNotif] = useState<Notificacion | null>(null);
  const [visible, setVisible] = useState(false);

  const fetchPending = useCallback(async () => {
    if (!user) return;

    try {
      const roles = (user.roles || []).map((r) => r.RolNombre).join(',');
      const res = await fetch(
        `/api/notificaciones/pending?roles=${encodeURIComponent(roles)}`,
        { headers: getAuthHeaders() }
      );

      if (!res.ok) return;

      const json = await res.json();
      if (json.success && json.notificacion) {
        setNotif(json.notificacion);
        setVisible(true);
      }
    } catch (err) {
      // No mostrar error al usuario — el modal simplemente no aparece
      console.error('[NovedadesModal] fetchPending error:', err);
    }
  }, [user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const postState = (action: 'viewed' | 'dismissed') => {
    if (!notif) return;
    // Fire-and-forget — graceful degradation
    fetch(`/api/notificaciones/${notif.id}/state`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action }),
    }).catch((err) => {
      console.error('[NovedadesModal] postState error:', err);
    });
  };

  const handleEntendido = () => {
    setVisible(false);
    postState('viewed');
  };

  const handleNoRecordar = () => {
    setVisible(false);
    postState('dismissed');
  };

  if (!visible || !notif) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="novedad-titulo"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2 flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-indigo-200 font-medium uppercase tracking-wide">Novedad</p>
              <h2 id="novedad-titulo" className="text-lg font-bold text-white leading-tight">
                {notif.titulo}
              </h2>
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {/* Descripcion */}
          <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
            {notif.descripcion}
          </p>

          {/* Media */}
          {notif.media_url && notif.media_type === 'image' && (
            <div className="mt-4">
              <img
                src={notif.media_url}
                alt={notif.titulo}
                className="w-full rounded-xl object-cover max-h-72 border border-gray-100"
              />
            </div>
          )}

          {notif.media_url && notif.media_type === 'video' && (
            <div className="mt-4">
              <video
                src={notif.media_url}
                controls
                className="w-full rounded-xl max-h-72 border border-gray-100"
              >
                Tu navegador no soporta la reproduccion de video.
              </video>
            </div>
          )}
        </div>

        {/* Footer con botones */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50 rounded-b-2xl">
          <button
            onClick={handleNoRecordar}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            No recordar mas
          </button>
          <button
            onClick={handleEntendido}
            className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
