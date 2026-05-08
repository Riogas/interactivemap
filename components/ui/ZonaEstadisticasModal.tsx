'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PedidoSupabase, ServiceSupabase } from '@/types';
import { computeDelayMinutes } from '@/utils/pedidoDelay';
import { isPedidoEntregado } from '@/utils/estadoPedido';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';
import { isPedidoInScope, isServiceInScope, type ScopeFilter } from '@/lib/scope-filter';
import type { MovilZonaRecord } from '@/components/map/MovilesZonasLayer';

// ============= Types =============

interface ZonaInfo {
  zona_id: number;
  nombre: string | null;
}

interface ZonaEstadisticasModalProps {
  isOpen: boolean;
  onClose: () => void;
  pedidos: PedidoSupabase[];
  /** Services (tabla separada) — necesarios para modo SERVICE */
  services?: ServiceSupabase[];
  /** escenario_ids para filtrar zonas */
  escenarioIds: number[];
  /** Map<string(movilNro), estadoNro> – siempre disponible desde allMovilEstados */
  movilEstados?: Map<string, number>;
  /** IDs crudos de móviles "ocultos pero operativos" — se excluyen del conteo #Movs P. */
  allHiddenMovilIds?: Set<string>;
  /** Callback al clickear una zona: abre vista extendida de pedidos/services */
  onZonaClick?: (zonaId: number, serviceFilter: string) => void;
  /** Callback al clickear la celda #MOVS P.: abre detalle del/los movil(es) de esa zona */
  onMovsPrioClick?: (zonaId: number, movilIds: number[], serviceFilter: string) => void;
  /** Scope de zonas permitidas (null = root/despacho, sin restricción). */
  scopedZonaIds?: Set<number> | null;
  /** Empresas permitidas para pasar al server (?empresaIds=). null = sin scope. */
  scopedEmpresas?: number[] | null;
  /** Scope (móviles + zonas) para filtrar pedidos/services cuando el user es distribuidor. */
  scope?: ScopeFilter;
  /** Override: si true, fuerza ocultar la columna sin asignar independientemente del scope.
   *  Controlado por permiso x_zona (desde el parent via permisosSA.x_zona). */
  forceHideSinAsignar?: boolean;
}

type SortKey = 'zona' | 'sinAsignar' | 'pendientes' | 'atrasados' | 'pctAtrasos' | 'entregados' | 'noEntregados' | 'pctCumplimiento' | 'demora' | 'movsPrio';

const TIPOS_SERVICIO = ['PEDIDOS', 'SERVICE'] as const;
/** servicio_nombre values que corresponden a "PEDIDOS" */
const PEDIDOS_SERVICES = new Set(['URGENTE', 'NOCTURNO']);

// ============= Component =============

export default function ZonaEstadisticasModal({
  isOpen,
  onClose,
  pedidos,
  services = [],
  escenarioIds,
  movilEstados = new Map(),
  allHiddenMovilIds,
  onZonaClick,
  onMovsPrioClick,
  scopedZonaIds = null,
  scopedEmpresas = null,
  scope,
  forceHideSinAsignar = false,
}: ZonaEstadisticasModalProps) {
  const [sortBy, setSortBy] = useState<SortKey>('zona');
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<string>('PEDIDOS');
  const [filters, setFilters] = useState<Partial<Record<SortKey | 'zonaText', string>>>({});

  // Distribuidor: oculta columna/summary/filtro de "Sin Asignar" y excluye los
  // pedidos sin móvil del cómputo de pendientes.
  const hideSinAsignar = (scope?.isRestricted ?? false) || forceHideSinAsignar;

  // Si la columna sinAsignar queda oculta y el sort estaba en esa key, volver a 'zona'.
  useEffect(() => {
    if (hideSinAsignar && sortBy === 'sinAsignar') {
      setSortBy('zona');
    }
  }, [hideSinAsignar, sortBy]);

  const setFilter = useCallback((key: SortKey | 'zonaText', value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => setFilters({}), []);
  const hasFilters = Object.values(filters).some(v => v !== undefined && v !== '');

  // Data fetched internally
  const [zonas, setZonas] = useState<ZonaInfo[]>([]);
  const [demorasData, setDemorasData] = useState<Map<number, { minutos: number; activa: boolean }>>(new Map());
  const [movilesZonasData, setMovilesZonasData] = useState<MovilZonaRecord[]>([]);

  // Stable key for escenarioIds to avoid re-fetching on each render
  const escenarioKey = JSON.stringify(escenarioIds);
  const scopedEmpresasKey = scopedEmpresas ? scopedEmpresas.join(',') : '';
  const scopedZonasKey = scopedZonaIds ? Array.from(scopedZonaIds).sort((a, b) => a - b).join(',') : '';

  // Fetch all data when modal opens
  useEffect(() => {
    if (!isOpen || escenarioIds.length === 0) return;
    // Fail-closed: scope con set vacío → nada para mostrar
    if (scopedZonaIds && scopedZonaIds.size === 0) {
      setZonas([]);
      setDemorasData(new Map());
      setMovilesZonasData([]);
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const empresaIdsParam = scopedEmpresas && scopedEmpresas.length > 0
          ? `?empresaIds=${scopedEmpresas.join(',')}`
          : '';
        const [zonasRes, demorasRes, mzRes] = await Promise.all([
          fetch(`/api/zonas${empresaIdsParam}`),
          fetch(`/api/demoras${empresaIdsParam}`),
          fetch(`/api/moviles-zonas${empresaIdsParam}`),
        ]);
        const [zonasResult, demorasResult, mzResult] = await Promise.all([
          zonasRes.json(),
          demorasRes.json(),
          mzRes.json(),
        ]);

        if (cancelled) return;

        // Zonas
        if (zonasResult.success && zonasResult.data) {
          const filtered = zonasResult.data
            .filter((z: any) =>
              z.activa !== false &&
              escenarioIds.includes(z.escenario_id) &&
              (scopedZonaIds == null || scopedZonaIds.has(z.zona_id))
            )
            .map((z: any) => ({ zona_id: z.zona_id, nombre: z.nombre }));
          setZonas(filtered);
        }

        // Demoras
        if (demorasResult.success && demorasResult.data) {
          const dMap = new Map<number, { minutos: number; activa: boolean }>();
          for (const d of demorasResult.data) {
            if (!escenarioIds.includes(d.escenario_id)) continue;
            if (scopedZonaIds != null && !scopedZonaIds.has(d.zona_id)) continue;
            const existing = dMap.get(d.zona_id);
            if (!existing || d.minutos > existing.minutos) {
              dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
            }
          }
          setDemorasData(dMap);
        }

        // Moviles-Zonas
        if (mzResult.success && mzResult.data) {
          const mzFiltered = scopedZonaIds == null
            ? mzResult.data
            : mzResult.data.filter((r: any) => scopedZonaIds.has(r.zona_id));
          setMovilesZonasData(mzFiltered);
        }
      } catch (err) {
        console.error('Error loading estadísticas data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, escenarioKey, scopedEmpresasKey, scopedZonasKey]);

  // Filter pedidos/services by service type
  // SERVICE mode usa la tabla 'services' (array separado); PEDIDOS usa 'pedidos' filtrado por URGENTE/NOCTURNO
  // Si el user es distribuidor (scope.isRestricted) aplicamos isPedidoInScope/isServiceInScope
  // con hideEntregadosSinMovil=true para que las estadísticas no incluyan entregados huérfanos
  // ni pedidos/services fuera del scope (móvil + zona).
  const filteredPedidos = useMemo(() => {
    const upper = serviceFilter.toUpperCase();
    let base: PedidoSupabase[];
    if (upper === 'SERVICE') {
      // Los services están en su propio array — aplicar scope con isServiceInScope antes del cast
      const filteredSvcs = scope?.isRestricted
        ? services.filter(s => isServiceInScope(s, scope, { hideEntregadosSinMovil: true }))
        : services;
      // Castear a la misma forma para reutilizar la lógica downstream
      return (filteredSvcs as unknown as PedidoSupabase[]);
    }
    if (upper === 'PEDIDOS') {
      // "PEDIDOS" = todos los pedidos (pedidos y services son arrays separados,
      // no es necesario filtrar por servicio_nombre aquí)
      base = pedidos;
    } else {
      base = pedidos.filter(p => p.servicio_nombre && p.servicio_nombre.toUpperCase() === upper);
    }
    if (scope?.isRestricted) {
      base = base.filter(p => isPedidoInScope(p, scope, { hideEntregadosSinMovil: true }));
    }
    return base;
  }, [pedidos, services, serviceFilter, scope]);

  // Filter movilesZonasData by service type + active + not hidden-operativo
  const filteredMovilesZonas = useMemo(() => {
    const upper = serviceFilter.toUpperCase();
    return movilesZonasData.filter(r => {
      if (!r.activa) return false;
      const key = String(r.movil_id);
      if (allHiddenMovilIds && allHiddenMovilIds.has(key)) return false;
      const estado = movilEstados.get(r.movil_id);
      if (estado !== undefined && !isMovilActiveForUI(estado)) return false;
      const svc = r.tipo_de_servicio?.toUpperCase() || '';
      if (upper === 'PEDIDOS') return PEDIDOS_SERVICES.has(svc);
      return svc === upper;
    });
  }, [movilesZonasData, serviceFilter, movilEstados, allHiddenMovilIds]);

  const stats = useMemo(() => {
    // Build zona name map
    const zonaNames = new Map<number, string>();
    for (const z of zonas) {
      zonaNames.set(z.zona_id, z.nombre || `Zona ${z.zona_id}`);
    }

    // Collect all zona_ids from zonas list + filtered pedidos
    const zonaIds = new Set<number>();
    for (const z of zonas) zonaIds.add(z.zona_id);
    for (const p of filteredPedidos) {
      if (p.zona_nro) zonaIds.add(p.zona_nro);
    }

    // Compute stats per zona
    const result: Array<{
      zonaId: number;
      zonaNombre: string;
      sinAsignar: number;
      pendientes: number;
      atrasados: number;
      pctAtrasos: number;
      entregados: number;
      noEntregados: number;
      pctCumplimiento: number;
      demora: number | null;
      movsPrio: number;
    }> = [];

    for (const zonaId of zonaIds) {
      const pedidosZona = filteredPedidos.filter(p => p.zona_nro === zonaId);

      // Pendientes: TODOS los estado 1 (con y sin movil, igual que la capa heatmap).
      // Distribuidor: NO sumarizar los sin móvil — la columna se elimina y la
      // columna pendientes refleja solo los pedidos asignados a sus móviles.
      const pendientesList = pedidosZona.filter(p => {
        if (Number(p.estado_nro) !== 1) return false;
        if (hideSinAsignar && (!p.movil || Number(p.movil) === 0)) return false;
        return true;
      });
      const pendientes = pendientesList.length;

      // Sin asignar: subconjunto de pendientes sin movil asignado.
      // Para distribuidor queda en 0 (la columna se oculta igualmente).
      const sinAsignar = pendientesList.filter(p =>
        !p.movil || Number(p.movil) === 0
      ).length;

      // Atrasados: pendientes con delay < 0
      const atrasados = pendientesList.filter(p => {
        const delay = computeDelayMinutes(p.fch_hora_max_ent_comp);
        return delay !== null && delay < 0;
      }).length;

      // % Atrasos
      const pctAtrasos = pendientes > 0 ? Math.round((atrasados / pendientes) * 100) : 0;

      // Entregados: estado 2, sub_estado_nro 3 o 19 — excluir pedidos hijo (re-entregas)
      const pedidosZonaSinHijo = pedidosZona.filter(p => !p.pedido_hijo);
      const entregados = pedidosZonaSinHijo.filter(p => isPedidoEntregado(p)).length;

      // No Entregados: estado 2 pero no entregado — excluir pedidos hijo
      const noEntregados = pedidosZonaSinHijo.filter(p =>
        Number(p.estado_nro) === 2 && !isPedidoEntregado(p)
      ).length;

      // % Cumplimiento
      const totalFinalizados = entregados + noEntregados;
      const pctCumplimiento = totalFinalizados > 0 ? Math.round((entregados / totalFinalizados) * 100) : 0;

      // Min Demora
      const demoraInfo = demorasData.get(zonaId);
      const demora = demoraInfo ? demoraInfo.minutos : null;

      // Moviles activos con prioridad para este tipo de servicio (ya pre-filtrados)
      // Deduplicar por movil_id: 884 en URGENTE + 884 en NOCTURNO = 1 movil único
      const movsPrioIds = new Set(
        filteredMovilesZonas
          .filter(r => r.zona_id === zonaId && r.prioridad_o_transito === 1)
          .map(r => String(r.movil_id))
      );
      const movsPrio = movsPrioIds.size;

      result.push({
        zonaId,
        zonaNombre: zonaNames.get(zonaId) || `Zona ${zonaId}`,
        sinAsignar,
        pendientes,
        atrasados,
        pctAtrasos,
        entregados,
        noEntregados,
        pctCumplimiento,
        demora,
        movsPrio,
      });
    }

    return result;
  }, [filteredPedidos, zonas, filteredMovilesZonas, demorasData, hideSinAsignar]);

  // Filter rows
  const filteredStats = useMemo(() => {
    return stats.filter(z => {
      // Zona text search
      if (filters.zonaText) {
        const q = filters.zonaText.toLowerCase();
        if (!z.zonaNombre.toLowerCase().includes(q) && !String(z.zonaId).includes(q)) return false;
      }
      // Numeric "≥ min" filters
      const checks: Array<[number | null, SortKey]> = [
        [z.sinAsignar, 'sinAsignar'],
        [z.pendientes, 'pendientes'],
        [z.atrasados, 'atrasados'],
        [z.pctAtrasos, 'pctAtrasos'],
        [z.entregados, 'entregados'],
        [z.noEntregados, 'noEntregados'],
        [z.pctCumplimiento, 'pctCumplimiento'],
        [z.demora, 'demora'],
        [z.movsPrio, 'movsPrio'],
      ];
      for (const [val, key] of checks) {
        const raw = filters[key];
        if (raw !== undefined && raw !== '') {
          const min = Number(raw);
          if (!isNaN(min) && (val === null || val < min)) return false;
        }
      }
      return true;
    });
  }, [stats, filters]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filteredStats];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'zona': return dir * a.zonaId - dir * b.zonaId;
        case 'sinAsignar': return dir * (a.sinAsignar - b.sinAsignar);
        case 'pendientes': return dir * (a.pendientes - b.pendientes);
        case 'atrasados': return dir * (a.atrasados - b.atrasados);
        case 'pctAtrasos': return dir * (a.pctAtrasos - b.pctAtrasos);
        case 'entregados': return dir * (a.entregados - b.entregados);
        case 'noEntregados': return dir * (a.noEntregados - b.noEntregados);
        case 'pctCumplimiento': return dir * (a.pctCumplimiento - b.pctCumplimiento);
        case 'demora': return dir * ((a.demora ?? 9999) - (b.demora ?? 9999));
        case 'movsPrio': return dir * (a.movsPrio - b.movsPrio);
        default: return 0;
      }
    });
    return arr;
  }, [filteredStats, sortBy, sortAsc]);

  // Summary (reflects active filters)
  const summary = useMemo(() => {
    const totalSinAsignar = filteredStats.reduce((s, z) => s + z.sinAsignar, 0);
    const totalPendientes = filteredStats.reduce((s, z) => s + z.pendientes, 0);
    const totalEntregados = filteredStats.reduce((s, z) => s + z.entregados, 0);
    const totalNoEntregados = filteredStats.reduce((s, z) => s + z.noEntregados, 0);
    const totalFin = totalEntregados + totalNoEntregados;
    const avgCumplimiento = totalFin > 0 ? Math.round((totalEntregados / totalFin) * 100) : 0;
    return { totalSinAsignar, totalPendientes, totalEntregados, totalNoEntregados, avgCumplimiento, zonasCount: filteredStats.length };
  }, [filteredStats]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(key === 'zona'); // ascending for zona, descending for metrics
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortBy !== key) return '';
    return sortAsc ? ' ▲' : ' ▼';
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="zonaest-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="zonaest-modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden border border-cyan-500/30"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-r from-cyan-600 via-blue-500 to-cyan-600 p-4">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9InAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMTAgTDEwIDAgTDIwIDEwIEwxMCAyMCBaIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI3ApIi8+PC9zdmc+')] opacity-30" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">📊</span>
                <div>
                  <h2 className="text-xl font-black text-white tracking-wide drop-shadow-lg">ESTADÍSTICAS POR ZONA</h2>
                  <p className="text-xs text-cyan-100/80 font-medium">Resumen de pedidos por zona del día</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={serviceFilter}
                  onChange={e => setServiceFilter(e.target.value)}
                  className="bg-black/30 text-white text-sm font-semibold rounded-lg px-3 py-1.5 border border-white/20 focus:outline-none focus:border-white/50 cursor-pointer appearance-none"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27white%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M7 10l5 5 5-5z%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '18px', paddingRight: '28px' }}
                >
                  {TIPOS_SERVICIO.map(t => (
                    <option key={t} value={t} className="bg-slate-800 text-white">{t}</option>
                  ))}
                </select>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className={`grid ${hideSinAsignar ? 'grid-cols-4' : 'grid-cols-5'} gap-2 px-4 pt-3 pb-2`}>
            <SummaryCard icon="🗺️" label="Zonas" value={summary.zonasCount} color="blue" />
            {!hideSinAsignar && (
              <SummaryCard icon="⚠️" label="Sin Asignar" value={summary.totalSinAsignar} color="amber" />
            )}
            <SummaryCard icon="⏳" label="Pendientes" value={summary.totalPendientes} color="purple" />
            <SummaryCard icon="✅" label="Entregados" value={summary.totalEntregados} color="green" />
            <SummaryCard icon="📊" label="Cumplimiento" value={`${summary.avgCumplimiento}%`} color="cyan" />
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin scrollbar-thumb-gray-600">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-gray-400 text-[10px] uppercase tracking-wider bg-slate-800/95 backdrop-blur-sm">
                  <ThSort label="Zona" sortKey="zona" current={sortBy} asc={sortAsc} onClick={handleSort} align="left" />
                  {!hideSinAsignar && (
                    <ThSort label="Sin Asig." sortKey="sinAsignar" current={sortBy} asc={sortAsc} onClick={handleSort} title="Pedidos sin asignar (sin móvil)" />
                  )}
                  <ThSort label="#Pend." sortKey="pendientes" current={sortBy} asc={sortAsc} onClick={handleSort} title="Pedidos pendientes asignados" />
                  <ThSort label="#Atras." sortKey="atrasados" current={sortBy} asc={sortAsc} onClick={handleSort} title="Pedidos atrasados (delay < 0)" />
                  <ThSort label="% Atras." sortKey="pctAtrasos" current={sortBy} asc={sortAsc} onClick={handleSort} title="% Atrasos = atrasados / pendientes" />
                  <ThSort label="#Entreg." sortKey="entregados" current={sortBy} asc={sortAsc} onClick={handleSort} title="Entregados (estado 2, sub_estado 3 o 19)" />
                  <ThSort label="#No Ent." sortKey="noEntregados" current={sortBy} asc={sortAsc} onClick={handleSort} title="No Entregados (estado 2, sub_estado ≠ 3 y ≠ 19)" />
                  <ThSort label="% Cump." sortKey="pctCumplimiento" current={sortBy} asc={sortAsc} onClick={handleSort} title="% Cumplimiento = entregados / (entregados + no entregados)" />
                  <ThSort label="Min Dem." sortKey="demora" current={sortBy} asc={sortAsc} onClick={handleSort} title="Minutos de demora de la zona" />
                  <ThSort label="#Movs P." sortKey="movsPrio" current={sortBy} asc={sortAsc} onClick={handleSort} title="Móviles activos en prioridad del tipo de servicio seleccionado (excl. est. 3/5/15)" />
                </tr>
                {/* Filter row */}
                <tr className="bg-slate-900/95 border-b border-cyan-500/20">
                  <th className="py-1 px-1 text-left">
                    <input
                      type="text"
                      placeholder="Buscar..."
                      value={filters.zonaText ?? ''}
                      onChange={e => setFilter('zonaText', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-slate-700/60 border border-slate-600/50 focus:border-cyan-500/70 rounded px-1.5 py-0.5 text-[10px] text-white placeholder-gray-500 outline-none"
                    />
                  </th>
                  {((hideSinAsignar
                    ? ['pendientes', 'atrasados', 'pctAtrasos', 'entregados', 'noEntregados', 'pctCumplimiento', 'demora', 'movsPrio']
                    : ['sinAsignar', 'pendientes', 'atrasados', 'pctAtrasos', 'entregados', 'noEntregados', 'pctCumplimiento', 'demora', 'movsPrio']
                  ) as (SortKey)[]).map(key => (
                    <th key={key} className="py-1 px-1">
                      <input
                        type="number"
                        min={0}
                        placeholder="≥"
                        value={filters[key] ?? ''}
                        onChange={e => setFilter(key, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-slate-700/60 border border-slate-600/50 focus:border-cyan-500/70 rounded px-1 py-0.5 text-[10px] text-white placeholder-gray-500 outline-none text-center"
                        style={{ MozAppearance: 'textfield' }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((z, idx) => {
                  const hasBadCumplimiento = z.pctCumplimiento < 80 && (z.entregados + z.noEntregados) > 0;
                  const hasHighAtrasos = z.pctAtrasos > 50 && z.pendientes > 0;

                  return (
                    <motion.tr
                      key={z.zonaId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${onZonaClick ? 'cursor-pointer' : ''}`}
                      onClick={() => onZonaClick?.(z.zonaId, serviceFilter)}
                    >
                      <td className="py-1.5 px-2 text-left">
                        <span className="text-white font-semibold text-xs">{z.zonaNombre}</span>
                        <span className="text-gray-500 text-[10px] ml-1.5">#{z.zonaId}</span>
                      </td>
                      {!hideSinAsignar && (
                        <td className="py-1.5 px-1 text-center">
                          <span className={`text-xs font-bold ${z.sinAsignar > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                            {z.sinAsignar}
                          </span>
                        </td>
                      )}
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-xs font-bold ${z.pendientes > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                          {z.pendientes}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-xs font-bold ${z.atrasados > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                          {z.atrasados}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          hasHighAtrasos ? 'bg-red-500/20 text-red-400' : 'text-gray-400'
                        }`}>
                          {z.pctAtrasos}%
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-xs font-bold ${z.entregados > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                          {z.entregados}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-xs font-bold ${z.noEntregados > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
                          {z.noEntregados}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <CumplimientoBar pct={z.pctCumplimiento} bad={hasBadCumplimiento} />
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`text-xs font-mono ${z.demora !== null ? 'text-cyan-400' : 'text-gray-600'}`}>
                          {z.demora !== null ? `${z.demora}'` : '—'}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span
                          className={`text-xs font-bold ${z.movsPrio > 0 ? 'text-emerald-400 cursor-pointer hover:underline' : 'text-gray-600'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (z.movsPrio > 0 && onMovsPrioClick) {
                              const movilIds = [...new Set(
                                filteredMovilesZonas
                                  .filter(r => r.zona_id === z.zonaId && r.prioridad_o_transito === 1)
                                  .map(r => Number(r.movil_id))
                              )];
                              onMovsPrioClick(z.zonaId, movilIds, serviceFilter);
                            }
                          }}
                        >
                          {z.movsPrio}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={hideSinAsignar ? 9 : 10} className="py-8 text-center text-gray-500 text-sm">
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          Cargando datos...
                        </span>
                      ) : 'No hay datos de zonas disponibles'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/10 flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">
                {sorted.length}{sorted.length !== stats.length ? `/${stats.length}` : ''} zonas
              </span>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 hover:border-cyan-400/60 rounded px-1.5 py-0.5 transition-colors"
                >
                  ✕ Limpiar filtros
                </button>
              )}
            </div>
            <span className="text-[10px] text-gray-500">Click en fila = Vista Extendida · Click en #Movs P. = Detalle móvil · Filtrar en fila 2 · Cabecera = Ordenar</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============= Sub-components =============

function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-600/80 to-blue-700/80 border-blue-500/30',
    green: 'from-green-600/80 to-green-700/80 border-green-500/30',
    amber: 'from-amber-600/80 to-amber-700/80 border-amber-500/30',
    purple: 'from-purple-600/80 to-purple-700/80 border-purple-500/30',
    cyan: 'from-cyan-600/80 to-cyan-700/80 border-cyan-500/30',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color] || colorMap.blue} rounded-xl p-2 border shadow-lg`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <div>
          <div className="text-[9px] text-white/70 font-medium">{label}</div>
          <div className="text-base font-black text-white leading-tight">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ThSort({ label, sortKey, current, asc, onClick, title, align = 'center' }: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  asc: boolean;
  onClick: (key: SortKey) => void;
  title?: string;
  align?: 'left' | 'center';
}) {
  const isActive = current === sortKey;
  return (
    <th
      className={`py-2 px-1 cursor-pointer hover:text-white transition-colors select-none ${align === 'left' ? 'text-left' : 'text-center'} ${isActive ? 'text-cyan-400' : ''}`}
      onClick={() => onClick(sortKey)}
      title={title}
    >
      {label}{isActive ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function CumplimientoBar({ pct, bad }: { pct: number; bad: boolean }) {
  const color = pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold ${bad ? 'text-red-400' : pct > 0 ? 'text-white' : 'text-gray-600'}`}>
        {pct}%
      </span>
    </div>
  );
}
