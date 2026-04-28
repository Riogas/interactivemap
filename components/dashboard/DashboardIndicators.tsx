'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { PedidoSupabase } from '@/types';
import { motion } from 'framer-motion';
import { isPedidoEntregado } from '@/utils/estadoPedido';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';
import { isPedidoInScope, type ScopeFilter } from '@/lib/scope-filter';

interface DashboardIndicatorsProps {
  moviles: any[];
  pedidos: PedidoSupabase[];
  services: any[];
  selectedDate: string;
  selectedMoviles?: number[];
  escenarioIds?: number[];
  maxCoordinateDelayMinutes?: number;
  allMovilEstados?: Map<string, number>;
  /** IDs numéricos de móviles "ocultos pero operativos" (basado en `movilesFiltered`). */
  hiddenMovilIds?: Set<number>;
  /** IDs crudos (string) de móviles ocultos basado en el Map completo `allMovilEstados`. */
  allHiddenMovilIds?: Set<string>;
  /** Tipo de servicio activo en la capa Móviles-Zonas del mapa (URGENTE/SERVICE/NOCTURNO) */
  zonasSinMovilServiceFilter?: string;
  /** Intervalo de refresco de zonas/demoras en segundos (default 60). Usar el mismo que el polling configurado en preferencias */
  zonasRefreshSeconds?: number;
  /** Scope de zonas permitidas para "Zonas sin Móvil" / "Zonas No Activas". null = sin scope (root/despacho). */
  scopedZonaIds?: Set<number> | null;
  /** Empresas permitidas — se pasan como ?empresaIds= a /api/zonas, /api/moviles-zonas, /api/demoras. null = sin scope. */
  scopedEmpresas?: number[] | null;
  /** Scope (móviles + zonas) para filtrar pedidos en sinAsignar / entregados / % cuando el user es distribuidor. */
  scope?: ScopeFilter;
  onSinAsignarClick?: () => void;
  onEntregadosClick?: () => void;
  onPorcentajeClick?: () => void;
  onZonasSinMovilClick?: () => void;
  onMovilesSinReportarClick?: () => void;
  onZonasNoActivasClick?: () => void;
}

export default function DashboardIndicators({ moviles, pedidos, services, selectedDate, selectedMoviles = [], escenarioIds = [], maxCoordinateDelayMinutes = 30, allMovilEstados, hiddenMovilIds, allHiddenMovilIds, zonasSinMovilServiceFilter = 'URGENTE', zonasRefreshSeconds = 60, scopedZonaIds = null, scopedEmpresas = null, scope, onSinAsignarClick, onEntregadosClick, onPorcentajeClick, onZonasSinMovilClick, onMovilesSinReportarClick, onZonasNoActivasClick }: DashboardIndicatorsProps) {
  
  // ============= CÁLCULOS DE PEDIDOS =============
  const pedidosStats = useMemo(() => {
    const scopeRestricted = scope?.isRestricted ?? false;

    // Sin asignar: pendientes (estado 1) sin móvil o móvil === 0.
    // Para distribuidor: solo cuentan los sin asignar cuya zona está en su scope.
    let sinAsignar: PedidoSupabase[] = pedidos.filter(p => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0));
    if (scopeRestricted && scope) {
      sinAsignar = sinAsignar.filter(p => isPedidoInScope(p, scope, { hideEntregadosSinMovil: false }));
    }

    // Finalizados: estado_nro === 2
    let finalizados = pedidos.filter(p => Number(p.estado_nro) === 2);

    if (scopeRestricted && scope) {
      // Distribuidor: hideEntregadosSinMovil=true (no puede ver entregados huérfanos),
      // y los finalizados con móvil deben pertenecer a su scope (móvil + zona).
      finalizados = finalizados.filter(p => isPedidoInScope(p, scope, { hideEntregadosSinMovil: true }));
    } else if (selectedMoviles.length > 0) {
      // Filtrar por móviles seleccionados. Pedidos de móviles ocultos-pero-
      // operativos (p. ej. 167 sin GPS, o huérfanos ausentes de la lista visible)
      // pasan siempre, para que el total coincida con la Vista Extendida y el
      // colapsable de pedidos. Los finalizados sin móvil asignado (huérfanos,
      // p. ej. ENTR. SIN 1710) también pasan siempre, ya están entregados.
      finalizados = finalizados.filter(p => {
        if (!p.movil || Number(p.movil) === 0) return true;
        if (hiddenMovilIds && hiddenMovilIds.has(Number(p.movil))) return true;
        return selectedMoviles.some(id => Number(id) === Number(p.movil));
      });
    }

    // Excluir pedidos hijo (re-entregas) del % entregados
    const finalizadosSinHijo = finalizados.filter(p => !p.pedido_hijo);
    // Entregados: pedidos con estado_nro = 2 y sub_estado_nro = 3 o 19
    const entregados = finalizadosSinHijo.filter(p => isPedidoEntregado(p)).length;
    const totalFinalizadosSinHijo = finalizadosSinHijo.length;
    const porcentajeEntregados = totalFinalizadosSinHijo > 0
      ? Math.round(entregados / totalFinalizadosSinHijo * 100)
      : 0;

    return {
      sinAsignar: sinAsignar.length,
      entregados,
      porcentajeEntregados,
    };
  }, [pedidos, selectedMoviles, hiddenMovilIds, scope]);

  // ============= MÓVILES SIN REPORTAR GPS =============
  // Excluir estadoNro 3 ("No Activo") — esos están fuera de servicio, no es un problema de GPS
  // Esto coincide con el filtro 'actividad: activo' del sidebar (default)
  // También excluir ocultos-pero-operativos (no se cuentan en ningún indicador de móviles).
  const movilesSinReportar = useMemo(() => {
    return moviles.filter(m => {
      if (!m.isInactive) return false;
      if (hiddenMovilIds && hiddenMovilIds.has(m.id)) return false;
      return isMovilActiveForUI(m.estadoNro);
    }).length;
  }, [moviles, hiddenMovilIds]);

  // ============= DATOS DE ZONAS (fetch independiente para indicadores) =============
  const [zonasAllData, setZonasAllData] = useState<any[]>([]);
  const [movilesZonasRecords, setMovilesZonasRecords] = useState<any[]>([]);
  const [demorasRecords, setDemorasRecords] = useState<any[]>([]);

  // Stable keys para evitar re-fetch en cada render (Set/array references cambian aunque el contenido sea igual)
  const scopedEmpresasKey = scopedEmpresas ? scopedEmpresas.join(',') : '';
  const scopedZonasKey = scopedZonaIds ? Array.from(scopedZonaIds).sort((a, b) => a - b).join(',') : '';

  useEffect(() => {
    if (escenarioIds.length === 0) {
      setZonasAllData([]);
      setMovilesZonasRecords([]);
      setDemorasRecords([]);
      return;
    }
    // Fail-closed: scope con set vacío → no fetch, conteos en 0
    if (scopedZonaIds && scopedZonaIds.size === 0) {
      setZonasAllData([]);
      setMovilesZonasRecords([]);
      setDemorasRecords([]);
      return;
    }

    const loadZonasData = async () => {
      try {
        const empresaIdsParam = scopedEmpresas && scopedEmpresas.length > 0
          ? `?empresaIds=${scopedEmpresas.join(',')}`
          : '';
        // Fetch zonas, moviles-zonas y demoras en paralelo
        const [zonasRes, mzRes, demorasRes] = await Promise.all([
          fetch(`/api/zonas${empresaIdsParam}`),
          fetch(`/api/moviles-zonas${empresaIdsParam}`),
          fetch(`/api/demoras${empresaIdsParam}`),
        ]);
        const [zonasResult, mzResult, demorasResult] = await Promise.all([
          zonasRes.json(),
          mzRes.json(),
          demorasRes.json(),
        ]);

        if (zonasResult.success) {
          // Filtrar por escenarios seleccionados Y con geojson (igual que useMapDataView)
          // y aplicar scope client-side por zona (consistente con otros modales)
          setZonasAllData(zonasResult.data.filter((z: any) =>
            escenarioIds.includes(z.escenario_id) &&
            z.geojson &&
            (scopedZonaIds == null || scopedZonaIds.has(z.zona_id))
          ));
        }
        if (mzResult.success) {
          const mz = scopedZonaIds == null
            ? (mzResult.data || [])
            : (mzResult.data || []).filter((r: any) => scopedZonaIds.has(r.zona_id));
          setMovilesZonasRecords(mz);
        }
        if (demorasResult.success) {
          setDemorasRecords(
            (demorasResult.data || []).filter((d: any) =>
              escenarioIds.includes(d.escenario_id) &&
              (scopedZonaIds == null || scopedZonaIds.has(d.zona_id))
            )
          );
        }
      } catch (err) {
        console.error('❌ Error loading zonas data for indicators:', err);
      }
    };

    loadZonasData();
    // Refrescar según el intervalo configurado en preferencias (mínimo 10s)
    const refreshMs = Math.max(10, zonasRefreshSeconds) * 1000;
    const interval = setInterval(loadZonasData, refreshMs);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escenarioIds, zonasRefreshSeconds, scopedEmpresasKey, scopedZonasKey]);

  // Zonas sin móviles: Match MovilesZonasLayer — filtrar por tipo de servicio activo + excluir no-activos y ocultos
  const zonasSinMoviles = useMemo(() => {
    if (zonasAllData.length === 0) return 0;
    const svcUpper = (zonasSinMovilServiceFilter || 'URGENTE').toUpperCase();
    let filtered = movilesZonasRecords.filter((mz: any) => (mz.tipo_de_servicio || '').toUpperCase() === svcUpper);
    // Excluir móviles no-activos (estado ≠ 0/1/2) y los ocultos-pero-operativos
    if (allMovilEstados && allMovilEstados.size > 0) {
      filtered = filtered.filter((mz: any) => {
        const key = String(mz.movil_id);
        if (allHiddenMovilIds && allHiddenMovilIds.has(key)) return false;
        const estado = allMovilEstados.get(key);
        return estado === undefined || isMovilActiveForUI(estado);
      });
    }
    // Computar conteos por zona {prioridad, transito}
    const zonaCounts = new Map<number, { prioridad: number; transito: number }>();
    for (const mz of filtered) {
      const existing = zonaCounts.get(mz.zona_id) || { prioridad: 0, transito: 0 };
      if (mz.prioridad_o_transito === 1) {
        existing.prioridad++;
      } else {
        existing.transito++;
      }
      zonaCounts.set(mz.zona_id, existing);
    }
    // Construir mapa de zonas no activas a partir de demorasRecords (igual que zonasNoActivas)
    const dMap = new Map<number, { minutos: number; activa: boolean }>();
    for (const d of demorasRecords) {
      const existing = dMap.get(d.zona_id);
      if (!existing || d.minutos > existing.minutos) {
        dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
      }
    }
    // Zonas donde prioridad + tránsito = 0, excluyendo zonas no activas
    return zonasAllData.filter((z: any) => {
      // Excluir zonas no activas (ya contadas en "Zonas No Activas")
      const dInfo = dMap.get(z.zona_id);
      if (dInfo && dInfo.activa === false) return false;
      const counts = zonaCounts.get(z.zona_id);
      return !counts || (counts.prioridad === 0 && counts.transito === 0);
    }).length;
  }, [zonasAllData, movilesZonasRecords, allMovilEstados, allHiddenMovilIds, zonasSinMovilServiceFilter, demorasRecords]);

  // Zonas no activas: Match ZonasActivasLayer — iterar zonas visibles y buscar en demoras
  const zonasNoActivas = useMemo(() => {
    if (zonasAllData.length === 0 || demorasRecords.length === 0) return 0;
    // Construir mapa: zona_id → demora con mayor minutos (mismo criterio que useMapDataView)
    const dMap = new Map<number, { minutos: number; activa: boolean }>();
    for (const d of demorasRecords) {
      const existing = dMap.get(d.zona_id);
      if (!existing || d.minutos > existing.minutos) {
        dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
      }
    }
    // Solo contar zonas que existen en zonasAllData (igual que ZonasActivasLayer itera sobre zonas)
    let count = 0;
    for (const z of zonasAllData) {
      const info = dMap.get(z.zona_id);
      if (info && info.activa === false) count++;
    }
    return count;
  }, [zonasAllData, demorasRecords]);

  // ============= SCROLL CON FLECHAS =============
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, pedidos, services, moviles]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  // Detectar si la fecha seleccionada es histórica (no es hoy)
  const isHistorical = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return selectedDate !== today;
  }, [selectedDate]);

  // Modo histórico: solo Entregados + % Entregados + botón de estadísticas
  if (isHistorical) {
    return (
      <div className="flex items-center gap-1.5">
        <Indicator
          icon="✅"
          label="Entregados"
          value={pedidosStats.entregados}
          color="green"
          onClick={onEntregadosClick}
        />
        <Indicator
          icon="📊"
          label="% Entregados"
          value={`${pedidosStats.porcentajeEntregados}%`}
          color={pedidosStats.porcentajeEntregados >= 80 ? 'green' : pedidosStats.porcentajeEntregados >= 50 ? 'orange' : 'red'}
          onClick={onPorcentajeClick}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 min-w-0 flex-1">
      {/* Flecha izquierda */}
      <button
        onClick={() => scroll('left')}
        className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 ${
          canScrollLeft
            ? 'bg-white/20 hover:bg-white/30 text-white cursor-pointer'
            : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll indicadores izquierda"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Contenedor scrollable de indicadores */}
      <div ref={scrollRef} className="flex items-center gap-1.5 lg:gap-2 overflow-x-auto hide-scrollbar min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        {/* Pedidos Sin Asignar */}
        <Indicator
          icon="📦"
          label="Ped. sin Asig."
          value={pedidosStats.sinAsignar}
          color={pedidosStats.sinAsignar > 0 ? 'orange' : 'gray'}
          onClick={onSinAsignarClick}
        />

        {/* Separador */}
        <div className="h-6 w-px bg-white/30" />

        {/* Pedidos Entregados */}
        <Indicator
          icon="✅"
          label="Entregados"
          value={pedidosStats.entregados}
          color="green"
          onClick={onEntregadosClick}
        />

        {/* % Entregados */}
        <Indicator
          icon="📊"
          label="% Entregados"
          value={`${pedidosStats.porcentajeEntregados}%`}
          color={pedidosStats.porcentajeEntregados >= 80 ? 'green' : pedidosStats.porcentajeEntregados >= 50 ? 'orange' : 'red'}
          onClick={onPorcentajeClick}
        />

        {/* Separador */}
        <div className="h-6 w-px bg-white/30" />

        {/* Zonas sin Móviles */}
        <Indicator
          icon="🗺️"
          label="Zonas sin Móvil"
          value={zonasSinMoviles}
          color={zonasSinMoviles > 0 ? 'orange' : 'gray'}
          onClick={onZonasSinMovilClick}
        />

        {/* Zonas No Activas */}
        <Indicator
          icon="🔴"
          label="Zonas No Activas"
          value={zonasNoActivas}
          color={zonasNoActivas > 0 ? 'red' : 'gray'}
          onClick={onZonasNoActivasClick}
        />

        {/* Móviles sin Reportar */}
        <Indicator
          icon="📡"
          label="Móviles sin Reportar"
          value={movilesSinReportar}
          color={movilesSinReportar > 0 ? 'red' : 'gray'}
          onClick={onMovilesSinReportarClick}
        />


      </div>
      </div>

      {/* Flecha derecha */}
      <button
        onClick={() => scroll('right')}
        className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200 ${
          canScrollRight
            ? 'bg-white/20 hover:bg-white/30 text-white cursor-pointer'
            : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll indicadores derecha"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

// ============= COMPONENTE INDIVIDUAL DE INDICADOR =============
interface IndicatorProps {
  icon: string;
  label: string;
  value: number | string;
  subtitle?: string;
  color?: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'gray';
  pulse?: boolean;
  onClick?: () => void;
}

function Indicator({ icon, label, value, subtitle, color = 'blue', pulse = false, onClick }: IndicatorProps) {
  const colorClasses = {
    blue: 'bg-blue-500/20 border-blue-400/30 text-white',
    green: 'bg-green-500/20 border-green-400/30 text-white',
    red: 'bg-red-500/20 border-red-400/30 text-white',
    orange: 'bg-orange-500/20 border-orange-400/30 text-white',
    purple: 'bg-purple-500/20 border-purple-400/30 text-white',
    gray: 'bg-gray-500/20 border-gray-400/30 text-white',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onClick}
      className={`
        backdrop-blur-sm rounded-md px-2 py-1 lg:px-2.5 lg:py-1.5 border
        ${colorClasses[color]}
        ${pulse ? 'animate-pulse' : ''}
        hover:scale-105 transition-transform ${onClick ? 'cursor-pointer' : 'cursor-default'}
        whitespace-nowrap
        h-[36px] lg:h-[44px] flex items-center
      `}
    >
      <div className="flex items-center gap-1 lg:gap-1.5">
        <span className="text-xs lg:text-sm">{icon}</span>
        <div className="flex flex-col leading-none justify-center">
          <div className="flex items-baseline gap-1">
            <span className="text-[10px] lg:text-xs font-medium opacity-75 hidden sm:inline">{label}</span>
            <span className="text-xs lg:text-sm font-bold">{value}</span>
          </div>
          {subtitle && (
            <span className="text-[9px] opacity-60 mt-0.5">{subtitle}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
