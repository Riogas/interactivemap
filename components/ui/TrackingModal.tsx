'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData } from '@/types';
import { todayMontevideo } from '@/lib/date-utils';

interface TrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (movilId: number, date: string) => void;
  moviles: MovilData[];
  /** IDs de móviles "ocultos pero operativos" — no se listan. */
  hiddenMovilIds?: Set<number>;
  selectedDate: string; // Fecha actual del dashboard (default)
  selectedMovil?: number; // Si ya hay un móvil seleccionado
  /** IDs de empresas fleteras seleccionadas — se pasan al endpoint para filtrar actividad. */
  selectedEmpresas?: number[];
  /**
   * Fecha mínima permitida en el selector (YYYY-MM-DD).
   * Calculada por el dashboard a partir de HistoricoMaxCoords del rol activo.
   * Si es undefined no se aplica restricción (comportamiento original).
   */
  minDate?: string;
  /** ID del escenario activo — requerido para la rama moviles_dia (flag NEXT_PUBLIC_USE_MOVILES_DIA). */
  escenarioId?: number;
  /** 'S' si el usuario es root — se usa para el header x-track-isroot en la rama moviles_dia. */
  isRoot?: string;
  /**
   * Cuando true, el modal usa la prop `moviles` como fuente de verdad directa
   * (sin fetch interno de actividad). Aplica cuando NEXT_PUBLIC_USE_MOVILES_DIA=true
   * y la fecha seleccionada es hoy: el dashboard ya filtra moviles_dia (activos +
   * inactivos del día) antes de pasarlos, por lo que re-fetchear es redundante y
   * puede excluir móviles con pedidos/services pero sin GPS.
   *
   * Para fechas históricas (date != hoy), este flag debe ser false para que el
   * modal siga usando /api/moviles-dia con la fecha correcta.
   */
  movilesDiaMode?: boolean;
}

export default function TrackingModal({
  isOpen,
  onClose,
  onConfirm,
  moviles,
  hiddenMovilIds,
  selectedDate,
  selectedMovil: preSelectedMovil,
  selectedEmpresas,
  minDate,
  escenarioId,
  isRoot,
  movilesDiaMode = false,
}: TrackingModalProps) {
  const [movilId, setMovilId] = useState<number | ''>(preSelectedMovil || '');
  const [date, setDate] = useState(selectedDate);
  const [search, setSearch] = useState('');

  // R2: Conjunto de nros de móvil con actividad en la fecha seleccionada.
  // null = cargando o fetch fallido (fallback: mostrar todos).
  const [activityMovilIds, setActivityMovilIds] = useState<Set<number> | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);

  // Ref para cancelar fetches anteriores si la fecha cambia
  const abortControllerRef = useRef<AbortController | null>(null);

  // R4: ¿La fecha seleccionada es hoy?
  const isToday = date === todayMontevideo();

  // C: Sincronizar la fecha del dashboard → estado local cuando la prop cambia.
  // Cubre el caso en que el usuario cambia la fecha en el dashboard mientras el modal está cerrado
  // (y también si el modal está abierto y la prop se actualiza externamente).
  useEffect(() => {
    setDate(selectedDate);
  }, [selectedDate]);

  // Reset cuando se abre el modal
  const handleOpen = () => {
    setMovilId(preSelectedMovil || '');
    setDate(selectedDate);
    setSearch('');
    // activityMovilIds se resetea por el useEffect cuando date cambia
  };

  // R2: Fetch de móviles con actividad cada vez que cambia la fecha (o cuando abre el modal)
  useEffect(() => {
    if (!isOpen) return;

    // movilesDiaMode + hoy: el prop `moviles` ya contiene el universo correcto
    // (activos + inactivos del día) porque el dashboard lo construye desde moviles_dia.
    // Criterio de inclusión (en orden de prioridad):
    //   1. activo===true        → móvil activo ahora mismo (badge verde)
    //   2. inactivoDelDia===true → ya terminó pero recompute lo marcó como inactivo del día (badge gris)
    //   3. currentPosition != null → tenía GPS hoy pero aún no fue marcado por recompute
    //      (delta entre realtime que lo marcó inactivo y el cron que actualiza inactivo_del_dia).
    //      Estos son los ~13 móviles que el colapsable contaba en su badge pero el modal no mostraba.
    // Para fechas históricas (isToday=false), este branch NO se activa — el modal
    // sigue usando /api/moviles-dia con la fecha correcta para reconstruir la lista.
    if (movilesDiaMode && isToday) {
      const ids = new Set<number>(
        moviles
          .filter((m) => m.activo === true || m.inactivoDelDia === true || m.currentPosition != null)
          .map((m) => m.id)
      );
      setActivityMovilIds(ids);
      setActivityLoading(false);
      setActivityError(false);
      // Cancelar cualquier fetch previo si había quedado pendiente
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      return;
    }

    // Cancelar fetch anterior si existe
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setActivityLoading(true);
    setActivityError(false);
    setActivityMovilIds(null);

    const useMovilesDia = process.env.NEXT_PUBLIC_USE_MOVILES_DIA === 'true';

    if (useMovilesDia && escenarioId) {
      // Rama moviles_dia: leer filas de la fecha y extraer Set<id>
      const params = new URLSearchParams({ escenario: String(escenarioId), fecha: date });
      if (selectedEmpresas && selectedEmpresas.length > 0) {
        params.set('empresas', selectedEmpresas.join(','));
      }
      fetch(`/api/moviles-dia?${params.toString()}`, {
        signal: controller.signal,
        headers: { 'x-track-isroot': isRoot ?? 'N' },
      })
        .then((res) => res.json())
        .then((result: { data?: Array<{ id: number; activo?: boolean; inactivoDelDia?: boolean; currentPosition?: { coordX: number; coordY: number } | null }> }) => {
          if (Array.isArray(result.data)) {
            // Universo para histórico: TODOS los móviles devueltos por moviles_dia
            // (en fechas pasadas el rebuild pone activo=false, inactivo_del_dia=true en todas).
            // Para hoy: activos + inactivos del día + los que tienen GPS aunque recompute no los haya marcado.
            // Nota: isToday aquí refleja la fecha seleccionada en el modal (puede diferir
            // de la fecha del dashboard si el usuario cambió la fecha dentro del modal).
            const ids = new Set<number>(
              isToday
                ? result.data
                    .filter((m) => m.activo === true || m.inactivoDelDia === true || m.currentPosition != null)
                    .map((m) => m.id)
                : result.data.map((m) => m.id) // fecha histórica: incluir todos sin filtrar por flags
            );
            setActivityMovilIds(ids);
          } else {
            console.warn('[TrackingModal] moviles-dia respondió sin data:', result);
            setActivityError(true);
            setActivityMovilIds(null);
          }
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') return;
          console.error('[TrackingModal] Error al cargar moviles-dia:', err);
          setActivityError(true);
          setActivityMovilIds(null);
        })
        .finally(() => {
          setActivityLoading(false);
        });
    } else {
      // Rama original: /api/moviles-with-activity
      const params = new URLSearchParams({ date });
      if (selectedEmpresas && selectedEmpresas.length > 0) {
        params.set('empresaIds', selectedEmpresas.join(','));
      }
      fetch(`/api/moviles-with-activity?${params.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((result: { success: boolean; data?: number[] }) => {
          if (result.success && Array.isArray(result.data)) {
            setActivityMovilIds(new Set(result.data));
          } else {
            // API respondió con error — fallback: mostrar todos
            console.warn('[TrackingModal] moviles-with-activity respondió sin data:', result);
            setActivityError(true);
            setActivityMovilIds(null);
          }
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') return; // Fetch cancelado intencionalmente
          console.error('[TrackingModal] Error al cargar móviles con actividad:', err);
          setActivityError(true);
          setActivityMovilIds(null); // Fallback: mostrar todos
        })
        .finally(() => {
          setActivityLoading(false);
        });
    }

    return () => {
      controller.abort();
    };
  }, [isOpen, date, selectedEmpresas, escenarioId, isRoot, movilesDiaMode, isToday, moviles]);

  // R2 + R3: Filtrar por actividad + ocultos + búsqueda, ordenar por nro (m.id)
  const filteredMoviles = useMemo(() => {
    // hiddenMovilIds (ocultos-pero-operativos) aplica solo cuando se ve HOY.
    // En fechas históricas NO aplicar: un móvil inactivo que ese día tuvo pedidos
    // debe ser seleccionable para ver su recorrido, independientemente de su estado actual.
    // En modo hoy: conservar el filtro para no mostrar móviles ocultos-operativos en la lista.
    const base = isToday && hiddenMovilIds && hiddenMovilIds.size > 0
      ? moviles.filter(m => !hiddenMovilIds.has(m.id))
      : moviles;

    // R2: Filtrar por actividad (solo si el fetch terminó con datos)
    // Si activityMovilIds === null (cargando o error), mostrar todos como fallback
    const withActivity = activityMovilIds !== null
      ? base.filter(m => activityMovilIds.has(m.id))
      : base;

    // Filtrar por búsqueda — replica Fix B del colapsable:
    // numérico puro → startsWith sobre id; con letras → includes sobre name/matricula
    const withSearch = !search.trim()
      ? withActivity
      : (() => {
          const q = search.trim();
          const isNumeric = /^\d+$/.test(q);
          if (isNumeric) {
            return withActivity.filter(m => String(m.id).startsWith(q));
          }
          const lower = q.toLowerCase();
          return withActivity.filter(m =>
            (m.name && m.name.toLowerCase().includes(lower)) ||
            (m.matricula && m.matricula.toLowerCase().includes(lower))
          );
        })();

    // R3: Ordenar por número de móvil ascendente
    return withSearch.slice().sort((a, b) => a.id - b.id);
  }, [moviles, search, hiddenMovilIds, activityMovilIds, isToday]);

  // Móvil seleccionado actualmente
  const selectedMovilData = useMemo(() => {
    if (!movilId) return null;
    return moviles.find(m => m.id === movilId) || null;
  }, [moviles, movilId]);

  const handleConfirm = () => {
    if (!movilId) return;
    onConfirm(movilId as number, date);
  };

  return (
    <AnimatePresence onExitComplete={handleOpen}>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            id="tour-modal-tracking"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="bg-white rounded-2xl shadow-2xl w-[440px] max-h-[80vh] overflow-hidden border border-gray-200"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-lg p-2">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg">Ver Recorrido</h2>
                  <p className="text-white/70 text-xs">Selecciona un móvil y una fecha</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 transition-all flex items-center justify-center"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Selector de móvil */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🚗 Móvil
                </label>

                {/* Búsqueda + contador */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar por ID, descripción o patente..."
                      className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-400 focus:outline-none transition-colors"
                    />
                  </div>
                  {!activityLoading && (
                    <span className="ml-2 text-xs text-gray-500 whitespace-nowrap">
                      {filteredMoviles.length} móviles
                    </span>
                  )}
                </div>

                {/* Lista de móviles */}
                <div className="max-h-[200px] overflow-y-auto border-2 border-gray-200 rounded-xl">
                  {/* R2: Estado de carga del filtro de actividad */}
                  {activityLoading ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                      Cargando móviles con actividad...
                    </div>
                  ) : (
                    <>
                      {/* Aviso de fallback si hubo error en el fetch */}
                      {activityError && (
                        <div className="px-3 py-2 text-xs text-amber-600 bg-amber-50 border-b border-amber-100">
                          No se pudo filtrar por actividad — mostrando todos los móviles
                        </div>
                      )}

                      {filteredMoviles.length === 0 ? (
                        <div className="p-4 text-center text-sm text-gray-400">
                          No se encontraron móviles con actividad en esta fecha
                        </div>
                      ) : (
                        filteredMoviles.map((m) => {
                          // R4: Estilo del círculo y texto del estado según fecha.
                          // HOY: verde si activo===true; gris si inactivoDelDia===true o GPS sin recompute.
                          // FECHA ANTERIOR: todos gris (rebuild marca activo=false, inactivo_del_dia=true).
                          const isActiveToday = isToday && m.activo === true;
                          const circleClass = movilId === m.id
                            ? 'bg-purple-500 text-white'
                            : isActiveToday
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-200 text-gray-500';

                          const statusText = isActiveToday
                            ? '🟢 Activo'
                            : '⚪ Inactivo del día';

                          return (
                            <button
                              key={m.id}
                              onClick={() => setMovilId(m.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all border-b border-gray-100 last:border-b-0 ${
                                movilId === m.id
                                  ? 'bg-purple-50 border-l-4 border-l-purple-500'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${circleClass}`}>
                                {m.id}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-800 truncate">
                                  {m.name || `Móvil ${m.id}`}
                                </div>
                                <div className="text-xs text-gray-400 truncate">
                                  {m.matricula || 'Sin patente'} • {statusText}
                                </div>
                              </div>
                              {movilId === m.id && (
                                <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          );
                        })
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Selector de fecha */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📅 Fecha del recorrido
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  max={todayMontevideo()}
                  {...(minDate !== undefined ? { min: minDate } : {})}
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-medium focus:border-purple-400 focus:outline-none transition-colors"
                />
              </div>

              {/* Info del móvil seleccionado */}
              {selectedMovilData && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-purple-50 rounded-xl p-3 border border-purple-200"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-purple-600 font-semibold">Seleccionado:</span>
                    <span className="text-gray-700">
                      Móvil {selectedMovilData.id} — {selectedMovilData.name || 'Sin descripción'}
                    </span>
                  </div>
                  {selectedMovilData.matricula && (
                    <div className="text-xs text-gray-500 mt-1">
                      Patente: {selectedMovilData.matricula}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={!movilId}
                className={`px-5 py-2.5 text-sm font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 ${
                  movilId
                    ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 hover:shadow-xl transform hover:scale-105'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Ver Recorrido
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
