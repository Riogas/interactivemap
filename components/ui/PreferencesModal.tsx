'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'star';

export const SHAPE_OPTIONS: { value: MarkerShape; label: string; svg: string }[] = [
  { value: 'circle', label: 'Círculo', svg: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'square', label: 'Cuadrado', svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'triangle', label: 'Triángulo', svg: '<polygon points="12,2 22,20 2,20" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'diamond', label: 'Rombo', svg: '<polygon points="12,2 22,12 12,22 2,12" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'hexagon', label: 'Hexágono', svg: '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="currentColor" stroke="white" stroke-width="2"/>' },
  { value: 'star', label: 'Estrella', svg: '<polygon points="12,2 14.9,8.6 22,9.3 16.8,14 18.2,21 12,17.3 5.8,21 7.2,14 2,9.3 9.1,8.6" fill="currentColor" stroke="white" stroke-width="1.5"/>' },
];

export type DataViewMode = 'normal' | 'distribucion' | 'demoras' | 'moviles-zonas' | 'pedidos-zona';

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
  zonaOpacity: number; // Opacidad de las capas de zonas (0-100)
  nightStartHour: number; // Hora de inicio del horario nocturno (0-23)
  dayStartHour: number; // Hora de inicio del horario diurno (0-23)
  // Campos de visibilidad y vista de datos (persisten en DB)
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
  zonaOpacity: 50, // 50% por defecto
  nightStartHour: 20, // 20:00 hs por defecto
  dayStartHour: 6, // 06:00 hs por defecto
  movilesVisible: true,
  pedidosVisible: true,
  servicesVisible: true,
  poisVisible: true,
  hiddenPoiCategories: [],
  poiMarkerSize: 2,
  poiDefaultIcon: '🏢',
  dataViewMode: 'normal',
  demorasPollingSeconds: 30,
  movilesZonasPollingSeconds: 30,
};

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}

export default function PreferencesModal({ isOpen, onClose, onSave }: PreferencesModalProps) {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

  // ===== Estado para importar Puntos de Interés =====
  const poiFileInputRef = useRef<HTMLInputElement>(null);
  const [importingPOI, setImportingPOI] = useState(false);
  const [importResultPOI, setImportResultPOI] = useState<{ ok: boolean; msg: string } | null>(null);

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

  // Cargar preferencias desde localStorage al montar (cache local de lo que ya se cargó de DB)
  useEffect(() => {
    const saved = localStorage.getItem('userPreferences');
    if (saved) {
      try {
        setPreferences({ ...DEFAULT_PREFERENCES, ...JSON.parse(saved) });
      } catch (e) {
        console.error('Error al cargar preferencias:', e);
      }
    }
  }, []);

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
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📦</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                      Agrupar Pedidos en Clusters
                    </div>
                    <p className="text-xs text-gray-500">
                      {preferences.pedidosCluster 
                        ? 'Los pedidos cercanos se agrupan al alejar el zoom' 
                        : 'Todos los pedidos se muestran individualmente'}
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.pedidosCluster}
                    onChange={(e) => setPreferences({ ...preferences, pedidosCluster: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                </div>
              </label>

              <hr className="border-gray-100" />

              {/* Toggle: Solo Móviles Activos */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🚗</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                      Mostrar Solo Móviles Activos
                    </div>
                    <p className="text-xs text-gray-500">Oculta móviles sin actualizaciones recientes</p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.showActiveMovilesOnly}
                    onChange={(e) => setPreferences({ ...preferences, showActiveMovilesOnly: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
              </label>

              <hr className="border-gray-100" />

              {/* Toggle: Modo Tiempo Real */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-green-400 to-emerald-600 rounded-lg shadow-md">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                      Modo Tiempo Real
                    </div>
                    <p className="text-xs text-gray-500">
                      {preferences.realtimeEnabled 
                        ? 'Actualizaciones automáticas activadas' 
                        : 'Modo estático (sin actualizaciones automáticas)'}
                    </p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.realtimeEnabled}
                    onChange={(e) => setPreferences({ ...preferences, realtimeEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                </div>
              </label>

              <hr className="border-gray-100" />

              {/* Toggle: Animación de Rutas */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎬</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                      Habilitar Animación de Rutas
                    </div>
                    <p className="text-xs text-gray-500">Mostrar control de animación en el mapa</p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.showRouteAnimation}
                    onChange={(e) => setPreferences({ ...preferences, showRouteAnimation: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
              </label>

              <hr className="border-gray-100" />

              {/* Toggle: Mostrar Pedidos/Servicios Completados */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className="text-lg">✅</span>
                  <div>
                    <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600 transition-colors">
                      Mostrar Pedidos/Servicios Completados
                    </div>
                    <p className="text-xs text-gray-500">Ver marcadores de entregas finalizadas</p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.showCompletedMarkers}
                    onChange={(e) => setPreferences({ ...preferences, showCompletedMarkers: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
              </label>

              <hr className="border-gray-100" />

              {/* Toggle: Etiquetas de Demoras */}
              <label className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-xl cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600 text-lg">⏱️</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Etiquetas de Demoras</div>
                    <p className="text-xs text-gray-500">Mostrar minutos de demora en cada zona</p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={preferences.showDemoraLabels}
                    onChange={(e) => setPreferences({ ...preferences, showDemoraLabels: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
              </label>

              {/* Horario Nocturno / Diurno */}
              <label className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-xl transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-lg">🌙</div>
                  <div>
                    <div className="text-sm font-medium text-gray-700">Horario Nocturno / Diurno</div>
                    <p className="text-xs text-gray-500">Define cuándo comienza la noche y el día</p>
                  </div>
                </div>
              </label>
              <div className="pl-14 pr-3 -mt-2 pb-2 space-y-3">
                {/* Inicio nocturno */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 min-w-[120px]">Inicio nocturno:</span>
                  <select
                    value={preferences.nightStartHour}
                    onChange={(e) => setPreferences({ ...preferences, nightStartHour: parseInt(e.target.value) })}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">🌙 Comienza la noche</span>
                </div>
                {/* Inicio diurno */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 min-w-[120px]">Inicio diurno:</span>
                  <select
                    value={preferences.dayStartHour}
                    onChange={(e) => setPreferences({ ...preferences, dayStartHour: parseInt(e.target.value) })}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">☀️ Comienza el día</span>
                </div>
              </div>

              <hr className="border-gray-100" />

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

              {/* Marcadores Puntos de Interés */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">🏢</span>
                  Marcadores Puntos de Interés
                </label>

                {/* Selector de ícono por defecto */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-28 shrink-0">Ícono por defecto</span>
                  <select
                    value={preferences.poiDefaultIcon}
                    onChange={(e) => setPreferences({ ...preferences, poiDefaultIcon: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {[
                      { emoji: '🏢', label: 'Edificio' },
                      { emoji: '🏪', label: 'Tienda' },
                      { emoji: '🏬', label: 'Comercio' },
                      { emoji: '🏭', label: 'Fábrica' },
                      { emoji: '🏠', label: 'Casa' },
                      { emoji: '🏦', label: 'Banco' },
                      { emoji: '⛽', label: 'Gas / Combustible' },
                      { emoji: '📍', label: 'Pin rojo' },
                      { emoji: '📌', label: 'Pin naranja' },
                      { emoji: '⭐', label: 'Estrella' },
                      { emoji: '🎯', label: 'Diana' },
                      { emoji: '🚩', label: 'Bandera' },
                      { emoji: '🔵', label: 'Círculo azul' },
                      { emoji: '🟢', label: 'Círculo verde' },
                      { emoji: '🔴', label: 'Círculo rojo' },
                      { emoji: '🟡', label: 'Círculo amarillo' },
                      { emoji: '🟣', label: 'Círculo violeta' },
                    ].map(({ emoji, label }) => (
                      <option key={emoji} value={emoji}>{emoji} {label}</option>
                    ))}
                  </select>
                  <span
                    className="text-2xl leading-none"
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
                  >
                    {preferences.poiDefaultIcon}
                  </span>
                </div>

                {/* Selector de tamaño */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-28 shrink-0">Tamaño en mapa</span>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map((size) => {
                      const labels = { 1: 'Chico', 2: 'Mediano', 3: 'Grande' };
                      const px = { 1: '12px', 2: '18px', 3: '26px' };
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
                          <span style={{ fontSize: px[size], lineHeight: 1 }}>{preferences.poiDefaultIcon}</span>
                          {labels[size]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* Importar Puntos de Venta */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <span className="text-lg">📍</span>
                  Actualizar Puntos de Venta
                </label>
                <p className="text-xs text-gray-500">
                  Importa o actualiza los puntos de venta desde un archivo Excel (.xlsx).
                  Las filas se identifican por la columna <strong>ID*</strong>: si el ID existe se actualiza, si no existe se inserta.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    ref={poiFileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleImportPOI}
                  />
                  <button
                    type="button"
                    disabled={importingPOI}
                    onClick={() => { setImportResultPOI(null); poiFileInputRef.current?.click(); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg shadow transition-all"
                  >
                    {importingPOI ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Seleccionar archivo Excel
                      </>
                    )}
                  </button>
                  {importResultPOI && (
                    <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                      importResultPOI.ok
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {importResultPOI.msg}
                    </span>
                  )}
                </div>
              </div>
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

  // Función auxiliar para mergear con defaults (en caso de campos nuevos)
  const mergeWithDefaults = useCallback((saved: Partial<UserPreferences>): UserPreferences => {
    return { ...DEFAULT_PREFERENCES, ...saved };
  }, []);

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

      // Fallback: localStorage
      if (!cancelled) {
        const saved = localStorage.getItem('userPreferences');
        if (saved) {
          try {
            const merged = mergeWithDefaults(JSON.parse(saved));
            setPreferences(merged);
            latestPrefsRef.current = merged;
          } catch (e) {
            console.error('Error al cargar preferencias de localStorage:', e);
          }
        }
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
