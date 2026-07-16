'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authStorage } from '@/lib/auth-storage';
import { isRoot } from '@/lib/auth-scope';

/**
 * Config GLOBAL ÚNICA de notificación de incidentes por correo (SMTP).
 *
 * Espejo de useGlobalRealtimeSettings, contra /api/email-config (fila única id=1
 * en email_settings). GET/PUT/POST /test están gateados (root o funcionalidad
 * "Preferencias Globales") — a diferencia de /api/realtime-config, acá el GET
 * también requiere los headers de admin.
 *
 * No expone smtp_password: el server nunca la devuelve. `hasPassword` indica
 * si ya hay una password guardada (para el placeholder del input en el modal).
 */
export interface EmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  toEmails: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  toEmails: '',
  subjectTemplate: 'Nuevo incidente #{{id}} en TrackMovil',
  bodyTemplate:
    'Se reportó un incidente el {{fecha}}.\n\n' +
    'Usuario: {{usuario}}\n' +
    'Reporta: {{reporter}}\n' +
    'Celular: {{celular}}\n' +
    'Email: {{email}}\n\n' +
    'Descripción:\n{{descripcion}}\n\n' +
    'Ver detalle: {{link}}',
};

function buildAdminHeaders(user: ReturnType<typeof useAuth>['user']): Record<string, string> {
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
  if (isRootHeader !== 'S' && isRoot(user)) isRootHeader = 'S';

  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token,
    'x-track-isroot': isRootHeader,
    'x-track-funcs': trackFuncs,
    'x-track-user': username,
  };
}

export function useEmailSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<EmailSettings & { hasPassword: boolean }>({ ...DEFAULT_EMAIL_SETTINGS, hasPassword: false });
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/email-config', { headers: buildAdminHeaders(user) });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data && !cancelled) {
            const merged = { ...DEFAULT_EMAIL_SETTINGS, hasPassword: false, ...json.data };
            setSettings(merged);
            settingsRef.current = merged;
          }
        }
      } catch (e) {
        console.warn('[useEmailSettings] no se pudo cargar config de email:', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = useCallback(async (next: Partial<EmailSettings>): Promise<boolean> => {
    const merged = { ...settingsRef.current, ...next };
    setSettings(merged);
    settingsRef.current = merged;

    try {
      const res = await fetch('/api/email-config', {
        method: 'PUT',
        headers: buildAdminHeaders(user),
        body: JSON.stringify(merged),
      });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        const updated = { ...DEFAULT_EMAIL_SETTINGS, hasPassword: false, ...json.data };
        setSettings(updated);
        settingsRef.current = updated;
        return true;
      }
      console.error('[useEmailSettings] error al guardar:', json.error);
      return false;
    } catch (e) {
      console.error('[useEmailSettings] error de red al guardar:', e);
      return false;
    }
  }, [user]);

  const sendTest = useCallback(async (overrides?: Partial<EmailSettings>): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/email-config/test', {
        method: 'POST',
        headers: buildAdminHeaders(user),
        body: JSON.stringify({ ...settingsRef.current, ...overrides }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      return { ok: !!json.success, error: json.error };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error de red';
      return { ok: false, error: message };
    }
  }, [user]);

  return { settings, updateSettings, sendTest, loaded };
}
