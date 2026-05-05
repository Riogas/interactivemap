'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ServiceSupabase, MovilData } from '@/types';
import { computeDelayMinutes, getDelayInfo, DelayInfo } from '@/utils/pedidoDelay';
import { isServiceEntregado } from '@/utils/estadoPedido';
import { isServiceInScope, type ScopeFilter } from '@/lib/scope-filter';

// ========== Tipos internos ==========
type AtrasoFilter = 'muy_atrasado' | 'atrasado' | 'limite_cercana' | 'en_hora' | 'sin_hora';
type SortKey = 'delay' | 'id' | 'movil' | 'zona' | 'cliente' | 'defecto' | 'direccion' | 'hora_max' | 'obs_service' | 'obs_cliente';
type SortDir = 'asc' | 'desc';

interface Filters {
  search: string;
  atraso: AtrasoFilter[];
  zona: number | null;
  movil: number | null;
  defecto: string | null;
  soloSinCoords: boolean;
  asignacion: 'todos' | 'con_movil' | 'sin_movil';
  entrega: 'todos' | 'entregados' | 'no_entregados';
}

const ATRASO_OPTIONS: { key: AtrasoFilter; label: string; color: string; dotColor: string }[] = [
  { key: 'muy_atrasado', label: 'Muy Atrasado', color: 'bg-red-500/20 text-red-300 border-red-500/30', dotColor: 'bg-red-400' },
  { key: 'atrasado', label: 'Atrasado', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', dotColor: 'bg-pink-400' },
  { key: 'limite_cercana', label: 'Límite Cercana', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30', dotColor: 'bg-yellow-400' },
  { key: 'en_hora', label: 'En Hora', color: 'bg-green-500/20 text-green-300 border-green-500/30', dotColor: 'bg-green-400' },
  { key: 'sin_hora', label: 'Sin Hora', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30', dotColor: 'bg-gray-400' },
];

const DELAY_LABEL_TO_KEY: Record<string, AtrasoFilter> = {
  'Muy Atrasado': 'muy_atrasado',
  'Atrasado': 'atrasado',
  'Hora Límite Cercana': 'limite_cercana',
  'En Hora': 'en_hora',
  'Sin hora': 'sin_hora',
};

// ========== Props ==========
interface ServicesTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceSupabase[];
  moviles: MovilData[];
  /** IDs de móviles "ocultos pero operativos" — sus services se ven igual. */
  hiddenMovilIds?: Set<number>;
  onServiceClick?: (serviceId: number) => void;
  onMovilClick?: (movilId: number) => void;
  vista?: 'pendientes' | 'finalizados';
  onVistaChange?: (vista: 'pendientes' | 'finalizados') => void;
  selectedMoviles?: number[];
  externalAtraso?: string[];
  externalTipoServicio?: string;
  preFilterMovil?: number;
  preFilterZona?: number;
  hideUnassigned?: boolean;
  /** True cuando el usuario está en modo "Todos" — todas las empresas
   *  seleccionadas Y todos los móviles operativos seleccionados. Habilita la
   *  visibilidad de services sin asignar y de móviles ocultos-pero-operativos. */
  allMovilesSelected?: boolean;
  /** True para usuarios root / despacho / supervisor / dashboards. Solo ellos
   *  pueden ver services finalizados sin móvil y solo en modo "Todos". */
  privilegedUser?: boolean;
  onClearPreFilter?: () => void;
  onInnerFiltersChange?: (f: Filters) => void;
  externalResetToken?: number;
  /** Scope del usuario distribuidor (móviles + zonas permitidas). null/no-restricted = sin filtro. */
  scope?: ScopeFilter;
}

// ========== Row bg colors ==========
function getRowBg(info: DelayInfo): string {
  switch (info.label) {
    case 'Muy Atrasado': return 'bg-red-500/15 hover:bg-red-500/25 border-l-red-500';
    case 'Atrasado': return 'bg-pink-500/15 hover:bg-pink-500/25 border-l-pink-500';
    case 'Hora Límite Cercana': return 'bg-yellow-500/12 hover:bg-yellow-500/22 border-l-yellow-500';
    case 'En Hora': return 'bg-green-500/12 hover:bg-green-500/22 border-l-green-500';
    default: return 'bg-gray-500/10 hover:bg-gray-500/20 border-l-gray-500';
  }
}

function getDelayBadgeStyle(info: DelayInfo): string {
  switch (info.label) {
    case 'Muy Atrasado': return 'bg-red-500/25 text-red-300';
    case 'Atrasado': return 'bg-pink-500/25 text-pink-300';
    case 'Hora Límite Cercana': return 'bg-yellow-500/25 text-yellow-300';
    case 'En Hora': return 'bg-green-500/25 text-green-300';
    default: return 'bg-gray-500/25 text-gray-400';
  }
}

export default function ServicesTableModal({ isOpen, onClose, services, moviles, hiddenMovilIds, onServiceClick, onMovilClick, vista = 'pendientes', onVistaChange, selectedMoviles = [], externalAtraso = [], externalTipoServicio = 'all', preFilterMovil, preFilterZona, onClearPreFilter, hideUnassigned = false, allMovilesSelected = false, privilegedUser = false, onInnerFiltersChange, externalResetToken, scope }: ServicesTableModalProps) {
  const isFinalizados = vista === 'finalizados';
  const [filters, setFilters] = useState<Filters>({
    search: '',
    atraso: [],
    zona: null,
    movil: null,
    defecto: null,
    soloSinCoords: false,
    asignacion: 'todos',
    entrega: 'todos',
  });
  const [sortKey, setSortKey] = useState<SortKey>('delay');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Report inner filter changes upward
  const onInnerFiltersChangeRef = useRef(onInnerFiltersChange);
  useEffect(() => { onInnerFiltersChangeRef.current = onInnerFiltersChange; });
  useEffect(() => { onInnerFiltersChangeRef.current?.(filters); }, [filters]);

  // Accept external reset
  const prevResetToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalResetToken !== undefined && prevResetToken.current !== undefined && prevResetToken.current !== externalResetToken) {
      setFilters({ search: '', atraso: [], zona: null, movil: null, defecto: null, soloSinCoords: false, asignacion: 'todos', entrega: 'todos' });
    }
    prevResetToken.current = externalResetToken;
  }, [externalResetToken]);

  // Aplicar pre-filtro de móvil con delay para que la tabla cargue primero
  useEffect(() => {
    if (preFilterMovil && isOpen) {
      const timer = setTimeout(() => {
        setFilters(f => ({ ...f, movil: preFilterMovil }));
        setPage(0);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [preFilterMovil, isOpen]);

  // Aplicar pre-filtro de zona inmediatamente
  useEffect(() => {
    if (preFilterZona && isOpen) {
      setFilters(f => ({ ...f, zona: preFilterZona }));
      setPage(0);
    }
  }, [preFilterZona, isOpen]);

  // ========== Services base: según vista (pendientes/finalizados) + filtros externos ==========
  const servicesBase = useMemo(() => {
    let result: ServiceSupabase[];
    if (isFinalizados) {
      result = services.filter(s => Number(s.estado_nro) === 2);

      // Filtro de entrega (solo para finalizados)
      if (filters.entrega === 'entregados') {
        result = result.filter(s => isServiceEntregado(s));
      } else if (filters.entrega === 'no_entregados') {
        result = result.filter(s => !isServiceEntregado(s));
      }
    } else {
      // Pendientes: todos estado_nro = 1 (asignados + sin asignar combinados)
      result = services.filter(s => Number(s.estado_nro) === 1);

      // Filtro de asignación (con móvil / sin móvil)
      if (filters.asignacion === 'sin_movil') {
        result = result.filter(s => !s.movil || Number(s.movil) === 0);
      } else if (filters.asignacion === 'con_movil') {
        result = result.filter(s => s.movil && Number(s.movil) !== 0);
      }
    }

    // Scope del usuario distribuidor (móviles + zonas permitidas). En finalizados
    // se ocultan SIEMPRE los entregados sin móvil. Sin scope: pasa todo.
    if (scope?.isRestricted) {
      result = result.filter(s => isServiceInScope(s, scope, { hideEntregadosSinMovil: isFinalizados }));
    }

    // Filtro por móviles / empresa del usuario.
    // Los finalizados también respetan la restricción de empresas.
    if (preFilterMovil || preFilterZona) {
      // Pre-filtro activo — el dropdown interno se encarga.
    } else if (selectedMoviles.length > 0 && filters.asignacion !== 'sin_movil') {
      result = result.filter(s => {
        if (!s.movil || Number(s.movil) === 0) {
          if (isFinalizados) {
            // Finalizados sin móvil: solo en modo "Todos" Y para usuarios
            // privilegiados (despacho/root/supervisor/dashboard). Distribuidores
            // nunca los ven.
            return allMovilesSelected && privilegedUser;
          }
          // Pendientes sin asignar: solo en modo "Todos" — con subset
          // seleccionado, los sin-asignar corresponden a otra cosa.
          return filters.asignacion === 'todos' && !hideUnassigned && allMovilesSelected;
        }
        // Móviles seleccionados pasan
        if (selectedMoviles.some(id => Number(id) === Number(s.movil))) return true;
        // Móviles ocultos-pero-operativos: SOLO en modo "Todos".
        if (allMovilesSelected && hiddenMovilIds && hiddenMovilIds.has(Number(s.movil))) return true;
        return false;
      });
    } else if (hideUnassigned && filters.asignacion === 'todos') {
      // Sin móviles seleccionados, con restricción: ocultar sin asignar
      // y restringir a móviles del usuario. Incluir los IDs ocultos-pero-operativos
      // para que sus services no se pierdan.
      const validMovilIds = new Set(moviles.map(m => Number(m.id)));
      if (hiddenMovilIds) {
        hiddenMovilIds.forEach(id => validMovilIds.add(id));
      }
      result = result.filter(s => {
        if (!s.movil || Number(s.movil) === 0) return false;
        return validMovilIds.has(Number(s.movil));
      });
    }
    
    // Aplicar filtro externo de tipo de servicio (solo para pendientes)
    if (!isFinalizados && externalTipoServicio && externalTipoServicio !== 'all') {
      const tipoUpper = externalTipoServicio.toUpperCase();
      result = result.filter(s => s.servicio_nombre && s.servicio_nombre.toUpperCase() === tipoUpper);
    }
    
    return result;
  }, [services, isFinalizados, selectedMoviles, externalTipoServicio, preFilterMovil, preFilterZona, filters.asignacion, filters.entrega, hideUnassigned, allMovilesSelected, privilegedUser, moviles, hiddenMovilIds, scope]);

  // ========== Valores únicos para filtros (sin filtro de selectedMoviles) ==========
  // Respetamos scope: un distribuidor solo ve sus móviles/zonas/defectos en los dropdowns.
  const servicesParaOpciones = useMemo(() => {
    let result: ServiceSupabase[];
    if (isFinalizados) result = services.filter(s => Number(s.estado_nro) === 2);
    else result = services.filter(s => Number(s.estado_nro) === 1);
    if (scope?.isRestricted) {
      result = result.filter(s => isServiceInScope(s, scope, { hideEntregadosSinMovil: isFinalizados }));
    }
    return result;
  }, [services, isFinalizados, scope]);

  const uniqueZonas = useMemo(() => {
    const set = new Set<number>();
    servicesParaOpciones.forEach(s => { if (s.zona_nro) set.add(s.zona_nro); });
    return Array.from(set).sort((a, b) => a - b);
  }, [servicesParaOpciones]);

  const uniqueMoviles = useMemo(() => {
    const set = new Set<number>();
    servicesParaOpciones.forEach(s => { if (s.movil && Number(s.movil) !== 0) set.add(Number(s.movil)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [servicesParaOpciones]);

  const uniqueDefectos = useMemo(() => {
    const set = new Set<string>();
    servicesParaOpciones.forEach(s => { if (s.defecto) set.add(s.defecto); });
    return Array.from(set).sort();
  }, [servicesParaOpciones]);

  // ========== Compute delay for all services ==========
  const servicesWithDelay = useMemo(() => {
    return servicesBase.map(s => {
      const delayMins = computeDelayMinutes(s.fch_hora_max_ent_comp);
      const delayInfo = getDelayInfo(delayMins);
      return { service: s, delayMins, delayInfo };
    });
  }, [servicesBase]);

  // ========== Applied filters ==========
  const filtered = useMemo(() => {
    let result = [...servicesWithDelay];

    const search = filters.search.toLowerCase().trim();
    if (search) {
      result = result.filter(({ service: s }) =>
        s.id.toString().includes(search) ||
        (s.cliente_nombre?.toLowerCase().includes(search)) ||
        (s.cliente_direccion?.toLowerCase().includes(search)) ||
        (s.cliente_tel?.includes(search)) ||
        (s.defecto?.toLowerCase().includes(search)) ||
        (s.servicio_nombre?.toLowerCase().includes(search)) ||
        (s.movil?.toString().includes(search))
      );
    }

    if (filters.atraso.length > 0) {
      result = result.filter(({ delayInfo }) => {
        const key = DELAY_LABEL_TO_KEY[delayInfo.label];
        return key && filters.atraso.includes(key);
      });
    }

    if (filters.zona !== null) {
      result = result.filter(({ service: s }) => s.zona_nro === filters.zona);
    }

    if (filters.movil !== null) {
      result = result.filter(({ service: s }) => Number(s.movil) === filters.movil);
    }

    if (filters.defecto !== null) {
      result = result.filter(({ service: s }) => s.defecto === filters.defecto);
    }

    if (filters.soloSinCoords) {
      result = result.filter(({ service: s }) => !s.latitud || !s.longitud);
    }

    return result;
  }, [servicesWithDelay, filters]);

  // ========== Sort ==========
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'delay': return ((a.delayMins ?? 99999) - (b.delayMins ?? 99999)) * dir;
        case 'id': return (a.service.id - b.service.id) * dir;
        case 'movil': return ((Number(a.service.movil) || 0) - (Number(b.service.movil) || 0)) * dir;
        case 'zona': return ((a.service.zona_nro || 0) - (b.service.zona_nro || 0)) * dir;
        case 'cliente': return (a.service.cliente_nombre || '').localeCompare(b.service.cliente_nombre || '') * dir;
        case 'defecto': return (a.service.defecto || '').localeCompare(b.service.defecto || '') * dir;
        case 'direccion': return (a.service.cliente_direccion || '').localeCompare(b.service.cliente_direccion || '') * dir;
        case 'hora_max': return (a.service.fch_hora_max_ent_comp || '').localeCompare(b.service.fch_hora_max_ent_comp || '') * dir;
        case 'obs_service': return (a.service.pedido_obs || '').localeCompare(b.service.pedido_obs || '') * dir;
        case 'obs_cliente': return (a.service.cliente_obs || '').localeCompare(b.service.cliente_obs || '') * dir;
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  // ========== Paginated ==========
  const paginated = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // ========== Stats ==========
  const stats = useMemo(() => {
    const counts: Record<string, number> = { muy_atrasado: 0, atrasado: 0, limite_cercana: 0, en_hora: 0, sin_hora: 0 };
    servicesWithDelay.forEach(({ delayInfo }) => {
      const key = DELAY_LABEL_TO_KEY[delayInfo.label] || 'sin_hora';
      counts[key]++;
    });
    return counts;
  }, [servicesWithDelay]);

  // ========== Handlers ==========
  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  }, [sortKey]);

  const toggleAtraso = useCallback((key: AtrasoFilter) => {
    setFilters(prev => ({
      ...prev,
      atraso: prev.atraso.includes(key) ? prev.atraso.filter(k => k !== key) : [...prev.atraso, key],
    }));
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ search: '', atraso: [], zona: null, movil: null, defecto: null, soloSinCoords: false, asignacion: 'todos', entrega: 'todos' });
    setPage(0);
  }, []);

  const getMovilName = useCallback((movilId: number | null) => {
    if (!movilId) return '—';
    const m = moviles.find(mv => mv.id === Number(movilId));
    return m ? (m.name || String(m.id)) : String(movilId);
  }, [moviles]);

  const getMovilColor = useCallback((movilId: number | null) => {
    if (!movilId) return '#6B7280';
    const m = moviles.find(mv => mv.id === Number(movilId));
    return m?.color || '#6B7280';
  }, [moviles]);

  const hasActiveFilters = filters.search || filters.atraso.length > 0 || filters.zona !== null || filters.movil !== null || filters.defecto !== null || filters.soloSinCoords;

  const SortArrow = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-violet-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      const localStr = dateStr.replace(/[+-]\d{2}(:\d{2})?$/, '').trim();
      const d = new Date(localStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  };

  const formatCurrency = (val: number | null) => {
    if (val === null || val === undefined) return '—';
    return `$${val.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ========== Header ========== */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-gray-900/80 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Vista Extendida de Services</h2>
                  <p className="text-xs text-gray-400">
                    {sorted.length} service{sorted.length !== 1 ? 's' : ''} {isFinalizados ? 'finalizado' : 'pendiente'}{sorted.length !== 1 ? 's' : ''}
                    {hasActiveFilters ? ` (de ${servicesBase.length} total)` : ''}
                  </p>
                </div>
              </div>

              {/* Vista toggle - en el centro del header */}
              <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5">
                <button
                  onClick={() => { onVistaChange?.('pendientes'); setFilters(f => ({ ...f, entrega: 'todos' })); }}
                  className={`px-3 py-1.5 text-xs rounded-md transition-all font-medium ${
                    vista === 'pendientes' ? 'bg-violet-500/30 text-violet-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Pendientes
                </button>
                <button
                  onClick={() => { onVistaChange?.('finalizados'); setFilters(f => ({ ...f, asignacion: 'todos' })); }}
                  className={`px-3 py-1.5 text-xs rounded-md transition-all font-medium ${
                    isFinalizados ? 'bg-green-500/30 text-green-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Finalizados
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                    showFilters ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filtros
                  {hasActiveFilters && (
                    <span className="bg-violet-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">!</span>
                  )}
                </button>
                <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-700/50 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ========== Status Bar ========== */}
            <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-700/30 bg-gray-800/40 flex-shrink-0">
              {isFinalizados ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-green-400">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    <span>Services Finalizados</span>
                  </div>
                  {/* Filtro Entregados / No Entregados */}
                  <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5 ml-2">
                    <button
                      onClick={() => setFilters(f => ({ ...f, entrega: 'todos' }))}
                      className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                        filters.entrega === 'todos' ? 'bg-gray-600/40 text-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => setFilters(f => ({ ...f, entrega: 'entregados' }))}
                      className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                        filters.entrega === 'entregados' ? 'bg-green-500/30 text-green-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      Entregados
                    </button>
                    <button
                      onClick={() => setFilters(f => ({ ...f, entrega: 'no_entregados' }))}
                      className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                        filters.entrega === 'no_entregados' ? 'bg-red-500/30 text-red-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      No Entregados
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {ATRASO_OPTIONS.map(opt => (
                    <div key={opt.key} className="flex items-center gap-1.5 text-xs text-gray-400">
                      <div className={`w-2 h-2 rounded-full ${opt.dotColor}`} />
                      <span>{opt.label}:</span>
                      <span className="font-bold text-gray-200">{stats[opt.key] || 0}</span>
                    </div>
                  ))}
                  {/* Filtro Asignación: Todos / Con Móvil / Sin Móvil.
                      Solo visible para root/despacho (sin restricción). */}
                  {!hideUnassigned && (
                    <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-0.5 ml-2">
                      <button
                        onClick={() => setFilters(f => ({ ...f, asignacion: 'todos' }))}
                        className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                          filters.asignacion === 'todos' ? 'bg-gray-600/40 text-gray-200 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setFilters(f => ({ ...f, asignacion: 'con_movil' }))}
                        className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                          filters.asignacion === 'con_movil' ? 'bg-blue-500/30 text-blue-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Con Móvil
                      </button>
                      <button
                        onClick={() => setFilters(f => ({ ...f, asignacion: 'sin_movil' }))}
                        className={`px-2.5 py-1 text-[11px] rounded-md transition-all font-medium ${
                          filters.asignacion === 'sin_movil' ? 'bg-orange-500/30 text-orange-300 shadow-sm' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Sin Móvil
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="ml-auto text-xs text-gray-500">
                Total: <span className="font-bold text-gray-300">{servicesBase.length}</span>
              </div>
            </div>

            {/* ========== Filters Panel ========== */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-b border-gray-700/30 flex-shrink-0"
                >
                  <div className="px-6 py-3 bg-gray-800/30 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[200px]">
                        <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Buscar por ID, cliente, dirección, teléfono, defecto..."
                          value={filters.search}
                          onChange={(e) => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0); }}
                          className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                        />
                      </div>

                      <select
                        value={filters.zona ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, zona: e.target.value ? Number(e.target.value) : null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-violet-500/50"
                      >
                        <option value="">Todas las zonas</option>
                        {uniqueZonas.map(z => <option key={z} value={z}>Zona {z}</option>)}
                      </select>

                      <select
                        value={filters.movil ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, movil: e.target.value ? Number(e.target.value) : null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-violet-500/50"
                      >
                        <option value="">Todos los móviles</option>
                        {uniqueMoviles.map(m => <option key={m} value={m}>{getMovilName(m)}</option>)}
                      </select>

                      <select
                        value={filters.defecto ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, defecto: e.target.value || null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-violet-500/50 max-w-[180px]"
                      >
                        <option value="">Todos los defectos</option>
                        {uniqueDefectos.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>

                      {hasActiveFilters && (
                        <button onClick={clearFilters} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Limpiar
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500 mr-1">Atraso:</span>
                      {ATRASO_OPTIONS.map(opt => {
                        const active = filters.atraso.includes(opt.key);
                        return (
                          <button
                            key={opt.key}
                            onClick={() => toggleAtraso(opt.key)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                              active ? opt.color : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600'
                            }`}
                          >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${active ? opt.dotColor : 'bg-gray-600'}`} />
                            {opt.label}
                            <span className="ml-1.5 opacity-70">({stats[opt.key] || 0})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ========== Table ========== */}
            <div className="flex-1 overflow-auto min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/95 backdrop-blur-sm z-10">
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('delay')}>
                      Atraso <SortArrow col="delay" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('id')}>
                      # Service <SortArrow col="id" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('movil')}>
                      Móvil <SortArrow col="movil" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('zona')}>
                      Zona <SortArrow col="zona" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200" onClick={() => handleSort('cliente')}>
                      Cliente <SortArrow col="cliente" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" style={{ minWidth: '280px' }} onClick={() => handleSort('direccion')}>
                      Dirección <SortArrow col="direccion" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200" onClick={() => handleSort('defecto')}>
                      Defecto <SortArrow col="defecto" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('hora_max')}>
                      H. Máx <SortArrow col="hora_max" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('obs_service')}>
                      Obs Service <SortArrow col="obs_service" />
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('obs_cliente')}>
                      Obs Cliente <SortArrow col="obs_cliente" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-gray-500">
                        <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0" />
                        </svg>
                        {hasActiveFilters ? 'No hay services que coincidan con los filtros' : (isFinalizados ? 'No hay services finalizados' : 'No hay services pendientes')}
                      </td>
                    </tr>
                  ) : (
                    paginated.map(({ service: s, delayInfo }) => {
                      const esEntregado = isFinalizados && isServiceEntregado(s);
                      return (
                      <tr
                        key={s.id}
                        className={`border-l-4 border-b border-gray-800/50 transition-colors cursor-pointer ${isFinalizados ? (esEntregado ? 'bg-green-500/10 hover:bg-green-500/20 border-l-green-500' : 'bg-red-500/10 hover:bg-red-500/20 border-l-red-500') : (!s.movil || Number(s.movil) === 0) ? 'bg-gray-400/10 hover:bg-gray-400/20 border-l-gray-400' : getRowBg(delayInfo)}`}
                      >
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          {isFinalizados ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${esEntregado ? 'bg-green-500/25 text-green-300' : 'bg-red-500/25 text-red-300'}`}>
                              {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${getDelayBadgeStyle(delayInfo)}`}>
                              ⏱ {delayInfo.badgeText}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}><span className="font-bold text-white">#{s.id}</span></td>
                        <td className="px-4 py-2.5" onClick={(e) => { e.stopPropagation(); if (s.movil) onMovilClick?.(Number(s.movil)); }}>
                          <div className="flex items-center gap-2 hover:bg-gray-700/40 rounded px-1 -mx-1 transition-colors" title="Ver detalle del móvil">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getMovilColor(s.movil) }} />
                            <span className="text-gray-200 text-xs whitespace-nowrap underline decoration-dotted">{getMovilName(s.movil)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-300 text-xs" onClick={() => onServiceClick?.(s.id)}>{s.zona_nro || '—'}</td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          <div className="text-gray-100 text-xs font-semibold" title={s.cliente_tel || undefined}>
                            {s.cliente_tel || '—'}
                          </div>
                          {s.cliente_nombre && <div className="text-[10px] text-gray-500 truncate max-w-[180px]" title={s.cliente_nombre}>{s.cliente_nombre}</div>}
                        </td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          <div className="text-gray-300 text-xs truncate max-w-[280px]" title={s.cliente_direccion || undefined}>{s.cliente_direccion || '—'}</div>
                          {s.cliente_ciudad && <div className="text-[10px] text-gray-500">{s.cliente_ciudad}</div>}
                        </td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          <div className="text-gray-300 text-xs truncate max-w-[140px]" title={s.defecto || undefined}>{s.defecto || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap font-mono" onClick={() => onServiceClick?.(s.id)}>{formatTime(s.fch_hora_max_ent_comp)}</td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          {s.pedido_obs ? (
                            <div className="text-gray-400 text-[10px] truncate max-w-[120px]" title={s.pedido_obs}>{s.pedido_obs}</div>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" onClick={() => onServiceClick?.(s.id)}>
                          {s.cliente_obs ? (
                            <div className="text-gray-400 text-[10px] truncate max-w-[120px]" title={s.cliente_obs}>{s.cliente_obs}</div>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>

                      </tr>
                    );})
                  )}
                </tbody>
              </table>
            </div>

            {/* ========== Footer / Pagination ========== */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700/50 bg-gray-900/80 flex-shrink-0">
              <div className="text-xs text-gray-500">
                Mostrando {Math.min(page * PAGE_SIZE + 1, sorted.length)}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} de {sorted.length}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">««</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
                  <span className="text-xs text-gray-300 px-3">{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">»»</button>
                </div>
              )}
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors">
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
