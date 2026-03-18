'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { PedidoSupabase } from '@/types';
import { motion } from 'framer-motion';

interface DashboardIndicatorsProps {
  moviles: any[];
  pedidos: PedidoSupabase[];
  services: any[];
  selectedDate: string;
  selectedMoviles?: number[];
  onSinAsignarClick?: () => void;
  onEntregadosClick?: () => void;
  onPorcentajeClick?: () => void;
}

export default function DashboardIndicators({ moviles, pedidos, services, selectedDate, selectedMoviles = [], onSinAsignarClick, onEntregadosClick, onPorcentajeClick }: DashboardIndicatorsProps) {
  
  // ============= CÁLCULOS DE PEDIDOS =============
  const pedidosStats = useMemo(() => {
    // Sin asignar: sin móvil o móvil === 0
    let sinAsignar = pedidos.filter(p => !p.movil || Number(p.movil) === 0);
    
    // Finalizados: estado_nro === 2
    let finalizados = pedidos.filter(p => Number(p.estado_nro) === 2);
    
    // Filtrar por móviles seleccionados
    if (selectedMoviles.length > 0) {
      finalizados = finalizados.filter(p => p.movil && selectedMoviles.some(id => Number(id) === Number(p.movil)));
    }
    
    // Entregados: finalizados con sub_estado_desc === '3' o '16'
    const entregados = finalizados.filter(p => ['3','16'].includes(String(p.sub_estado_desc))).length;
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
