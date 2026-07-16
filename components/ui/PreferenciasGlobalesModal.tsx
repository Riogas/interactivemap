'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { authStorage } from '@/lib/auth-storage';
import { UserPreferences, DEFAULT_PREFERENCES } from '@/components/ui/PreferencesModal';
import { hasFuncionalidad } from '@/lib/role-funcionalidades';
import { isRoot } from '@/lib/auth-scope';
import { useGlobalRealtimeSettings } from '@/hooks/dashboard/useGlobalRealtimeSettings';
import { useEmailSettings, DEFAULT_EMAIL_SETTINGS, type EmailSettings } from '@/hooks/dashboard/useEmailSettings';
import ImportPuntosInteresModal from '@/components/ui/ImportPuntosInteresModal';

interface PreferenciasGlobalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
}

export default function PreferenciasGlobalesModal({
  isOpen,
  onClose,
  preferences,
}: PreferenciasGlobalesModalProps) {
  const { user, hasPermiso, escenarioId } = useAuth();
  const canUpdPtsVenta = hasPermiso('updptsventa');

  // Config GLOBAL de Realtime/Intervalos (compartida por todos los usuarios).
  // La sección "Realtime (avanzado)" + "Intervalos de Refresco" se lee/guarda
  // contra este store global (no en las preferencias por-usuario), para que un
  // cambio de un admin lo vean todos.
  const { settings: globalRealtime, updateSettings: updateGlobalRealtime } = useGlobalRealtimeSettings();

  // Config GLOBAL de notificación de incidentes por correo (SMTP + plantillas).
  const { settings: emailSettings, updateSettings: updateEmailSettings, sendTest: sendTestEmail } = useEmailSettings();
  const [localEmail, setLocalEmail] = useState<EmailSettings & { hasPassword: boolean }>({ ...DEFAULT_EMAIL_SETTINGS, hasPassword: false });
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    setLocalEmail(emailSettings);
  }, [emailSettings]);

  // ===== Estado para Auditoría =====
  const [auditEnabled, setAuditEnabled] = useState<boolean | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ updated_at: string; updated_by: string | null } | null>(null);
  const [auditToggling, setAuditToggling] = useState(false);

  // ===== Estado para Manual de usuario =====
  const [manualInfo, setManualInfo] = useState<{ url: string; updated_at: string | null; updated_by: string | null } | null>(null);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [uploadManualResult, setUploadManualResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [resettingManual, setResettingManual] = useState(false);

  // ===== Estado para Reconstruir móviles_dia =====
  const today = new Date().toISOString().slice(0, 10);
  const [rebuildDesde, setRebuildDesde] = useState(today);
  const [rebuildHasta, setRebuildHasta] = useState(today);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Normalize numeric slider fields so undefined/null from the server never reaches the sliders.
  const normalizePrefs = (p: UserPreferences): UserPreferences => ({
    ...p,
    realtimePollingReconcileSeconds: p.realtimePollingReconcileSeconds ?? DEFAULT_PREFERENCES.realtimePollingReconcileSeconds,
    realtimeSilenceTimeoutSeconds:   p.realtimeSilenceTimeoutSeconds   ?? DEFAULT_PREFERENCES.realtimeSilenceTimeoutSeconds,
    realtimeHeartbeatSeconds:        p.realtimeHeartbeatSeconds        ?? DEFAULT_PREFERENCES.realtimeHeartbeatSeconds,
    realtimeEventsPerSecond:         p.realtimeEventsPerSecond         ?? DEFAULT_PREFERENCES.realtimeEventsPerSecond,
    demorasPollingSeconds:           p.demorasPollingSeconds           ?? DEFAULT_PREFERENCES.demorasPollingSeconds,
    movilesZonasPollingSeconds:      p.movilesZonasPollingSeconds      ?? DEFAULT_PREFERENCES.movilesZonasPollingSeconds,
    realtimePauseOnHiddenEnabled:    p.realtimePauseOnHiddenEnabled    ?? DEFAULT_PREFERENCES.realtimePauseOnHiddenEnabled,
    realtimePauseOnHiddenMinutes:    p.realtimePauseOnHiddenMinutes    ?? DEFAULT_PREFERENCES.realtimePauseOnHiddenMinutes,
    sessionIdleTimeoutMinutes:       p.sessionIdleTimeoutMinutes       ?? DEFAULT_PREFERENCES.sessionIdleTimeoutMinutes,
  });

  // Local copy of preferences for realtime sliders (committed on save).
  // Los 9 campos de Realtime/Intervalos se overlayean desde la config GLOBAL.
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(() => ({ ...normalizePrefs(preferences), ...globalRealtime }));

  // Sync local prefs cuando cambian las preferencias del padre o la config global.
  useEffect(() => {
    setLocalPrefs({ ...normalizePrefs(preferences), ...globalRealtime });
  }, [preferences, globalRealtime]);

  // Cargar estado inicial del toggle de auditoría al abrir
  useEffect(() => {
    if (!isOpen) return;
    if (auditEnabled !== null) return;
    fetch('/api/audit/config')
      .then((r) => r.json())
      .then((j: { enabled: boolean; updated_at: string; updated_by: string | null }) => {
        setAuditEnabled(j.enabled);
        setAuditMeta({ updated_at: j.updated_at, updated_by: j.updated_by });
      })
      .catch(() => { /* silencioso */ });
  }, [isOpen, auditEnabled]);

  // Cargar info del manual actual al abrir (solo para usuarios con funcionalidad 'Subir manuales de usuario')
  const canSubirManual = isRoot(user) || hasFuncionalidad(user?.roles, 'Subir manuales de usuario');
  const canRebuildMoviles = isRoot(user) || hasFuncionalidad(user?.roles, 'Reconstruir read model moviles_dia');
  useEffect(() => {
    if (!isOpen) return;
    if (!canSubirManual) return;
    fetch('/api/manual/current')
      .then((r) => r.json())
      .then((d: { url: string; updated_at: string | null; updated_by: string | null }) => {
        setManualInfo(d);
      })
      .catch(() => { /* silencioso */ });
  }, [isOpen, canSubirManual]);

  const trackFuncs = (user?.roles ?? []).flatMap(r => (r.funcionalidades ?? []).map(f => f.nombre)).join(',');

  const handleAuditToggle = async () => {
    if (auditToggling || auditEnabled === null) return;
    const newVal = !auditEnabled;
    setAuditToggling(true);
    try {
      let token = '';
      let isRootHeader = 'N';
      if (typeof window !== 'undefined') {
        token = authStorage.getItem('trackmovil_token') ?? '';
        try {
          const raw = authStorage.getItem('trackmovil_user');
          if (raw) {
            const u = JSON.parse(raw) as { isRoot?: string };
            isRootHeader = u.isRoot ?? 'N';
          }
        } catch { /* silencioso */ }
      }
      const res = await fetch('/api/audit/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'x-track-isroot': isRootHeader,
          'x-track-funcs': trackFuncs,
        },
        body: JSON.stringify({ enabled: newVal }),
      });
      const json = await res.json() as { success: boolean; enabled: boolean; updated_at: string; updated_by: string | null; error?: string };
      if (!res.ok || !json.success) {
        console.error('[audit toggle] error:', json.error);
        return;
      }
      setAuditEnabled(json.enabled);
      setAuditMeta({ updated_at: json.updated_at, updated_by: json.updated_by });
    } catch (err) {
      console.error('[audit toggle] fetch error:', err);
    } finally {
      setAuditToggling(false);
    }
  };

  // Handler para subir el manual PDF a Supabase Storage
  const handleUploadManual = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Limpiar el input para permitir re-subir el mismo archivo
    if (e.target) e.target.value = '';

    // Validaciones client-side (el servidor también valida)
    if (file.type !== 'application/pdf') {
      setUploadManualResult({ ok: false, msg: 'Solo se aceptan archivos PDF (.pdf)' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadManualResult({ ok: false, msg: 'El archivo supera el límite de 20MB' });
      return;
    }

    setUploadingManual(true);
    setUploadManualResult(null);

    try {
      let token = '';
      let isRootHeader = 'N';
      let username = '';
      if (typeof window !== 'undefined') {
        token = authStorage.getItem('trackmovil_token') ?? '';
        try {
          const raw = authStorage.getItem('trackmovil_user');
          if (raw) {
            const u = JSON.parse(raw) as { isRoot?: string; username?: string; email?: string };
            isRootHeader = u.isRoot ?? 'N';
            username = u.username ?? u.email ?? '';
          }
        } catch { /* silencioso */ }
      }

      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/admin/upload-manual', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'x-track-isroot': isRootHeader,
          'x-track-funcs': trackFuncs,
          'x-track-user': username,
        },
        body: fd,
      });

      // Parseo defensivo: si el servidor/proxy devuelve HTML (ej. 413 Request
      // Entity Too Large, timeout, error 500 no-JSON), evitamos el críptico
      // "JSON.parse: unexpected character" y mostramos un mensaje accionable.
      const rawText = await res.text();
      let json: { success?: boolean; url?: string; uploadedAt?: string; uploadedBy?: string; error?: string } | null = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }

      if (!json) {
        const snippet = rawText.trim().slice(0, 120);
        const hint = res.status === 413
          ? 'El archivo es demasiado grande para el servidor (revisar límite del proxy/nginx).'
          : `Respuesta no válida del servidor (HTTP ${res.status}).`;
        setUploadManualResult({ ok: false, msg: snippet ? `${hint} ${snippet}` : hint });
        return;
      }

      if (json.success && json.url) {
        setManualInfo({
          url: json.url,
          updated_at: json.uploadedAt ?? null,
          updated_by: json.uploadedBy ?? null,
        });
        setUploadManualResult({ ok: true, msg: 'Manual actualizado correctamente' });
      } else {
        setUploadManualResult({ ok: false, msg: json.error ?? `Error al subir el manual (HTTP ${res.status})` });
      }
    } catch (err: any) {
      setUploadManualResult({ ok: false, msg: `Error al subir: ${err.message}` });
    } finally {
      setUploadingManual(false);
    }
  }, [trackFuncs]);

  // Repunta el manual al PDF estático del sistema (public/manual/...), limpiando
  // cualquier override en la base. Útil cuando el manual viaja con el deploy y se
  // quiere evitar la subida a Storage (límite de tamaño del proxy).
  const handleResetManual = useCallback(async () => {
    setResettingManual(true);
    setUploadManualResult(null);
    try {
      let token = '';
      let isRootHeader = 'N';
      let username = '';
      if (typeof window !== 'undefined') {
        token = authStorage.getItem('trackmovil_token') ?? '';
        try {
          const raw = authStorage.getItem('trackmovil_user');
          if (raw) {
            const u = JSON.parse(raw) as { isRoot?: string; username?: string; email?: string };
            isRootHeader = u.isRoot ?? 'N';
            username = u.username ?? u.email ?? '';
          }
        } catch { /* silencioso */ }
      }

      const res = await fetch('/api/admin/reset-manual', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'x-track-isroot': isRootHeader,
          'x-track-funcs': trackFuncs,
          'x-track-user': username,
        },
      });

      const rawText = await res.text();
      let json: { success?: boolean; url?: string; uploadedAt?: string; uploadedBy?: string; error?: string } | null = null;
      try { json = rawText ? JSON.parse(rawText) : null; } catch { json = null; }

      if (json?.success && json.url) {
        setManualInfo({ url: json.url, updated_at: json.uploadedAt ?? null, updated_by: json.uploadedBy ?? null });
        setUploadManualResult({ ok: true, msg: 'Manual restablecido al PDF del sistema' });
      } else {
        setUploadManualResult({ ok: false, msg: json?.error ?? `No se pudo restablecer (HTTP ${res.status})` });
      }
    } catch (err: any) {
      setUploadManualResult({ ok: false, msg: `Error al restablecer: ${err.message}` });
    } finally {
      setResettingManual(false);
    }
  }, [trackFuncs]);

  const rebuildRangeDays = (() => {
    const d0 = new Date(rebuildDesde);
    const d1 = new Date(rebuildHasta);
    if (isNaN(d0.getTime()) || isNaN(d1.getTime())) return -1;
    return Math.round((d1.getTime() - d0.getTime()) / (1000 * 60 * 60 * 24));
  })();
  const rebuildRangeValid = rebuildRangeDays >= 0 && rebuildRangeDays <= 180;

  const handleRebuildMovilesDia = async () => {
    if (rebuilding || !rebuildRangeValid) return;
    setRebuilding(true);
    setRebuildResult(null);
    try {
      let token = '';
      let isRootHeader = 'N';
      if (typeof window !== 'undefined') {
        token = authStorage.getItem('trackmovil_token') ?? '';
        try {
          const raw = authStorage.getItem('trackmovil_user');
          if (raw) {
            const u = JSON.parse(raw) as { isRoot?: string };
            isRootHeader = u.isRoot ?? 'N';
          }
        } catch { /* silencioso */ }
      }
      const res = await fetch('/api/moviles-dia/rebuild', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'x-track-isroot': isRootHeader,
          'x-track-funcs': trackFuncs,
        },
        body: JSON.stringify({ desde: rebuildDesde, hasta: rebuildHasta, escenario: escenarioId }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setRebuildResult({ ok: true, msg: `Reconstrucción completada (${rebuildDesde} → ${rebuildHasta})` });
      } else {
        setRebuildResult({ ok: false, msg: json.error ?? 'Error desconocido' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de red';
      setRebuildResult({ ok: false, msg });
    } finally {
      setRebuilding(false);
    }
  };

  const handleSaveRealtime = async () => {
    // Estos 9 campos son configuración GLOBAL ÚNICA del sistema: se guardan en
    // /api/realtime-config (no en las preferencias por-usuario) para que el
    // cambio lo vean todos los usuarios logueados.
    await updateGlobalRealtime({
      realtimePollingReconcileSeconds: localPrefs.realtimePollingReconcileSeconds,
      realtimeSilenceTimeoutSeconds:   localPrefs.realtimeSilenceTimeoutSeconds,
      realtimeRefetchOnVisible:        localPrefs.realtimeRefetchOnVisible,
      realtimeHeartbeatSeconds:        localPrefs.realtimeHeartbeatSeconds,
      realtimeEventsPerSecond:         localPrefs.realtimeEventsPerSecond,
      demorasPollingSeconds:           localPrefs.demorasPollingSeconds,
      movilesZonasPollingSeconds:      localPrefs.movilesZonasPollingSeconds,
      realtimePauseOnHiddenEnabled:    localPrefs.realtimePauseOnHiddenEnabled ?? false,
      realtimePauseOnHiddenMinutes:    localPrefs.realtimePauseOnHiddenMinutes ?? 15,
      sessionIdleTimeoutMinutes:       localPrefs.sessionIdleTimeoutMinutes ?? 480,
    });
    // Config de notificación de incidentes por correo (misma acción de guardado).
    await updateEmailSettings({
      enabled: localEmail.enabled,
      smtpHost: localEmail.smtpHost,
      smtpPort: localEmail.smtpPort,
      smtpSecure: localEmail.smtpSecure,
      smtpUser: localEmail.smtpUser,
      smtpPassword: localEmail.smtpPassword, // vacío = conserva la anterior (lo resuelve el PUT)
      fromEmail: localEmail.fromEmail,
      toEmails: localEmail.toEmails,
      subjectTemplate: localEmail.subjectTemplate,
      bodyTemplate: localEmail.bodyTemplate,
    });
    onClose();
  };

  const handleSendTestEmail = async () => {
    if (testEmailSending) return;
    setTestEmailSending(true);
    setTestEmailResult(null);
    try {
      const result = await sendTestEmail({
        enabled: localEmail.enabled,
        smtpHost: localEmail.smtpHost,
        smtpPort: localEmail.smtpPort,
        smtpSecure: localEmail.smtpSecure,
        smtpUser: localEmail.smtpUser,
        smtpPassword: localEmail.smtpPassword,
        fromEmail: localEmail.fromEmail,
        toEmails: localEmail.toEmails,
        subjectTemplate: localEmail.subjectTemplate,
        bodyTemplate: localEmail.bodyTemplate,
      });
      setTestEmailResult(result);
    } finally {
      setTestEmailSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl z-[70]"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-gradient-to-r from-purple-600 to-indigo-700 text-white px-6 py-4 rounded-t-2xl border-b border-purple-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-lg p-2">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Preferencias Globales</h2>
                    <p className="text-xs text-purple-100">Configuración administrativa del sistema</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">

              {/* ===== Realtime avanzado ===== */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <span className="text-sm font-bold text-gray-800">Realtime (avanzado)</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-100 text-purple-700">ADMIN</span>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Configuración global de la conexión Realtime. Afecta a todos los usuarios logueados. Cambios en Heartbeat y Eventos/seg requieren recargar la página.
                </p>

                {/* Polling reconciliación */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Polling de reconciliación</label>
                  <p className="text-xs text-gray-500">
                    Cada cuántos segundos refrescar los datos completos aunque Realtime esté conectado. Cubre eventos perdidos por desconexiones silenciosas. 0 = desactivado.
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="600"
                      step="5"
                      value={localPrefs.realtimePollingReconcileSeconds ?? DEFAULT_PREFERENCES.realtimePollingReconcileSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimePollingReconcileSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {(localPrefs.realtimePollingReconcileSeconds ?? DEFAULT_PREFERENCES.realtimePollingReconcileSeconds) === 0 ? 'off' : `${localPrefs.realtimePollingReconcileSeconds ?? DEFAULT_PREFERENCES.realtimePollingReconcileSeconds}s`}
                    </span>
                  </div>
                </div>

                {/* Silence timeout */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Timeout de silencio del WS</label>
                  <p className="text-xs text-gray-500">
                    Si no llega ningún evento Realtime en este lapso, forzar reconexión + refetch. Protege contra WS &quot;zombie&quot; (aparenta conectado pero no recibe nada). 0 = desactivado.
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="300"
                      step="5"
                      value={localPrefs.realtimeSilenceTimeoutSeconds ?? DEFAULT_PREFERENCES.realtimeSilenceTimeoutSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeSilenceTimeoutSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {(localPrefs.realtimeSilenceTimeoutSeconds ?? DEFAULT_PREFERENCES.realtimeSilenceTimeoutSeconds) === 0 ? 'off' : `${localPrefs.realtimeSilenceTimeoutSeconds ?? DEFAULT_PREFERENCES.realtimeSilenceTimeoutSeconds}s`}
                    </span>
                  </div>
                </div>

                {/* Refetch al volver visible */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-semibold text-gray-700">Refetch al volver al tab</div>
                    <div className="text-xs text-gray-500">
                      Cuando la pestaña sale de segundo plano, hacer refetch de pedidos y services. Cubre cuando Chrome baja la prioridad de los WS en tabs inactivos.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalPrefs({ ...localPrefs, realtimeRefetchOnVisible: !localPrefs.realtimeRefetchOnVisible })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${localPrefs.realtimeRefetchOnVisible ? 'bg-purple-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localPrefs.realtimeRefetchOnVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Heartbeat */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Heartbeat del WS <span className="text-[10px] font-normal text-amber-600 ml-1">⚠ requiere recarga</span>
                  </label>
                  <p className="text-xs text-gray-500">
                    Cada cuánto el cliente Supabase manda un &quot;ping&quot; al server. Valores más bajos detectan caídas antes pero gastan más red.
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="5"
                      max="60"
                      step="1"
                      value={localPrefs.realtimeHeartbeatSeconds ?? DEFAULT_PREFERENCES.realtimeHeartbeatSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeHeartbeatSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimeHeartbeatSeconds ?? DEFAULT_PREFERENCES.realtimeHeartbeatSeconds}s
                    </span>
                  </div>
                </div>

                {/* Events per second */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Eventos/seg máx <span className="text-[10px] font-normal text-amber-600 ml-1">⚠ requiere recarga</span>
                  </label>
                  <p className="text-xs text-gray-500">
                    Tope de eventos por segundo que el cliente acepta del Realtime. Si hay bursts legítimos de muchos cambios simultáneos y estás perdiendo data, subir este valor.
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={localPrefs.realtimeEventsPerSecond ?? DEFAULT_PREFERENCES.realtimeEventsPerSecond}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeEventsPerSecond: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimeEventsPerSecond ?? DEFAULT_PREFERENCES.realtimeEventsPerSecond}/s
                    </span>
                  </div>
                </div>

                {/* Pausar Realtime con tab oculto */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-semibold text-gray-700">Pausar Realtime con tab oculto</div>
                    <div className="text-xs text-gray-500">
                      Si el tab se queda oculto por más del tiempo configurado, desconectar los canales Realtime para liberar recursos. Al volver visible se reconecta + refetch automático. NO afecta cuando la pestaña vuelve antes del tiempo.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalPrefs({ ...localPrefs, realtimePauseOnHiddenEnabled: !localPrefs.realtimePauseOnHiddenEnabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${localPrefs.realtimePauseOnHiddenEnabled ? 'bg-purple-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localPrefs.realtimePauseOnHiddenEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Minutos antes de pausar — solo visible/activo cuando toggle ON */}
                <div className={`space-y-2 ${!localPrefs.realtimePauseOnHiddenEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                  <label className="text-sm font-semibold text-gray-700">Minutos antes de pausar</label>
                  <p className="text-xs text-gray-500">
                    Tiempo de gracia. Default 15 min. Valores bajos = más ahorro pero más resync al alternar tabs. Valores altos = menos resync pero más recursos consumidos en background.
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="5"
                      max="60"
                      step="1"
                      value={localPrefs.realtimePauseOnHiddenMinutes ?? DEFAULT_PREFERENCES.realtimePauseOnHiddenMinutes}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimePauseOnHiddenMinutes: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimePauseOnHiddenMinutes ?? DEFAULT_PREFERENCES.realtimePauseOnHiddenMinutes} min
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* ===== Intervalos de Refresco Automático ===== */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔄</span>
                  <span className="text-sm font-bold text-gray-800">Intervalos de Refresco Automático</span>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Configura cada cuántos segundos se actualizan los datos de las vistas Demoras y Móviles en Zonas.
                </p>
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠️ Aplica únicamente para móviles asociados a zonas y para la vista de Demoras. No afecta la actualización general del mapa.
                </p>

                {/* Demoras polling */}
                <div className="p-3 bg-red-50/50 rounded-lg border border-red-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">⏱️</span>
                    <span className="text-xs font-semibold text-gray-600">Vista Demoras</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="10"
                      max="120"
                      step="5"
                      value={localPrefs.demorasPollingSeconds ?? DEFAULT_PREFERENCES.demorasPollingSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, demorasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-red-100 text-red-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.demorasPollingSeconds ?? DEFAULT_PREFERENCES.demorasPollingSeconds}s
                    </span>
                  </div>
                </div>

                {/* Moviles x Zona polling */}
                <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🚛</span>
                    <span className="text-xs font-semibold text-gray-600">Vista Móviles en Zonas</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="10"
                      max="120"
                      step="5"
                      value={localPrefs.movilesZonasPollingSeconds ?? DEFAULT_PREFERENCES.movilesZonasPollingSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, movilesZonasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.movilesZonasPollingSeconds ?? DEFAULT_PREFERENCES.movilesZonasPollingSeconds}s
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* ===== Inactividad de sesión ===== */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏰</span>
                  <span className="text-sm font-bold text-gray-800">Inactividad de sesión</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
                </div>
                <p className="text-xs text-gray-500 -mt-1">
                  Minutos de inactividad antes de cerrar la sesión automáticamente. Aplica a todos los usuarios. Un usuario puede tener un tiempo mayor vía el atributo de rol <code className="px-1 bg-gray-100 rounded">TiempoInactividadMin</code> (gana sobre este global). Default 480 (8 h).
                </p>
                <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 flex items-center gap-4">
                  <label className="text-sm font-semibold text-gray-700 flex-1">Timeout global (minutos)</label>
                  <input
                    type="number"
                    min={5}
                    max={100000}
                    value={localPrefs.sessionIdleTimeoutMinutes ?? DEFAULT_PREFERENCES.sessionIdleTimeoutMinutes}
                    onChange={(e) => setLocalPrefs({ ...localPrefs, sessionIdleTimeoutMinutes: Math.max(5, Math.min(100000, parseInt(e.target.value) || 5)) })}
                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔍</span>
                  <span className="text-sm font-bold text-gray-800">Auditoría</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Cuando está ACTIVO, se registran todas las acciones de los usuarios (navegación, llamadas API, etc.).
                  Por defecto está apagado para no consumir espacio en la base.
                </p>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-semibold text-gray-700">Auditar actividad de usuarios</div>
                    {auditMeta && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Última actualización:{" "}
                        {new Date(auditMeta.updated_at).toLocaleString("es-UY", {
                          day: "2-digit", month: "2-digit", year: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                        {auditMeta.updated_by ? <> por <strong>{auditMeta.updated_by}</strong></> : null}
                      </div>
                    )}
                    {auditEnabled === null && (
                      <div className="text-xs text-gray-400 mt-0.5">Cargando...</div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={auditToggling || auditEnabled === null}
                    onClick={() => void handleAuditToggle()}
                    className={[
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
                      auditEnabled ? "bg-red-500" : "bg-gray-200",
                      auditToggling ? "opacity-50 cursor-not-allowed" : "",
                    ].join(" ")}
                    title={auditToggling ? "Actualizando..." : auditEnabled ? "Desactivar auditoría" : "Activar auditoría"}
                  >
                    <span className={["inline-block h-4 w-4 transform rounded-full bg-white transition-transform", auditEnabled ? "translate-x-6" : "translate-x-1"].join(" ")} />
                  </button>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* ===== Notificación de incidentes por correo ===== */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📧</span>
                  <span className="text-sm font-bold text-gray-800">Notificación de incidentes por correo</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Al cargar un incidente, además de guardarse en la base, se puede enviar un correo por SMTP
                  a una o varias casillas. El envío nunca bloquea la carga del incidente aunque falle.
                </p>

                {/* Toggle enabled */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-semibold text-gray-700">Enviar mail al cargar incidente</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalEmail({ ...localEmail, enabled: !localEmail.enabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${localEmail.enabled ? 'bg-red-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localEmail.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* SMTP host + port */}
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-gray-600">Servidor SMTP</label>
                    <input
                      type="text"
                      placeholder="smtp.ejemplo.com"
                      value={localEmail.smtpHost}
                      onChange={(e) => setLocalEmail({ ...localEmail, smtpHost: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <label className="text-xs font-semibold text-gray-600">Puerto</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={localEmail.smtpPort}
                      onChange={(e) => setLocalEmail({ ...localEmail, smtpPort: parseInt(e.target.value) || DEFAULT_EMAIL_SETTINGS.smtpPort })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-center"
                    />
                  </div>
                </div>

                {/* Conexión segura */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-semibold text-gray-700">Conexión segura SSL/TLS</div>
                    <div className="text-xs text-gray-500">Activar para puerto 465. Puerto 587 usualmente va con STARTTLS (desactivado).</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalEmail({ ...localEmail, smtpSecure: !localEmail.smtpSecure })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${localEmail.smtpSecure ? 'bg-red-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${localEmail.smtpSecure ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* SMTP user + password */}
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-gray-600">Usuario SMTP</label>
                    <input
                      type="text"
                      value={localEmail.smtpUser}
                      onChange={(e) => setLocalEmail({ ...localEmail, smtpUser: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-semibold text-gray-600">Contraseña SMTP</label>
                    <input
                      type="password"
                      placeholder={localEmail.hasPassword ? '•••• (sin cambios)' : ''}
                      value={localEmail.smtpPassword}
                      onChange={(e) => setLocalEmail({ ...localEmail, smtpPassword: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                  </div>
                </div>

                {/* From + to */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Remitente (From)</label>
                  <input
                    type="text"
                    placeholder="notificaciones@ejemplo.com"
                    value={localEmail.fromEmail}
                    onChange={(e) => setLocalEmail({ ...localEmail, fromEmail: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Destinatarios (separados por coma)</label>
                  <input
                    type="text"
                    placeholder="soporte@ejemplo.com, jefe@ejemplo.com"
                    value={localEmail.toEmails}
                    onChange={(e) => setLocalEmail({ ...localEmail, toEmails: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>

                {/* Plantillas */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Plantilla de asunto</label>
                  <input
                    type="text"
                    value={localEmail.subjectTemplate}
                    onChange={(e) => setLocalEmail({ ...localEmail, subjectTemplate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Plantilla de cuerpo</label>
                  <textarea
                    rows={5}
                    value={localEmail.bodyTemplate}
                    onChange={(e) => setLocalEmail({ ...localEmail, bodyTemplate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 font-mono"
                  />
                  <p className="text-xs text-gray-400">
                    Variables disponibles: <code className="px-1 bg-gray-100 rounded">{'{{id}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{usuario}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{reporter}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{celular}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{email}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{descripcion}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{fecha}}'}</code>{' '}
                    <code className="px-1 bg-gray-100 rounded">{'{{link}}'}</code>
                  </p>
                </div>

                <button
                  type="button"
                  disabled={testEmailSending}
                  onClick={() => void handleSendTestEmail()}
                  className={[
                    'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                    testEmailSending
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-red-500 hover:bg-red-600 text-white shadow hover:shadow-md',
                  ].join(' ')}
                >
                  {testEmailSending ? 'Enviando...' : 'Enviar prueba'}
                </button>

                {testEmailResult && (
                  <div className={`text-sm px-4 py-3 rounded-lg border ${testEmailResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {testEmailResult.ok ? 'Correo de prueba enviado correctamente.' : (testEmailResult.error ?? 'Error al enviar el correo de prueba.')}
                  </div>
                )}
              </div>

              <hr className="border-gray-200" />

              {/* ===== Importar Puntos de Interés ===== */}
              {canUpdPtsVenta && (
                <ImportPuntosInteresModal
                  isOpen={true}
                  embedded
                  onClose={() => {}}
                  user={user}
                />
              )}

              {/* ===== Manual de usuario ===== */}
              {/* ===== Reconstruir lista de móviles ===== */}
              {canRebuildMoviles && (
                <>
                  <hr className="border-gray-200" />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🔧</span>
                      <span className="text-sm font-bold text-gray-800">Reconstruir lista de móviles</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-700">ROOT</span>
                    </div>
                    <p className="text-xs text-gray-500 -mt-2">
                      Reconstruye la tabla del día (completo) o de fechas pasadas (reducido). Máximo 180 días.
                    </p>

                    <div className="flex items-end gap-3">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-semibold text-gray-600">Desde</label>
                        <input
                          type="date"
                          value={rebuildDesde}
                          onChange={(e) => { setRebuildDesde(e.target.value); setRebuildResult(null); }}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-semibold text-gray-600">Hasta</label>
                        <input
                          type="date"
                          value={rebuildHasta}
                          onChange={(e) => { setRebuildHasta(e.target.value); setRebuildResult(null); }}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                    </div>

                    {!rebuildRangeValid && rebuildDesde && rebuildHasta && (
                      <p className="text-xs text-red-600">
                        {rebuildRangeDays < 0
                          ? '"Hasta" debe ser igual o posterior a "Desde".'
                          : 'El rango no puede superar 180 días.'}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={rebuilding || !rebuildRangeValid}
                      onClick={() => void handleRebuildMovilesDia()}
                      className={[
                        "px-4 py-2 text-sm font-medium rounded-lg transition-all",
                        rebuilding || !rebuildRangeValid
                          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                          : "bg-orange-500 hover:bg-orange-600 text-white shadow hover:shadow-md",
                      ].join(" ")}
                    >
                      {rebuilding ? "Reconstruyendo..." : "Reconstruir"}
                    </button>

                    {rebuildResult && (
                      <div className={`text-sm px-4 py-3 rounded-lg border ${rebuildResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {rebuildResult.msg}
                      </div>
                    )}
                  </div>
                </>
              )}

              {canSubirManual && (
                <>
                  <hr className="border-gray-200" />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📘</span>
                      <span className="text-sm font-bold text-gray-800">Manual de usuario</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-100 text-indigo-700">ADMIN</span>
                    </div>
                    <p className="text-xs text-gray-500 -mt-2">
                      Subí un nuevo manual (.pdf, máx 20MB). Reemplaza al actual para todos los usuarios — el botón&nbsp;? del dashboard apuntará al nuevo archivo.
                    </p>

                    {/* Info del manual actual */}
                    {manualInfo && (
                      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                        <span>Actual: </span>
                        <a
                          href={manualInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline font-medium"
                        >
                          descargar
                        </a>
                        {manualInfo.updated_at && (
                          <span className="ml-2">
                            · Actualizado:{' '}
                            {new Date(manualInfo.updated_at).toLocaleString('es-UY', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {manualInfo.updated_by ? (
                              <> por <strong>{manualInfo.updated_by}</strong></>
                            ) : null}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Drop zone para subir nuevo PDF */}
                    <div
                      className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
                      onClick={() => document.getElementById('manual-upload-input')?.click()}
                    >
                      <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm text-gray-600 font-medium">
                        {uploadingManual ? 'Subiendo manual...' : 'Seleccionar archivo .pdf'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Haz clic para elegir el archivo (máx 20MB)</p>
                      <input
                        id="manual-upload-input"
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={handleUploadManual}
                        disabled={uploadingManual}
                      />
                    </div>

                    {/* Acción: restablecer al PDF estático del sistema (sin subir archivo).
                        Repunta el override de la base al manual que viaja con el deploy.
                        Evita el límite de tamaño del proxy en la subida de PDFs grandes. */}
                    <button
                      type="button"
                      disabled={resettingManual || uploadingManual}
                      onClick={() => void handleResetManual()}
                      className={[
                        'w-full px-4 py-2 text-sm font-medium rounded-lg border transition-all',
                        resettingManual || uploadingManual
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300',
                      ].join(' ')}
                      title="Hace que el botón ? descargue el manual incluido con el sistema (public/manual)"
                    >
                      {resettingManual ? 'Restableciendo...' : 'Restablecer al manual del sistema'}
                    </button>

                    {uploadManualResult && (
                      <div
                        className={`text-sm px-4 py-3 rounded-lg border ${
                          uploadManualResult.ok
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-red-50 border-red-200 text-red-700'
                        }`}
                      >
                        {uploadManualResult.msg}
                      </div>
                    )}
                  </div>
                </>
              )}

            </div>

            {/* Footer */}
            <div className="sticky bottom-0 z-10 bg-gray-50 px-6 py-4 rounded-b-2xl border-t border-gray-200 flex items-center justify-end gap-4">
              <button
                onClick={onClose}
                className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveRealtime}
                className="px-6 py-2.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-lg hover:shadow-xl transition-all"
              >
                💾 Guardar
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
