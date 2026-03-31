'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { PedidoSupabase } from '@/types';
import { motion } from 'framer-motion';

const EXCLUDED_ESTADOS = new Set([3, 5, 15]);

interface DashboardIndicatorsProps {
  moviles: any[];
  pedidos: PedidoSupabase[];
  services: any[];
  selectedDate: string;
  selectedMoviles?: number[];
  escenarioIds?: number[];
  maxCoordinateDelayMinutes?: number;
  allMovilEstados?: Map<string, number>;
  onSinAsignarClick?: () => void;
  onEntregadosClick?: () => void;
  onPorcentajeClick?: () => void;
}

export default function DashboardIndicators({ moviles, pedidos, services, selectedDate, selectedMoviles = [], escenarioIds = [], maxCoordinateDelayMinutes = 30, allMovilEstados, onSinAsignarClick, onEntregadosClick, onPorcentajeClick }: DashboardIndicatorsProps) {
  
  // ============= CÁLCULOS DE PEDIDOS =============
  const pedidosStats = useMemo(() => {
    // Sin asignar: pendientes (estado 1) sin móvil o móvil === 0
    let sinAsignar = pedidos.filter(p => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0));
    
    // Finalizados: estado_nro === 2
    let finalizados = pedidos.filter(p => Number(p.estado_nro) === 2);
    
    // Filtrar por móviles seleccionados
    if (selectedMoviles.length > 0) {
      finalizados = finalizados.filter(p => p.movil && selectedMoviles.some(id => Number(id) === Number(p.movil)));
    }
    
    // Entregados: finalizados con sub_estado_nro = 3 o 16
    const entregados = finalizados.filter(p => [3,16].includes(Number(p.sub_estado_nro))).length;
    const totalFinalizados = finalizados.length;
    const porcentajeEntregados = totalFinalizados > 0
      ? Math.round(entregados / totalFinalizados * 100)
      : 0;
    
    return {
      sinAsignar: sinAsignar.length,
      entregados,
      porcentajeEntregados,
    };
  }, [pedidos, selectedMoviles]);

  // ============= MÓVILES SIN REPORTAR GPS =============
  // Excluir estadoNro 3 ("No Activo") — esos están fuera de servicio, no es un problema de GPS
  // Esto coincide con el filtro 'actividad: activo' del sidebar (default)
  const movilesSinReportar = useMemo(() => {
    return moviles.filter(m => {
      if (!m.isInactive) return false;
      // estadoNro 3 = No Activo (excluido del conteo, igual que el sidebar)
      const estadoNro = m.estadoNro;
      const esActivo = estadoNro === undefined || estadoNro === null || [0, 1, 2].includes(estadoNro);
      return esActivo;
    }).length;
  }, [moviles]);

  // ============= DATOS DE ZONAS (fetch independiente para indicadores) =============
  const [zonasAllData, setZonasAllData] = useState<any[]>([]);
  const [movilesZonasRecords, setMovilesZonasRecords] = useState<any[]>([]);
  const [demorasRecords, setDemorasRecords] = useState<any[]>([]);

  useEffect(() => {
    if (escenarioIds.length === 0) {
      setZonasAllData([]);
      setMovilesZonasRecords([]);
      setDemorasRecords([]);
      return;
    }

    const loadZonasData = async () => {
      try {
        // Fetch zonas, moviles-zonas y demoras en paralelo
        const [zonasRes, mzRes, demorasRes] = await Promise.all([
          fetch('/api/zonas'),
          fetch('/api/moviles-zonas'),
          fetch('/api/demoras'),
        ]);
        const [zonasResult, mzResult, demorasResult] = await Promise.all([
          zonasRes.json(),
          mzRes.json(),
          demorasRes.json(),
        ]);

        if (zonasResult.success) {
          // Filtrar por escenarios seleccionados Y con geojson (igual que useMapDataView)
          setZonasAllData(zonasResult.data.filter((z: any) => escenarioIds.includes(z.escenario_id) && z.geojson));
        }
        if (mzResult.success) {
          setMovilesZonasRecords(mzResult.data || []);
        }
        if (demorasResult.success) {
          setDemorasRecords(demorasResult.data.filter((d: any) => escenarioIds.includes(d.escenario_id)) || []);
        }
      } catch (err) {
        console.error('❌ Error loading zonas data for indicators:', err);
      }
    };

    loadZonasData();
    // Refrescar cada 60 segundos
    const interval = setInterval(loadZonasData, 60000);
    return () => clearInterval(interval);
  }, [escenarioIds]);

  // Zonas sin móviles: Match MovilesZonasLayer — filtrar por URGENTE + excluir estados 3/5/15
  const zonasSinMoviles = useMemo(() => {
    if (zonasAllData.length === 0) return 0;
    // Filtrar por tipo de servicio URGENTE (default del mapa)
    let filtered = movilesZonasRecords.filter((mz: any) => (mz.tipo_de_servicio || '').toUpperCase() === 'URGENTE');
    // Excluir móviles con estados inactivos (3, 5, 15) — mismo filtro que MovilesZonasLayer
    if (allMovilEstados && allMovilEstados.size > 0) {
      filtered = filtered.filter((mz: any) => {
        const estado = allMovilEstados.get(String(mz.movil_id));
        return estado === undefined || !EXCLUDED_ESTADOS.has(estado);
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
    // Zonas donde prioridad + tránsito = 0 después de filtrar ("0/0" en el mapa)
    return zonasAllData.filter((z: any) => {
      const counts = zonaCounts.get(z.zona_id);
      return !counts || (counts.prioridad === 0 && counts.transito === 0);
    }).length;
  }, [zonasAllData, movilesZonasRecords, allMovilEstados]);

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
        />

        {/* Zonas No Activas */}
        <Indicator
          icon="🔴"
          label="Zonas No Activas"
          value={zonasNoActivas}
          color={zonasNoActivas > 0 ? 'red' : 'gray'}
        />

        {/* Móviles sin Reportar */}
        <Indicator
          icon="📡"
          label="Móviles sin Reportar"
          value={movilesSinReportar}
          color={movilesSinReportar > 0 ? 'red' : 'gray'}
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
        backdrop-blur-sm rounded-md px-1.5 py-0.5 lg:px-2 lg:py-1 border
        ${colorClasses[color]}
        ${pulse ? 'animate-pulse' : ''}
        hover:scale-105 transition-transform ${onClick ? 'cursor-pointer' : 'cursor-default'}
        whitespace-nowrap
        h-[32px] lg:h-[38px] flex items-center
      `}
    >
      <div className="flex items-center gap-1 lg:gap-1.5">
        <span className="text-[10px] lg:text-xs">{icon}</span>
        <div className="flex flex-col leading-none justify-center">
          <div className="flex items-baseline gap-1">
            <span className="text-[8px] lg:text-[9px] font-medium opacity-75 hidden sm:inline">{label}</span>
            <span className="text-[10px] lg:text-xs font-bold">{value}</span>
          </div>
          {subtitle && (
            <span className="text-[8px] opacity-60 mt-0.5">{subtitle}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
