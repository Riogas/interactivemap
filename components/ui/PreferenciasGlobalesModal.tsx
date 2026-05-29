'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { authStorage } from '@/lib/auth-storage';
import * as XLSX from 'xlsx';
import { UserPreferences } from '@/components/ui/PreferencesModal';

interface PreferenciasGlobalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
}

export default function PreferenciasGlobalesModal({
  isOpen,
  onClose,
  preferences,
  onPreferencesChange,
}: PreferenciasGlobalesModalProps) {
  const { user, hasPermiso, escenarioId } = useAuth();
  const canUpdPtsVenta = hasPermiso('updptsventa');

  // ===== Estado para importar Puntos de Interés =====
  const poiFileInputRef = useRef<HTMLInputElement>(null);
  const [importingPOI, setImportingPOI] = useState(false);
  const [importResultPOI, setImportResultPOI] = useState<{ ok: boolean; msg: string; replaced?: Array<{ deletedId: number; newId: number; nombre: string; usuario_email: string }> } | null>(null);

  // ===== Estado para Auditoría =====
  const [auditEnabled, setAuditEnabled] = useState<boolean | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ updated_at: string; updated_by: string | null } | null>(null);
  const [auditToggling, setAuditToggling] = useState(false);

  // ===== Estado para Manual de usuario =====
  const [manualInfo, setManualInfo] = useState<{ url: string; updated_at: string | null; updated_by: string | null } | null>(null);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [uploadManualResult, setUploadManualResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // ===== Estado para Reconstruir móviles_dia =====
  const today = new Date().toISOString().slice(0, 10);
  const [rebuildDesde, setRebuildDesde] = useState(today);
  const [rebuildHasta, setRebuildHasta] = useState(today);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Local copy of preferences for realtime sliders (committed on save)
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(preferences);

  // Sync local prefs when parent preferences change (e.g., loaded from DB)
  useEffect(() => {
    setLocalPrefs(preferences);
  }, [preferences]);

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

  // Cargar info del manual actual al abrir (solo para root)
  useEffect(() => {
    if (!isOpen) return;
    if (user?.isRoot !== 'S') return;
    fetch('/api/manual/current')
      .then((r) => r.json())
      .then((d: { url: string; updated_at: string | null; updated_by: string | null }) => {
        setManualInfo(d);
      })
      .catch(() => { /* silencioso */ });
  }, [isOpen, user?.isRoot]);

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

  const handleImportPOI = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (poiFileInputRef.current) poiFileInputRef.current.value = '';

    setImportingPOI(true);
    setImportResultPOI(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      if (raw.length < 2) {
        setImportResultPOI({ ok: false, msg: 'El archivo no tiene filas de datos.' });
        setImportingPOI(false);
        return;
      }

      const headers: string[] = (raw[0] as string[]).map(h => String(h ?? '').trim());
      const idxExact = (...names: string[]) => {
        for (const name of names) {
          const i = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
          if (i >= 0) return i;
        }
        return -1;
      };
      const idxIncludes = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

      const iId          = idxExact('ID', 'id');
      const iNombre      = idxExact('Nombre', 'name') >= 0 ? idxExact('Nombre', 'name') : idxIncludes('Nombre Corto');
      const iDescripcion = idxExact('Descripcion', 'Descripción', 'description');
      const iLatitud     = idxExact('Latitud', 'lat') >= 0 ? idxExact('Latitud', 'lat') : idxIncludes('CoordX');
      const iLongitud    = idxExact('Longitud', 'lng', 'lon') >= 0 ? idxExact('Longitud', 'lng', 'lon') : idxIncludes('CoordY');
      const iTipo        = idxExact('tipo', 'Tipo');
      const iVisible     = idxExact('Visible', 'visible');
      const iVisibilidad = idxIncludes('Visibilidad');
      const iCategoria   = idxExact('Categoria', 'Categoría', 'category');
      const iTelefono    = idxExact('Telefono', 'Teléfono', 'phone');
      const iDireccion   = idxIncludes('Direccion');
      const iObs         = idxIncludes('Observaciones');
      const iEscenario   = idxIncludes('escenario');
      const iEmpresa     = idxIncludes('empresa');

      const email = user?.email || user?.username || 'admin@trackmovil';

      const rows = raw.slice(1).filter(r => r[iId] != null).map(r => {
        let descripcionFinal: string | null = null;
        if (iDescripcion >= 0) {
          const v = String(r[iDescripcion] ?? '').trim();
          descripcionFinal = v || null;
        } else {
          const direccion     = iDireccion >= 0 ? String(r[iDireccion] ?? '').trim() : '';
          const observaciones = iObs >= 0 ? String(r[iObs] ?? '').trim() : '';
          descripcionFinal = [direccion, observaciones].filter(Boolean).join(' — ') || null;
        }

        let tipo: 'publico' | 'privado';
        let visible: boolean;
        if (iTipo >= 0) {
          const t = String(r[iTipo] ?? '').toLowerCase().trim();
          tipo = t === 'publico' || t === 'público' || t === 'public' ? 'publico' : 'privado';
        } else if (iVisibilidad >= 0) {
          const v = String(r[iVisibilidad] ?? '').toLowerCase().trim();
          tipo = v === 'publico' || v === 'público' || v === 'public' ? 'publico' : 'privado';
        } else {
          tipo = 'privado';
        }
        if (iVisible >= 0) {
          const v = String(r[iVisible] ?? '').toLowerCase().trim();
          visible = v === 'true' || v === '1' || v === 'si' || v === 'sí';
        } else if (iVisibilidad >= 0) {
          const v = String(r[iVisibilidad] ?? '').toLowerCase().trim();
          visible = v === 'publico' || v === 'público' || v === 'true' || v === '1';
        } else {
          visible = true;
        }

        return {
          id:                 Number(r[iId]),
          nombre:             String(r[iNombre] ?? '').trim(),
          categoria:          iCategoria >= 0 ? String(r[iCategoria] ?? '').trim() || null : null,
          latitud:            Number(r[iLatitud]),
          longitud:           Number(r[iLongitud]),
          telefono:           r[iTelefono] ? Number(r[iTelefono]) : null,
          descripcion:        descripcionFinal,
          visible,
          tipo,
          icono:              '📍',
          usuario_email:      email,
          escenario_id:       iEscenario >= 0 && r[iEscenario] != null ? Number(r[iEscenario]) : null,
          empresa_fletera_id: iEmpresa >= 0 && r[iEmpresa] != null ? Number(r[iEmpresa]) : null,
        };
      });

      if (rows.length === 0) {
        setImportResultPOI({ ok: false, msg: 'No se encontraron filas válidas (falta columna ID*).' });
        setImportingPOI(false);
        return;
      }

      const res = await fetch('/api/import/puntos-interes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        const parts: string[] = [];
        if (json.created?.length) parts.push(`${json.created.length} creado(s)/actualizado(s)`);
        if (json.replaced?.length) parts.push(`${json.replaced.length} reemplazado(s) (mismo nombre, id distinto)`);
        if (!parts.length) parts.push('0 cambios');
        setImportResultPOI({
          ok: true,
          msg: `✅ ${parts.join(' · ')}`,
          replaced: json.replaced ?? [],
        });
      } else {
        setImportResultPOI({ ok: false, msg: `❌ Error: ${json.error || 'Error desconocido'}` });
      }
    } catch (err: any) {
      setImportResultPOI({ ok: false, msg: `❌ Error al leer el archivo: ${err.message}` });
    } finally {
      setImportingPOI(false);
    }
  }, [user]);

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
          'x-track-user': username,
        },
        body: fd,
      });
      const json = await res.json() as { success: boolean; url?: string; uploadedAt?: string; uploadedBy?: string; error?: string };

      if (json.success && json.url) {
        setManualInfo({
          url: json.url,
          updated_at: json.uploadedAt ?? null,
          updated_by: json.uploadedBy ?? null,
        });
        setUploadManualResult({ ok: true, msg: 'Manual actualizado correctamente' });
      } else {
        setUploadManualResult({ ok: false, msg: json.error ?? 'Error al subir el manual' });
      }
    } catch (err: any) {
      setUploadManualResult({ ok: false, msg: `Error al subir: ${err.message}` });
    } finally {
      setUploadingManual(false);
    }
  }, []);

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

  const handleSaveRealtime = () => {
    onPreferencesChange(localPrefs);
    onClose();
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
                      value={localPrefs.realtimePollingReconcileSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimePollingReconcileSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimePollingReconcileSeconds === 0 ? 'off' : `${localPrefs.realtimePollingReconcileSeconds}s`}
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
                      value={localPrefs.realtimeSilenceTimeoutSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeSilenceTimeoutSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimeSilenceTimeoutSeconds === 0 ? 'off' : `${localPrefs.realtimeSilenceTimeoutSeconds}s`}
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
                      value={localPrefs.realtimeHeartbeatSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeHeartbeatSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimeHeartbeatSeconds}s
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
                      value={localPrefs.realtimeEventsPerSecond}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, realtimeEventsPerSecond: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.realtimeEventsPerSecond}/s
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
                      value={localPrefs.demorasPollingSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, demorasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-red-100 text-red-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.demorasPollingSeconds}s
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
                      value={localPrefs.movilesZonasPollingSeconds}
                      onChange={(e) => setLocalPrefs({ ...localPrefs, movilesZonasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-center text-xs">
                      {localPrefs.movilesZonasPollingSeconds}s
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* ===== Auditoría ===== */}
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

              {/* ===== Importar Puntos de Interés ===== */}
              {canUpdPtsVenta && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📍</span>
                    <span className="text-sm font-bold text-gray-800">Importar Puntos de Interés</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700">ADMIN</span>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2">
                    Importa o actualiza los puntos de interés desde un archivo Excel&nbsp;(.xlsx). Los registros existentes serán sobreescritos por ID.
                  </p>

                  <details className="rounded-lg border border-gray-200 bg-gray-50">
                    <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-gray-600 select-none">📋 Ver formato Excel esperado</summary>
                    <div className="px-4 pb-4 pt-2 space-y-3">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="text-left px-2 py-1 border border-gray-200">Columna</th>
                            <th className="text-left px-2 py-1 border border-gray-200">Tipo</th>
                            <th className="text-left px-2 py-1 border border-gray-200">Requerido</th>
                            <th className="text-left px-2 py-1 border border-gray-200">Ejemplo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { col: 'ID',                 tipo: 'número',           req: true,  ej: '1000' },
                            { col: 'Nombre',             tipo: 'texto',            req: true,  ej: 'Cementerio Central' },
                            { col: 'Descripcion',        tipo: 'texto',            req: false, ej: 'Gonzalo Ramírez 1290' },
                            { col: 'Latitud',            tipo: 'número',           req: true,  ej: '-34.9178' },
                            { col: 'Longitud',           tipo: 'número',           req: true,  ej: '-56.1745' },
                            { col: 'tipo',               tipo: 'publico/privado',  req: false, ej: 'publico' },
                            { col: 'Visible',            tipo: 'true/false',       req: false, ej: 'true' },
                            { col: 'Categoria',          tipo: 'texto',            req: false, ej: 'Cementerio' },
                            { col: 'Telefono',           tipo: 'número',           req: false, ej: '24001234' },
                            { col: 'escenario_id',       tipo: 'número',           req: false, ej: '1000' },
                            { col: 'empresa_fletera_id', tipo: 'número',           req: false, ej: '70' },
                          ].map(({ col, tipo, req, ej }) => (
                            <tr key={col} className="even:bg-white odd:bg-gray-50">
                              <td className="px-2 py-1 border border-gray-200 font-mono">{col}</td>
                              <td className="px-2 py-1 border border-gray-200 text-gray-500">{tipo}</td>
                              <td className="px-2 py-1 border border-gray-200">{req ? <span className="text-red-500 font-bold">✓</span> : <span className="text-gray-400">–</span>}</td>
                              <td className="px-2 py-1 border border-gray-200 text-gray-500">{ej}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all"
                          onClick={() => {
                            const hdrs = ['ID','Nombre','Descripcion','Latitud','Longitud','tipo','Visible','Categoria','Telefono','escenario_id','empresa_fletera_id'];
                            const wb = XLSX.utils.book_new();
                            const ws = XLSX.utils.aoa_to_sheet([hdrs]);
                            XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
                            XLSX.writeFile(wb, 'plantilla-puntos-interes.xlsx');
                          }}
                        >
                          ⬇ Descargar plantilla
                        </button>
                      </div>
                    </div>
                  </details>

                  <div
                    className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all"
                    onClick={() => poiFileInputRef.current?.click()}
                  >
                    <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm text-gray-600 font-medium">
                      {importingPOI ? 'Procesando...' : 'Seleccionar archivo .xlsx'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Haz clic para elegir el archivo</p>
                    <input
                      ref={poiFileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={handleImportPOI}
                      disabled={importingPOI}
                    />
                  </div>

                  {importResultPOI && (
                    <div className={`text-sm px-4 py-3 rounded-lg border ${importResultPOI.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                      <div>{importResultPOI.msg}</div>
                      {importResultPOI.ok && importResultPOI.replaced && importResultPOI.replaced.length > 0 && (
                        <details className="mt-2 cursor-pointer">
                          <summary className="text-xs font-semibold text-amber-700 hover:underline">
                            Ver {importResultPOI.replaced.length} POI(s) reemplazado(s) (mismo nombre, id distinto)
                          </summary>
                          <ul className="mt-1 text-xs text-gray-600 list-disc list-inside max-h-32 overflow-y-auto">
                            {importResultPOI.replaced.map((r, i) => (
                              <li key={i}><span className="font-medium">{r.nombre}</span> ({r.usuario_email})  id anterior: {r.deletedId} → nuevo: {r.newId}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ===== Manual de usuario (solo root) ===== */}
              {/* ===== Reconstruir lista de móviles (solo root) ===== */}
              {user?.isRoot === 'S' && (
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

              {user?.isRoot === 'S' && (
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
