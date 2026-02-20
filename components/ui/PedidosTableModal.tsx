'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PedidoSupabase, MovilData } from '@/types';
import { computeDelayMinutes, getDelayInfo, DelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion } from '@/utils/estadoPedido';

// ========== Tipos internos ==========
type AtrasoFilter = 'muy_atrasado' | 'atrasado' | 'limite_cercana' | 'en_hora' | 'sin_hora';
type SortKey = 'delay' | 'id' | 'movil' | 'zona' | 'cliente' | 'producto' | 'importe';
type SortDir = 'asc' | 'desc';

interface Filters {
  search: string;
  atraso: AtrasoFilter[];
  zona: number | null;
  movil: number | null;
  producto: string | null;
  soloSinCoords: boolean;
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
interface PedidosTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  pedidos: PedidoSupabase[];
  moviles: MovilData[];
  onPedidoClick?: (pedidoId: number) => void;
}

// ========== Row bg colors for dark theme based on delay ==========
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

export default function PedidosTableModal({ isOpen, onClose, pedidos, moviles, onPedidoClick }: PedidosTableModalProps) {
  const [filters, setFilters] = useState<Filters>({
    search: '',
    atraso: [],
    zona: null,
    movil: null,
    producto: null,
    soloSinCoords: false,
  });
  const [sortKey, setSortKey] = useState<SortKey>('delay');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // ========== Pedidos base: solo pendientes asignados ==========
  const pedidosBase = useMemo(() => {
    return pedidos.filter(p =>
      Number(p.estado_nro) === 1 && String(p.sub_estado_desc) === '5'
    );
  }, [pedidos]);

  // ========== Valores únicos para filtros ==========
  const uniqueZonas = useMemo(() => {
    const set = new Set<number>();
    pedidosBase.forEach(p => { if (p.zona_nro) set.add(p.zona_nro); });
    return Array.from(set).sort((a, b) => a - b);
  }, [pedidosBase]);

  const uniqueMoviles = useMemo(() => {
    const set = new Set<number>();
    pedidosBase.forEach(p => { if (p.movil) set.add(Number(p.movil)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [pedidosBase]);

  const uniqueProductos = useMemo(() => {
    const set = new Set<string>();
    pedidosBase.forEach(p => { if (p.producto_nom) set.add(p.producto_nom); });
    return Array.from(set).sort();
  }, [pedidosBase]);

  // ========== Compute delay for all pedidos (cached) ==========
  const pedidosWithDelay = useMemo(() => {
    return pedidosBase.map(p => {
      const delayMins = computeDelayMinutes(p.fch_hora_max_ent_comp);
      const delayInfo = getDelayInfo(delayMins);
      return { pedido: p, delayMins, delayInfo };
    });
  }, [pedidosBase]);

  // ========== Applied filters ==========
  const filtered = useMemo(() => {
    let result = [...pedidosWithDelay];

    // Text search
    const search = filters.search.toLowerCase().trim();
    if (search) {
      result = result.filter(({ pedido: p }) =>
        p.id.toString().includes(search) ||
        (p.cliente_nombre?.toLowerCase().includes(search)) ||
        (p.cliente_direccion?.toLowerCase().includes(search)) ||
        (p.cliente_tel?.includes(search)) ||
        (p.producto_nom?.toLowerCase().includes(search)) ||
        (p.servicio_nombre?.toLowerCase().includes(search)) ||
        (p.movil?.toString().includes(search))
      );
    }

    // Atraso filter
    if (filters.atraso.length > 0) {
      result = result.filter(({ delayInfo }) => {
        const key = DELAY_LABEL_TO_KEY[delayInfo.label];
        return key && filters.atraso.includes(key);
      });
    }

    // Zona filter
    if (filters.zona !== null) {
      result = result.filter(({ pedido: p }) => p.zona_nro === filters.zona);
    }

    // Movil filter
    if (filters.movil !== null) {
      result = result.filter(({ pedido: p }) => Number(p.movil) === filters.movil);
    }

    // Producto filter
    if (filters.producto !== null) {
      result = result.filter(({ pedido: p }) => p.producto_nom === filters.producto);
    }

    // Sin coordenadas
    if (filters.soloSinCoords) {
      result = result.filter(({ pedido: p }) => !p.latitud || !p.longitud);
    }

    return result;
  }, [pedidosWithDelay, filters]);

  // ========== Sort ==========
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'delay': {
          const da = a.delayMins ?? 99999;
          const db = b.delayMins ?? 99999;
          return (da - db) * dir;
        }
        case 'id': return (a.pedido.id - b.pedido.id) * dir;
        case 'movil': return ((Number(a.pedido.movil) || 0) - (Number(b.pedido.movil) || 0)) * dir;
        case 'zona': return ((a.pedido.zona_nro || 0) - (b.pedido.zona_nro || 0)) * dir;
        case 'cliente': return (a.pedido.cliente_nombre || '').localeCompare(b.pedido.cliente_nombre || '') * dir;
        case 'producto': return (a.pedido.producto_nom || '').localeCompare(b.pedido.producto_nom || '') * dir;
        case 'importe': return ((a.pedido.imp_bruto || 0) - (b.pedido.imp_bruto || 0)) * dir;
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  // ========== Paginated ==========
  const paginated = useMemo(() => {
    return sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [sorted, page]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // ========== Stats ==========
  const stats = useMemo(() => {
    const counts: Record<string, number> = { muy_atrasado: 0, atrasado: 0, limite_cercana: 0, en_hora: 0, sin_hora: 0 };
    pedidosWithDelay.forEach(({ delayInfo }) => {
      const key = DELAY_LABEL_TO_KEY[delayInfo.label] || 'sin_hora';
      counts[key]++;
    });
    return counts;
  }, [pedidosWithDelay]);

  // ========== Handlers ==========
  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'delay' ? 'asc' : 'asc');
    }
    setPage(0);
  }, [sortKey]);

  const toggleAtraso = useCallback((key: AtrasoFilter) => {
    setFilters(prev => ({
      ...prev,
      atraso: prev.atraso.includes(key)
        ? prev.atraso.filter(k => k !== key)
        : [...prev.atraso, key],
    }));
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ search: '', atraso: [], zona: null, movil: null, producto: null, soloSinCoords: false });
    setPage(0);
  }, []);

  const getMovilName = useCallback((movilId: number | null) => {
    if (!movilId) return '—';
    const m = moviles.find(mv => mv.id === Number(movilId));
    return m ? (m.name || `Móvil ${m.id}`) : `#${movilId}`;
  }, [moviles]);

  const getMovilColor = useCallback((movilId: number | null) => {
    if (!movilId) return '#6B7280';
    const m = moviles.find(mv => mv.id === Number(movilId));
    return m?.color || '#6B7280';
  }, [moviles]);

  const hasActiveFilters = filters.search || filters.atraso.length > 0 || filters.zona !== null || filters.movil !== null || filters.producto !== null || filters.soloSinCoords;

  // ========== Sort Arrow Component ==========
  const SortArrow = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-teal-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // ========== Format time ==========
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
            id="tour-modal-pedidos-table"
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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Vista Extendida de Pedidos</h2>
                  <p className="text-xs text-gray-400">
                    {sorted.length} pedido{sorted.length !== 1 ? 's' : ''} pendiente{sorted.length !== 1 ? 's' : ''}
                    {hasActiveFilters ? ` (de ${pedidosBase.length} total)` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Toggle Filters */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                    showFilters ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filtros
                  {hasActiveFilters && (
                    <span className="bg-teal-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                      !
                    </span>
                  )}
                </button>

                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-700/50 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ========== Status Bar ==========  */}
            <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-700/30 bg-gray-800/40 flex-shrink-0">
              {ATRASO_OPTIONS.map(opt => (
                <div key={opt.key} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <div className={`w-2 h-2 rounded-full ${opt.dotColor}`} />
                  <span>{opt.label}:</span>
                  <span className="font-bold text-gray-200">{stats[opt.key] || 0}</span>
                </div>
              ))}
              <div className="ml-auto text-xs text-gray-500">
                Total: <span className="font-bold text-gray-300">{pedidosBase.length}</span>
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
                    {/* Row 1: Search + dropdowns */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[200px]">
                        <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Buscar por ID, cliente, dirección, teléfono, producto..."
                          value={filters.search}
                          onChange={(e) => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0); }}
                          className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20"
                        />
                      </div>

                      {/* Zona select */}
                      <select
                        value={filters.zona ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, zona: e.target.value ? Number(e.target.value) : null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-teal-500/50"
                      >
                        <option value="">Todas las zonas</option>
                        {uniqueZonas.map(z => <option key={z} value={z}>Zona {z}</option>)}
                      </select>

                      {/* Movil select */}
                      <select
                        value={filters.movil ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, movil: e.target.value ? Number(e.target.value) : null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-teal-500/50"
                      >
                        <option value="">Todos los móviles</option>
                        {uniqueMoviles.map(m => <option key={m} value={m}>{getMovilName(m)}</option>)}
                      </select>

                      {/* Producto select */}
                      <select
                        value={filters.producto ?? ''}
                        onChange={(e) => { setFilters(f => ({ ...f, producto: e.target.value || null })); setPage(0); }}
                        className="bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-teal-500/50 max-w-[180px]"
                      >
                        <option value="">Todos los productos</option>
                        {uniqueProductos.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>

                      {/* Sin coords toggle */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-gray-300">
                        <input
                          type="checkbox"
                          checked={filters.soloSinCoords}
                          onChange={(e) => { setFilters(f => ({ ...f, soloSinCoords: e.target.checked })); setPage(0); }}
                          className="rounded bg-gray-700 border-gray-600 text-teal-500 focus:ring-teal-500/20"
                        />
                        Solo sin coords
                      </label>

                      {/* Clear */}
                      {hasActiveFilters && (
                        <button
                          onClick={clearFilters}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Limpiar
                        </button>
                      )}
                    </div>

                    {/* Row 2: Atraso chips */}
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
                      # Pedido <SortArrow col="id" />
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
                    <th className="px-4 py-3 whitespace-nowrap">Dirección</th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200" onClick={() => handleSort('producto')}>
                      Producto <SortArrow col="producto" />
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap">Cant.</th>
                    <th className="px-4 py-3 cursor-pointer hover:text-gray-200 whitespace-nowrap" onClick={() => handleSort('importe')}>
                      Importe <SortArrow col="importe" />
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap">H. Máx</th>
                    <th className="px-4 py-3 whitespace-nowrap">Estado</th>
                    <th className="px-4 py-3 whitespace-nowrap">Coords</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center py-12 text-gray-500">
                        <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {hasActiveFilters ? 'No hay pedidos que coincidan con los filtros' : 'No hay pedidos pendientes'}
                      </td>
                    </tr>
                  ) : (
                    paginated.map(({ pedido: p, delayMins, delayInfo }) => (
                      <tr
                        key={p.id}
                        onClick={() => onPedidoClick?.(p.id)}
                        className={`border-l-4 border-b border-gray-800/50 transition-colors cursor-pointer ${getRowBg(delayInfo)}`}
                      >
                        {/* Atraso badge */}
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${getDelayBadgeStyle(delayInfo)}`}>
                            ⏱ {delayInfo.badgeText}
                          </span>
                        </td>

                        {/* ID */}
                        <td className="px-4 py-2.5">
                          <span className="font-bold text-white">#{p.id}</span>
                        </td>

                        {/* Movil */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getMovilColor(p.movil) }} />
                            <span className="text-gray-200 text-xs whitespace-nowrap">{getMovilName(p.movil)}</span>
                          </div>
                        </td>

                        {/* Zona */}
                        <td className="px-4 py-2.5 text-gray-300 text-xs">
                          {p.zona_nro || '—'}
                        </td>

                        {/* Cliente */}
                        <td className="px-4 py-2.5">
                          <div className="text-gray-200 text-xs truncate max-w-[180px]" title={p.cliente_nombre || undefined}>
                            {p.cliente_nombre || '—'}
                          </div>
                          {p.cliente_tel && (
                            <div className="text-[10px] text-gray-500">{p.cliente_tel}</div>
                          )}
                        </td>

                        {/* Dirección */}
                        <td className="px-4 py-2.5">
                          <div className="text-gray-300 text-xs truncate max-w-[200px]" title={p.cliente_direccion || undefined}>
                            {p.cliente_direccion || '—'}
                          </div>
                          {p.cliente_ciudad && (
                            <div className="text-[10px] text-gray-500">{p.cliente_ciudad}</div>
                          )}
                        </td>

                        {/* Producto */}
                        <td className="px-4 py-2.5">
                          <div className="text-gray-300 text-xs truncate max-w-[140px]" title={p.producto_nom || undefined}>
                            {p.producto_nom || '—'}
                          </div>
                        </td>

                        {/* Cantidad */}
                        <td className="px-4 py-2.5 text-gray-300 text-xs text-center">
                          {p.producto_cant ?? '—'}
                        </td>

                        {/* Importe */}
                        <td className="px-4 py-2.5 text-gray-300 text-xs whitespace-nowrap">
                          {formatCurrency(p.imp_bruto)}
                        </td>

                        {/* Hora máxima */}
                        <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap font-mono">
                          {formatTime(p.fch_hora_max_ent_comp)}
                        </td>

                        {/* Estado */}
                        <td className="px-4 py-2.5">
                          <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {getEstadoDescripcion(p.sub_estado_nro, p.sub_estado_desc)}
                          </span>
                        </td>

                        {/* Coords indicator */}
                        <td className="px-4 py-2.5 text-center">
                          {p.latitud && p.longitud ? (
                            <span className="text-green-400 text-xs" title={`${p.latitud}, ${p.longitud}`}>✓</span>
                          ) : (
                            <span className="text-red-400 text-xs" title="Sin coordenadas">✗</span>
                          )}
                        </td>
                      </tr>
                    ))
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
                  <button
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ««
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ‹
                  </button>
                  <span className="text-xs text-gray-300 px-3">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ›
                  </button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    »»
                  </button>
                </div>
              )}

              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
