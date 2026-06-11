'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authStorage } from '@/lib/auth-storage';
import { isRoot } from '@/lib/auth-scope';

/**
 * Config GLOBAL ÚNICA de Realtime/Intervalos (compartida por todos los usuarios).
 *
 * Reemplaza el guardado por-usuario de estos 9 campos: antes vivían en
 * user_preferences (cada usuario su fila) y un cambio de un admin no lo veían
 * los demás. Ahora se leen/escriben contra /api/realtime-config (fila única id=1).
 *
 * - GET al montar (público).
 * - updateSettings: PUT con gate (root o funcionalidad "Preferencias Globales"),
 *   con update optimista del estado local.
 */
export interface GlobalRealtimeSettings {
  realtimePollingReconcileSeconds: number;
  realtimeSilenceTimeoutSeconds: number;
  realtimeRefetchOnVisible: boolean;
  realtimeHeartbeatSeconds: number;
  realtimeEventsPerSecond: number;
  realtimePauseOnHiddenEnabled: boolean;
  realtimePauseOnHiddenMinutes: number;
  demorasPollingSeconds: number;
  movilesZonasPollingSeconds: number;
}

export const DEFAULT_GLOBAL_REALTIME_SETTINGS: GlobalRealtimeSettings = {
  realtimePollingReconcileSeconds: 60,
  realtimeSilenceTimeoutSeconds: 45,
  realtimeRefetchOnVisible: true,
  realtimeHeartbeatSeconds: 15,
  realtimeEventsPerSecond: 10,
  realtimePauseOnHiddenEnabled: false,
  realtimePauseOnHiddenMinutes: 15,
  demorasPollingSeconds: 120,
  movilesZonasPollingSeconds: 90,
};

export function useGlobalRealtimeSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<GlobalRealtimeSettings>(DEFAULT_GLOBAL_REALTIME_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef<GlobalRealtimeSettings>(DEFAULT_GLOBAL_REALTIME_SETTINGS);

  // Cargar config global al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/realtime-config');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data && !cancelled) {
            const merged = { ...DEFAULT_GLOBAL_REALTIME_SETTINGS, ...json.data };
            setSettings(merged);
            settingsRef.current = merged;
          }
        }
      } catch (e) {
        console.warn('[useGlobalRealtimeSettings] no se pudo cargar config global:', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateSettings = useCallback(async (next: Partial<GlobalRealtimeSettings>): Promise<boolean> => {
    const merged = { ...settingsRef.current, ...next };
    // Update optimista
    setSettings(merged);
    settingsRef.current = merged;

    let token = '';
    let isRootHeader = 'N';
    let username = '';
    if (typeof window !== 'undefined') {
      token = authStorage.getItem('trackmovil_token') ?? '';
      try {
        const raw = authStorage.getItem('trackmovil_user');
        if (raw) {
          const u = JSON.parse(raw) as { isRoot?: string; username?: string };
          isRootHeader = u.isRoot ?? 'N';
          username = u.username ?? '';
        }
      } catch { /* noop */ }
    }
    const trackFuncs = (user?.roles ?? []).flatMap((r) => (r.funcionalidades ?? []).map((f) => f.nombre)).join(',');
    // Asegura el header isroot también desde el helper (RolNombre === 'Root').
    if (isRootHeader !== 'S' && isRoot(user)) isRootHeader = 'S';

    try {
      const res = await fetch('/api/realtime-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'x-track-isroot': isRootHeader,
          'x-track-funcs': trackFuncs,
          'x-track-user': username,
        },
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setSettings(json.data);
        settingsRef.current = json.data;
        return true;
      }
      console.error('[useGlobalRealtimeSettings] error al guardar:', json.error);
      return false;
    } catch (e) {
      console.error('[useGlobalRealtimeSettings] error de red al guardar:', e);
      return false;
    }
  }, [user]);

  return { settings, updateSettings, loaded };
}
