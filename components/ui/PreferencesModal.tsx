'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { isRoot } from '@/lib/auth-scope';
import { authStorage } from '@/lib/auth-storage';
import * as XLSX from 'xlsx';
import { NIGHT_START_HOUR, DAY_START_HOUR } from '@/lib/horario-servicio';
import { ZonaPattern, ZONA_PATTERN_OPTIONS } from '@/lib/zona-patterns';

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'star';

export const SHAPE_OPTIONS: { value: MarkerShape; label: string; svg: string }[] = [
  { value: 'circle', label: 'Círculo', svg: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'square', label: 'Cuadrado', svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'triangle', label: 'Triángulo', svg: '<polygon points="12,2 22,20 2,20" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'diamond', label: 'Rombo', svg: '<polygon points="12,2 22,12 12,22 2,12" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'hexagon', label: 'Hexágono', svg: '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'star', label: 'Estrella', svg: '<polygon points="12,2 14.9,8.6 22,9.3 16.8,14 18.2,21 12,17.3 5.8,21 7.2,14 2,9.3 9.1,8.6" fill="currentColor" stroke="white" stroke-width="1.5"/>' },
];

export type DataViewMode = 'normal' | 'distribucion' | 'demoras' | 'moviles-zonas' | 'zonas-activas' | 'pedidos-zona' | 'saturacion';

export interface UserPreferences {
  defaultMapLayer: 'streets' | 'satellite' | 'terrain' | 'cartodb' | 'dark' | 'light';
  showActiveMovilesOnly: boolean;
  maxCoordinateDelayMinutes: number;
  realtimeEnabled: boolean; // Modo Tiempo Real ON/OFF
  showRouteAnimation: boolean;
  showCompletedMarkers: boolean;
  markerStyle: 'normal' | 'compact' | 'mini'; // Estilo visual de marcadores de móviles
  pedidosCluster: boolean; // Agrupar pedidos/services en clusters
  pedidoMarkerStyle: 'normal' | 'compact' | 'mini'; // Estilo visual de marcadores de pedidos
  serviceMarkerStyle: 'normal' | 'compact' | 'mini'; // Estilo visual de marcadores de services
  movilShape: MarkerShape; // Forma del marcador de móviles (compact/mini)
  pedidoShape: MarkerShape; // Forma del marcador de pedidos (compact/mini)
  serviceShape: MarkerShape; // Forma del marcador de services (compact/mini)
  showDemoraLabels: boolean; // Mostrar etiquetas de demora (minutos) en mapa
  showCapEntregaLabels: boolean; // Mostrar etiquetas de Cap. Entrega en mapa
  showPedidosZonaLabels: boolean; // Mostrar etiquetas de Pedidos en Zona en mapa
  zonaOpacity: number; // Opacidad de las capas de zonas (0-100)
  nightStartHour: number; // Hora de inicio del horario nocturno (0-23.5, intervalos de 0.5 = 30 min)
  dayStartHour: number; // Hora de inicio del horario diurno (0-23.5, intervalos de 0.5 = 30 min)
  // Campos de visibilidad y Capas de Información (persisten en DB)
  movilesVisible: boolean; // true = mostrar capa de móviles
  pedidosVisible: boolean; // true = mostrar capa de pedidos
  servicesVisible: boolean; // true = mostrar capa de services
  poisVisible: boolean; // true = mostrar capa de puntos de interés
  hiddenPoiCategories: string[]; // categorías de POI ocultas (ej: ['Hospital/Sanatorio', 'Banco'])
  poiMarkerSize: number; // Tamaño de marcadores POI: 1=chico, 2=mediano, 3=grande
  poiDefaultIcon: string; // Emoji por defecto para POIs (cuando el POI no tiene icono propio)
  dataViewMode: DataViewMode; // Vista activa del mapa
  demorasPollingSeconds: number; // Intervalo de refresco para vista Demoras (segundos)
  movilesZonasPollingSeconds: number; // Intervalo de refresco para vista Móviles en Zonas (segundos)
  lightMode: boolean; // Modo ligero: deshabilita animaciones (recomendado para escritorio remoto)
  // ===== Realtime avanzado (sección admin — solo user.isRoot === 'S') =====
  realtimePollingReconcileSeconds: number; // Polling de reconciliación contra la DB (0 = off). Cubre eventos perdidos por desconexiones silenciosas.
  realtimeSilenceTimeoutSeconds: number;   // Si no llega ningún evento del WS por más de N segundos, forzar reconexión + refetch (0 = off).
  realtimeRefetchOnVisible: boolean;       // Al volver la pestaña a visible, hacer refetch completo de pedidos/services.
  realtimeHeartbeatSeconds: number;        // Heartbeat del cliente Supabase. ⚠ requiere recarga para aplicar.
  realtimeEventsPerSecond: number;         // Tope de eventos por segundo que el cliente acepta del WS. ⚠ requiere recarga para aplicar.
  // ===== Halo de markers y patrones de zonas =====
  movilHalo: boolean;    // Resaltar móviles con halo blanco
  pedidoHalo: boolean;   // Resaltar pedidos con halo blanco
  serviceHalo: boolean;  // Resaltar services con halo blanco
  zonaPattern: ZonaPattern; // Patrón visual de zonas (liso = sin patrón)
  // TODO [realtime-ui-stale-indicator]: próxima mejora pendiente.
  //   Cuando se implemente, agregar aquí:
  //     realtimeStaleIndicatorEnabled: boolean;
  //     realtimeStaleIndicatorThresholdSeconds: number; // cuánto tiempo sin eventos hasta marcar stale
  //   Visual: badge "🟡 Datos desactualizados hace Xs" + botón refresh.
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultMapLayer: 'streets',
  showActiveMovilesOnly: false,
  maxCoordinateDelayMinutes: 30,
  realtimeEnabled: true, // Por defecto activado
  showRouteAnimation: true,
  showCompletedMarkers: false, // Por defecto ocultos
  markerStyle: 'normal',
  pedidosCluster: true, // Por defecto agrupados
  pedidoMarkerStyle: 'normal',
  serviceMarkerStyle: 'normal',
  movilShape: 'circle',
  pedidoShape: 'square',
  serviceShape: 'triangle',
  showDemoraLabels: false, // Por defecto ocultas
  showCapEntregaLabels: false, // Por defecto ocultas
  showPedidosZonaLabels: false, // Por defecto ocultas
  zonaOpacity: 50, // 50% por defecto
  nightStartHour: NIGHT_START_HOUR, // 20:30 hs por defecto — de lib/horario-servicio.ts
  dayStartHour: DAY_START_HOUR, // 06:00 hs por defecto — de lib/horario-servicio.ts
  movilesVisible: true,
  pedidosVisible: true,
  servicesVisible: true,
  poisVisible: true,
  hiddenPoiCategories: [],
  poiMarkerSize: 2,
  poiDefaultIcon: '🏢',
  dataViewMode: 'normal',
  demorasPollingSeconds: 120,
  movilesZonasPollingSeconds: 90,
  lightMode: true, // Por defecto activado para todos. Para root se sobreescribe a false al aplicar defaults (ver mergeWithDefaults).
  // Realtime avanzado — defaults conservadores.
  realtimePollingReconcileSeconds: 60,
  realtimeSilenceTimeoutSeconds: 45,
  realtimeRefetchOnVisible: true,
  realtimeHeartbeatSeconds: 15,
  realtimeEventsPerSecond: 10,
  // Halo y patron -- default OFF / liso (no cambia UX existente)
  movilHalo: false,
  pedidoHalo: false,
  serviceHalo: false,
  zonaPattern: 'liso' as ZonaPattern,
};

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}

export default function PreferencesModal({ isOpen, onClose, onSave }: PreferencesModalProps) {
  const { user, hasPermiso } = useAuth();
  const canUpdPtsVenta = hasPermiso('updptsventa');
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

  // ===== Estado para importar Puntos de Interés =====
  const poiFileInputRef = useRef<HTMLInputElement>(null);
  const [importingPOI, setImportingPOI] = useState(false);
  const [importResultPOI, setImportResultPOI] = useState<{ ok: boolean; msg: string } | null>(null);

  // ===== Estado para importar/actualizar Puntos de Venta =====
  const ptvFileInputRef = useRef<HTMLInputElement>(null);
  const [importingPTV, setImportingPTV] = useState(false);
  const [importResultPTV, setImportResultPTV] = useState<{ ok: boolean; msg: string } | null>(null);

  // ===== Estado para Auditoría (solo root) =====
  const [auditEnabled, setAuditEnabled] = useState<boolean | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ updated_at: string; updated_by: string | null } | null>(null);
  const [auditToggling, setAuditToggling] = useState(false);

  const handleAuditToggle = async () => {
    if (auditToggling || auditEnabled === null) return;
    const newVal = !auditEnabled;
    setAuditToggling(true);
    try {
      // El JWT se guarda en localStorage['trackmovil_token'] (key separada
      // del user). El AuthContext mantiene 2 keys: 'trackmovil_user' (objeto
      // sin jwt) y 'trackmovil_token' (string con el JWT).
      // El JWT del Security Suite NO contiene isRoot — el flag de role se
      // pasa vía header `x-track-isroot` (mismo patrón que `x-track-user`).
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

  const handleImportPTV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ptvFileInputRef.current) ptvFileInputRef.current.value = '';

    setImportingPTV(true);
    setImportResultPTV(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('usuario', user?.username || 'admin');

      const res = await fetch('/api/import/puntos-venta', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();

      if (res.ok && json.success) {
        setImportResultPTV({ ok: true, msg: `✅ ${json.count ?? 'N'} punto(s) de venta actualizados correctamente.` });
      } else {
        setImportResultPTV({ ok: false, msg: `❌ Error: ${json.error || 'Respuesta inesperada del servidor'}` });
      }
    } catch (err: any) {
      setImportResultPTV({ ok: false, msg: `❌ Error al procesar el archivo: ${err.message}` });
    } finally {
      setImportingPTV(false);
    }
  }, [user]);

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

      // Columnas esperadas: Categoria* | ID* | Visibilidad | Nombre Corto | Nombre Largo | CoordX | CoordY | Telefono | Direccion | Observaciones
      const headers: string[] = (raw[0] as string[]).map(h => String(h ?? '').trim());
      const idx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

      const iCategoria = idx('Categoria');
      const iId        = idx('ID');
      const iVisib     = idx('Visibilidad');
      const iNombre    = idx('Nombre Corto');
      const iCoordX    = idx('CoordX');
      const iCoordY    = idx('CoordY');
      const iTelefono  = idx('Telefono');
      const iDireccion = idx('Direccion');

      const email = user?.email || user?.username || 'admin@trackmovil';

      const rows = raw.slice(1).filter(r => r[iId] != null).map(r => {
        const visib = String(r[iVisib] ?? '').toLowerCase();
        return {
          id:            Number(r[iId]),
          nombre:        String(r[iNombre] ?? '').trim(),
          categoria:     iCategoria >= 0 ? String(r[iCategoria] ?? '').trim() || null : null,
          latitud:       Number(r[iCoordX]),
          longitud:      Number(r[iCoordY]),
          telefono:      r[iTelefono] ? Number(r[iTelefono]) : null,
          descripcion:   iDireccion >= 0 ? String(r[iDireccion] ?? '').trim() || null : null,
          visible:       visib === 'publico' || visib === 'true' || visib === '1',
          tipo:          visib === 'publico' ? 'publico' : 'privado',
          icono:         '📍',
          usuario_email: email,
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
        setImportResultPOI({ ok: true, msg: `✅ ${json.count} punto(s) de venta actualizados correctamente.` });
      } else {
        setImportResultPOI({ ok: false, msg: `❌ Error: ${json.error || 'Error desconocido'}` });
      }
    } catch (err: any) {
      setImportResultPOI({ ok: false, msg: `❌ Error al leer el archivo: ${err.message}` });
    } finally {
      setImportingPOI(false);
    }
  }, [user]);

  // Cargar estado inicial del toggle de auditoría (solo para root)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    if (!isOpen) return;
    if (auditEnabled !== null) return;
    fetch('/api/audit/config')
      .then((r) => r.json())
      .then((j: { enabled: boolean; updated_at: string; updated_by: string | null }) => {
        setAuditEnabled(j.enabled);
        setAuditMeta({ updated_at: j.updated_at, updated_by: j.updated_by });
      })
      .catch(() => { /* silencioso */ });
  }, [user?.isRoot, isOpen, auditEnabled]);

  // Cargar preferencias desde localStorage al montar (cache local de lo que ya se cargó de DB).
  // Override de rol: para root lightMode=false, resto true (a menos que el usuario lo haya guardado).
  useEffect(() => {
    const isRootLocal = isRoot(user);
    const saved = localStorage.getItem('userPreferences');
    if (saved) {
      try {
        setPreferences({ ...DEFAULT_PREFERENCES, lightMode: !isRootLocal, ...JSON.parse(saved) });
      } catch (e) {
        console.error('Error al cargar preferencias:', e);
        setPreferences({ ...DEFAULT_PREFERENCES, lightMode: !isRootLocal });
      }
    } else {
      setPreferences({ ...DEFAULT_PREFERENCES, lightMode: !isRootLocal });
    }
  }, [user?.isRoot, user?.roles]);

  const handleSave = () => {
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    onSave(preferences);
    onClose();
  };

  const handleReset = () => {
    setPreferences(DEFAULT_PREFERENCES);
    localStorage.removeItem('userPreferences');
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
            <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 rounded-t-2xl border-b border-blue-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-lg p-2">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Preferencias</h2>
                    <p className="text-xs text-blue-100">Configura la aplicación según tus necesidades</p>
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

              {/* Botón "Notificaciones de novedades" se movió al FloatingToolbar
                  (junto a Bloqueos de Login, Logs/Auditoría, Configuración, Incidentes). */}

              {/* ═══════════════════════════════════════════════════════════
                  SECCIÓN 1: Tamaño y Forma de Marcadores
                  ═══════════════════════════════════════════════════════════ */}
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
                  <span>📍</span> Marcadores
                </h3>
                <p className="text-xs text-gray-500">Configura tamaño y forma de los marcadores en el mapa</p>
              </div>

              {/* Tamaño de Marcadores de Móviles */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🚗</span>
                  Tamaño de Marcadores de Móviles
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'normal' as const, label: 'Normal', desc: 'Ícono completo', preview: 'w-10 h-10' },
                    { value: 'compact' as const, label: 'Compacto', desc: 'Punto + número', preview: 'w-6 h-6' },
                    { value: 'mini' as const, label: 'Mini', desc: 'Solo punto', preview: 'w-4 h-4' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPreferences({ ...preferences, markerStyle: opt.value })}
                      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        preferences.markerStyle === opt.value
                          ? 'border-blue-500 bg-blue-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-center h-12">
                        <div className={`${opt.preview} rounded-full bg-green-500 border-2 border-white shadow-md`} />
                      </div>
                      <div className="text-center">
                        <div className={`text-xs font-bold ${preferences.markerStyle === opt.value ? 'text-blue-700' : 'text-gray-700'}`}>
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-gray-500">{opt.desc}</div>
                      </div>
                      {preferences.markerStyle === opt.value && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {preferences.markerStyle === 'normal' ? 'Vista detallada con ícono de vehículo y número' :
                   preferences.markerStyle === 'compact' ? 'Punto con número, ideal para ver muchos móviles' :
                   'Punto mínimo, máxima visibilidad del mapa'}
                </p>
                {/* Selector de forma - solo visible en compact/mini */}
                {preferences.markerStyle !== 'normal' && (
                  <div className="mt-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                    <div className="text-xs font-semibold text-gray-600 mb-2">Forma del marcador:</div>
                    <div className="flex gap-2 flex-wrap">
                      {SHAPE_OPTIONS.map(shape => (
                        <button key={shape.value} type="button"
                          onClick={() => setPreferences({ ...preferences, movilShape: shape.value })}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                            preferences.movilShape === shape.value ? 'border-blue-500 bg-blue-100' : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                          title={shape.label}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" className="text-green-500">
                            <g dangerouslySetInnerHTML={{ __html: shape.svg }} />
                          </svg>
                          <span className="text-[9px] text-gray-500">{shape.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle: Halo de moviles */}
              <label className="flex items-center justify-between p-3 hover:bg-green-50 rounded-xl cursor-pointer transition-colors border border-green-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-lg">🚗</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Resaltar moviles con halo</div>
                    <p className="text-xs text-gray-500">Anillo blanco + borde oscuro alrededor del marker</p>
                  </div>
                </div>
                <div
                  onClick={() => setPreferences({ ...preferences, movilHalo: !preferences.movilHalo })}
                  className={` relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${preferences.movilHalo ? 'bg-green-500' : 'bg-gray-200'}`}
                >
                  <span className={` inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.movilHalo ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </label>

              <hr className="border-gray-200" />

              {/* Tamaño de Marcadores de Pedidos */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">📦</span>
                  Tamaño de Marcadores de Pedidos
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'normal' as const, label: 'Normal', desc: 'Ícono con emoji', preview: 'w-6 h-6', emoji: '📦' },
                    { value: 'compact' as const, label: 'Compacto', desc: 'Cuadrado pequeño', preview: 'w-4 h-4', emoji: '■' },
                    { value: 'mini' as const, label: 'Mini', desc: 'Punto mínimo', preview: 'w-3 h-3', emoji: '•' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPreferences({ ...preferences, pedidoMarkerStyle: opt.value })}
                      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        preferences.pedidoMarkerStyle === opt.value
                          ? 'border-orange-500 bg-orange-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-center h-12">
                        <div className={`${opt.preview} rounded bg-gradient-to-br from-orange-400 to-orange-600 border-2 border-white shadow-md flex items-center justify-center`}>
                          <span className="text-white text-[8px]">{opt.emoji}</span>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className={`text-xs font-bold ${preferences.pedidoMarkerStyle === opt.value ? 'text-orange-700' : 'text-gray-700'}`}>
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-gray-500">{opt.desc}</div>
                      </div>
                      {preferences.pedidoMarkerStyle === opt.value && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {preferences.pedidoMarkerStyle === 'normal' ? 'Marcador con emoji 📦 y colores de demora' :
                   preferences.pedidoMarkerStyle === 'compact' ? 'Forma pequeña con color de demora, sin emoji' :
                   'Punto mínimo con color de demora'}
                </p>
                {/* Selector de forma para pedidos - solo en compact/mini */}
                {preferences.pedidoMarkerStyle !== 'normal' && (
                  <div className="mt-3 p-3 bg-orange-50/50 rounded-lg border border-orange-100">
                    <div className="text-xs font-semibold text-gray-600 mb-2">📦 Forma de Pedidos:</div>
                    <div className="flex gap-2 flex-wrap">
                      {SHAPE_OPTIONS.map(shape => (
                        <button key={shape.value} type="button"
                          onClick={() => setPreferences({ ...preferences, pedidoShape: shape.value })}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                            preferences.pedidoShape === shape.value ? 'border-orange-500 bg-orange-100' : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                          title={shape.label}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" className="text-orange-500">
                            <g dangerouslySetInnerHTML={{ __html: shape.svg }} />
                          </svg>
                          <span className="text-[9px] text-gray-500">{shape.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle: Halo de pedidos */}
              <label className="flex items-center justify-between p-3 hover:bg-orange-50 rounded-xl cursor-pointer transition-colors border border-orange-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 text-lg">📦</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Resaltar pedidos con halo</div>
                    <p className="text-xs text-gray-500">Anillo blanco + borde oscuro alrededor del marker</p>
                  </div>
                </div>
                <div
                  onClick={() => setPreferences({ ...preferences, pedidoHalo: !preferences.pedidoHalo })}
                  className={` relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${preferences.pedidoHalo ? 'bg-orange-500' : 'bg-gray-200'}`}
                >
                  <span className={` inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.pedidoHalo ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </label>

              <hr className="border-gray-200" />

              {/* Tamaño de Marcadores de Services */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🔧</span>
                  Tamaño de Marcadores de Services
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'normal' as const, label: 'Normal', desc: 'Ícono con emoji', preview: 'w-6 h-6', emoji: '🔧' },
                    { value: 'compact' as const, label: 'Compacto', desc: 'Forma pequeña', preview: 'w-4 h-4', emoji: '■' },
                    { value: 'mini' as const, label: 'Mini', desc: 'Punto mínimo', preview: 'w-3 h-3', emoji: '•' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPreferences({ ...preferences, serviceMarkerStyle: opt.value })}
                      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        preferences.serviceMarkerStyle === opt.value
                          ? 'border-red-500 bg-red-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-center h-12">
                        <div className={`${opt.preview} rounded bg-gradient-to-br from-red-400 to-red-600 border-2 border-white shadow-md flex items-center justify-center`}>
                          <span className="text-white text-[8px]">{opt.emoji}</span>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className={`text-xs font-bold ${preferences.serviceMarkerStyle === opt.value ? 'text-red-700' : 'text-gray-700'}`}>
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-gray-500">{opt.desc}</div>
                      </div>
                      {preferences.serviceMarkerStyle === opt.value && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {preferences.serviceMarkerStyle === 'normal' ? 'Marcador con emoji 🔧 y colores de demora' :
                   preferences.serviceMarkerStyle === 'compact' ? 'Forma pequeña con color de demora, sin emoji' :
                   'Punto mínimo con color de demora'}
                </p>
                {/* Selector de forma para services - solo en compact/mini */}
                {preferences.serviceMarkerStyle !== 'normal' && (
                  <div className="mt-3 p-3 bg-red-50/50 rounded-lg border border-red-100">
                    <div className="text-xs font-semibold text-gray-600 mb-2">🔧 Forma de Services:</div>
                    <div className="flex gap-2 flex-wrap">
                      {SHAPE_OPTIONS.map(shape => (
                        <button key={shape.value} type="button"
                          onClick={() => setPreferences({ ...preferences, serviceShape: shape.value })}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                            preferences.serviceShape === shape.value ? 'border-red-500 bg-red-100' : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                          title={shape.label}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" className="text-red-500">
                            <g dangerouslySetInnerHTML={{ __html: shape.svg }} />
                          </svg>
                          <span className="text-[9px] text-gray-500">{shape.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle: Halo de services */}
              <label className="flex items-center justify-between p-3 hover:bg-red-50 rounded-xl cursor-pointer transition-colors border border-red-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600 text-lg">🔧</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Resaltar services con halo</div>
                    <p className="text-xs text-gray-500">Anillo blanco + borde oscuro alrededor del marker</p>
                  </div>
                </div>
                <div
                  onClick={() => setPreferences({ ...preferences, serviceHalo: !preferences.serviceHalo })}
                  className={` relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${preferences.serviceHalo ? 'bg-red-500' : 'bg-gray-200'}`}
                >
                  <span className={` inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.serviceHalo ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </label>

              <hr className="border-gray-200" />

              {/* Marcadores Puntos de Interés */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🏢</span>
                  Marcadores Puntos de Interés
                </label>

                {/* Selector de tamaño */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-28 shrink-0">Tamaño en mapa</span>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map((size) => {
                      const labels = { 1: 'Chico', 2: 'Mediano', 3: 'Grande' };
                      const px = { 1: 12, 2: 18, 3: 26 };
                      const active = preferences.poiMarkerSize === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setPreferences({ ...preferences, poiMarkerSize: size })}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600 shadow'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          <img src="/images/iconoptoventa.png" style={{ width: px[size], height: px[size], objectFit: 'contain' }} />
                          {labels[size]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ═══════════════════════════════════════════════════════════
                  SECCIÓN 2: Comportamiento
                  ═══════════════════════════════════════════════════════════ */}
              <div className="border-t-2 border-gray-300 pt-6 space-y-1">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
                  <span>⚙️</span> Comportamiento
                </h3>
                <p className="text-xs text-gray-500">Opciones de visualización y comportamiento del mapa</p>
              </div>

              {/* Toggle: Agrupar Pedidos en Clusters */}
              <label className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-xl cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 text-lg">📦</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Agrupar pedidos en clusters</div>
                    <p className="text-xs text-gray-500">Agrupa pedidos y services cercanos en el mapa</p>
                  </div>
                </div>
                <div
                  onClick={() => setPreferences({ ...preferences, pedidosCluster: !preferences.pedidosCluster })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${preferences.pedidosCluster ? 'bg-orange-500' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.pedidosCluster ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </label>

              {/* Toggle "Etiquetas de Demoras" — UI oculta para todos los perfiles.
                  El valor (showDemoraLabels) sigue su default y se aplica internamente. */}

              {/* Horario Nocturno / Diurno — UI oculta para todos los perfiles.
                  Los valores se mantienen por defecto (20:30 / 06:00) y se usan internamente. */}

              {/* ═══════════════════════════════════════════════════════════
                  SECCIÓN 3: Configuración Avanzada (Sliders)
                  ═══════════════════════════════════════════════════════════ */}
              <div className="border-t-2 border-gray-300 pt-6 space-y-1">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 uppercase tracking-wide">
                  <span>🔧</span> Configuración Avanzada
                </h3>
                <p className="text-xs text-gray-500">Intervalos, umbrales y opacidad</p>
              </div>

              {/* Retraso Máximo de Coordenadas */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">⏱️</span>
                  Retraso Máximo de Coordenadas
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="5"
                    max="120"
                    step="5"
                    value={preferences.maxCoordinateDelayMinutes}
                    onChange={(e) => setPreferences({ ...preferences, maxCoordinateDelayMinutes: parseInt(e.target.value) })}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="min-w-[80px] px-3 py-2 bg-blue-50 text-blue-700 font-bold rounded-lg text-center">
                    {preferences.maxCoordinateDelayMinutes} min
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Mostrar solo coordenadas de los últimos {preferences.maxCoordinateDelayMinutes} minutos
                </p>
              </div>

              <hr className="border-gray-200" />

              {/* Intervalos de Refresco de Capas */}
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🔄</span>
                  Intervalos de Refresco Automático
                </label>
                <p className="text-xs text-gray-500">
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
                      value={preferences.demorasPollingSeconds}
                      onChange={(e) => setPreferences({ ...preferences, demorasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-red-100 text-red-700 font-bold rounded-lg text-center text-xs">
                      {preferences.demorasPollingSeconds}s
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
                      value={preferences.movilesZonasPollingSeconds}
                      onChange={(e) => setPreferences({ ...preferences, movilesZonasPollingSeconds: parseInt(e.target.value) })}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="min-w-[60px] px-2 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-center text-xs">
                      {preferences.movilesZonasPollingSeconds}s
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* Modo Ligero */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">⚡</span>
                  Modo Ligero
                </label>
                <p className="text-xs text-gray-500">
                  Desactiva todas las animaciones. Recomendado al usar la app en escritorio remoto (Syncline u otros).
                </p>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm text-gray-700">Deshabilitar animaciones</span>
                  <button
                    type="button"
                    onClick={() => setPreferences({ ...preferences, lightMode: !preferences.lightMode })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${preferences.lightMode ? 'bg-amber-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.lightMode ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* Opacidad de Capas de Zonas */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🎨</span>
                  Opacidad de Capas de Zonas
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={preferences.zonaOpacity}
                    onChange={(e) => setPreferences({ ...preferences, zonaOpacity: parseInt(e.target.value) })}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                  <span className="min-w-[60px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                    {preferences.zonaOpacity}%
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Controla la intensidad de los colores de las zonas en las vistas de datos (Distribución, Demoras, Móviles por Zona)
                </p>
              </div>

              <hr className="border-gray-200" />

              {/* Patron de Zonas */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">&#9726;</span>
                  Patrón de Zonas
                </label>
                <p className="text-xs text-gray-500">
                  Textura superpuesta sobre el color de las zonas. &quot;Liso&quot; mantiene el comportamiento actual.
                </p>
                <div className="flex flex-wrap gap-2">
                  {ZONA_PATTERN_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPreferences({ ...preferences, zonaPattern: opt.value })}
                      className={`px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all ${
                        (preferences.zonaPattern ?? 'liso') === opt.value
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {isRoot(user) && (
                <>
                  <hr className="border-gray-200" />

                  {/* ===== Realtime avanzado — solo admin (isRoot='S') ===== */}
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
                          value={preferences.realtimePollingReconcileSeconds}
                          onChange={(e) => setPreferences({ ...preferences, realtimePollingReconcileSeconds: parseInt(e.target.value) })}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                          {preferences.realtimePollingReconcileSeconds === 0 ? 'off' : `${preferences.realtimePollingReconcileSeconds}s`}
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
                          value={preferences.realtimeSilenceTimeoutSeconds}
                          onChange={(e) => setPreferences({ ...preferences, realtimeSilenceTimeoutSeconds: parseInt(e.target.value) })}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                          {preferences.realtimeSilenceTimeoutSeconds === 0 ? 'off' : `${preferences.realtimeSilenceTimeoutSeconds}s`}
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
                        onClick={() => setPreferences({ ...preferences, realtimeRefetchOnVisible: !preferences.realtimeRefetchOnVisible })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${preferences.realtimeRefetchOnVisible ? 'bg-purple-500' : 'bg-gray-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.realtimeRefetchOnVisible ? 'translate-x-6' : 'translate-x-1'}`} />
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
                          value={preferences.realtimeHeartbeatSeconds}
                          onChange={(e) => setPreferences({ ...preferences, realtimeHeartbeatSeconds: parseInt(e.target.value) })}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                          {preferences.realtimeHeartbeatSeconds}s
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
                          value={preferences.realtimeEventsPerSecond}
                          onChange={(e) => setPreferences({ ...preferences, realtimeEventsPerSecond: parseInt(e.target.value) })}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <span className="min-w-[70px] px-2 py-1 bg-purple-50 text-purple-700 font-bold rounded-lg text-center text-xs">
                          {preferences.realtimeEventsPerSecond}/s
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ===== Auditoría — solo root (isRoot=S) ===== */}
              {isRoot(user) && (
                <>
                  <hr className="border-gray-200" />
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
                </>
              )}

              <hr className="border-gray-200" />

              {/* ===== Actualizar Puntos de Venta — requiere permiso updptsventa ===== */}
              {canUpdPtsVenta && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏪</span>
                    <span className="text-sm font-bold text-gray-800">Actualizar Puntos de Venta</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-green-100 text-green-700">ADMIN</span>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2">
                    Importa o actualiza los puntos de venta desde un archivo Excel&nbsp;(.xlsx). Los registros existentes serán sobreescritos por ID.
                  </p>

                  <div
                    className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-all"
                    onClick={() => ptvFileInputRef.current?.click()}
                  >
                    <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm text-gray-600 font-medium">
                      {importingPTV ? 'Procesando...' : 'Seleccionar archivo .xlsx'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Haz clic para elegir el archivo</p>
                    <input
                      ref={ptvFileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={handleImportPTV}
                      disabled={importingPTV}
                    />
                  </div>

                  {importResultPTV && (
                    <div className={`text-sm px-4 py-3 rounded-lg border ${
                      importResultPTV.ok
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      {importResultPTV.msg}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 z-10 bg-gray-50 px-6 py-4 rounded-b-2xl border-t border-gray-200 flex items-center justify-between gap-4">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              >
                🔄 Restablecer
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-lg hover:shadow-xl transition-all"
                >
                  💾 Guardar Preferencias
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook para usar preferencias en cualquier componente — persiste en DB con debounce
export function useUserPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPrefsRef = useRef<UserPreferences>(DEFAULT_PREFERENCES);

  // Función auxiliar para mergear con defaults (en caso de campos nuevos).
  // Aplica override de rol: usuarios root tienen lightMode=false por defecto;
  // resto de perfiles lightMode=true. Si el usuario guardó explícitamente un
  // valor, ese valor (en `saved`) gana sobre el default.
  const mergeWithDefaults = useCallback((saved: Partial<UserPreferences>): UserPreferences => {
    const isRootLocal = isRoot(user);
    return { ...DEFAULT_PREFERENCES, lightMode: !isRootLocal, ...saved };
  }, [user?.isRoot, user?.roles]);

  // Cargar preferencias: primero intenta DB, fallback a localStorage
  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      // Si tenemos user.id, intentar cargar de DB
      if (user?.id) {
        try {
          const res = await fetch(`/api/user-preferences?user_id=${encodeURIComponent(user.id)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data && !cancelled) {
              const merged = mergeWithDefaults(json.data);
              setPreferences(merged);
              latestPrefsRef.current = merged;
              // Sincronizar a localStorage como cache
              localStorage.setItem('userPreferences', JSON.stringify(merged));
              setLoaded(true);
              return;
            }
          }
        } catch (e) {
          console.warn('⚠️ No se pudo cargar preferencias de DB, usando localStorage:', e);
        }
      }

      // Fallback: localStorage. Si no hay nada guardado, igual aplicamos
      // mergeWithDefaults({}) para que el override por rol (lightMode) tome efecto.
      if (!cancelled) {
        const saved = localStorage.getItem('userPreferences');
        let merged: UserPreferences;
        if (saved) {
          try {
            merged = mergeWithDefaults(JSON.parse(saved));
          } catch (e) {
            console.error('Error al cargar preferencias de localStorage:', e);
            merged = mergeWithDefaults({});
          }
        } else {
          merged = mergeWithDefaults({});
        }
        setPreferences(merged);
        latestPrefsRef.current = merged;
        setLoaded(true);
      }
    }

    loadPreferences();
    return () => { cancelled = true; };
  }, [user?.id, mergeWithDefaults]);

  // Guardar en DB con debounce (500ms)
  const saveToDb = useCallback((prefs: UserPreferences) => {
    if (!user?.id) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch('/api/user-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.id, preferences: prefs }),
        });
      } catch (e) {
        console.warn('⚠️ No se pudo guardar preferencias en DB:', e);
      }
    }, 500);
  }, [user?.id]);

  // Actualizar preferencias: state + localStorage + DB
  const updatePreferences = useCallback((newPreferences: UserPreferences) => {
    setPreferences(newPreferences);
    latestPrefsRef.current = newPreferences;
    localStorage.setItem('userPreferences', JSON.stringify(newPreferences));
    saveToDb(newPreferences);
  }, [saveToDb]);

  // Actualizar un solo campo sin reemplazar todo el objeto
  const updatePreference = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    const updated = { ...latestPrefsRef.current, [key]: value };
    updatePreferences(updated);
  }, [updatePreferences]);

  // Limpiar timer al desmontar
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { preferences, updatePreferences, updatePreference, loaded };
}
