'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { MovilData, PedidoSupabase, ServiceSupabase } from '@/types';
import { computeDelayMinutes, getDelayInfo } from '@/utils/pedidoDelay';
import { motion } from 'framer-motion';

interface DashboardIndicatorsProps {
  moviles: MovilData[];
  pedidos: PedidoSupabase[];
  services: ServiceSupabase[];
  selectedDate: string;
}

export default function DashboardIndicators({ moviles, pedidos, services, selectedDate }: DashboardIndicatorsProps) {
  
  // ============= CÁLCULOS DE PEDIDOS =============
  const pedidosStats = useMemo(() => {
    const pendientes = pedidos.filter(p => Number(p.estado_nro) === 1 && String(p.sub_estado_desc) === '5');
    const entregados = pedidos.filter(p => Number(p.estado_nro) === 2);
    const total = pedidos.length;
    
    // Atrasados: pedidos pendientes con delay "Atrasado" o "Muy Atrasado"
    const atrasados = pendientes.filter(p => {
      const delayMins = computeDelayMinutes(p.fch_hora_max_ent_comp);
      const info = getDelayInfo(delayMins);
      return info.label === 'Atrasado' || info.label === 'Muy Atrasado';
    });
    
    const cantAtrasados = atrasados.length;
    const porcentajeAtrasados = pendientes.length > 0 
      ? Math.round(cantAtrasados / pendientes.length * 100) 
      : 0;
    
    // Pedido más atrasado en minutos (el más negativo de computeDelayMinutes)
    let masAtrasadoMins = 0;
    pendientes.forEach(p => {
      const delayMins = computeDelayMinutes(p.fch_hora_max_ent_comp);
      if (delayMins !== null && delayMins < 0) {
        const absMin = Math.abs(delayMins);
        if (absMin > masAtrasadoMins) masAtrasadoMins = absMin;
      }
    });
    
    return {
      pendientes: pendientes.length,
      entregados: entregados.length,
      cantAtrasados,
      porcentajeAtrasados,
      masAtrasadoMins: Math.round(masAtrasadoMins),
      total,
    };
  }, [pedidos]);

  // ============= CÁLCULOS DE SERVICES =============
  const servicesStats = useMemo(() => {
    const pendientes = services.filter(s => Number(s.estado_nro) === 1);
    const realizados = services.filter(s => Number(s.estado_nro) === 2);
    const total = services.length;
    
    // Atrasados: services pendientes con delay "Atrasado" o "Muy Atrasado"
    const atrasados = pendientes.filter(s => {
      const delayMins = computeDelayMinutes(s.fch_hora_max_ent_comp);
      const info = getDelayInfo(delayMins);
      return info.label === 'Atrasado' || info.label === 'Muy Atrasado';
    });
    
    const cantAtrasados = atrasados.length;
    const porcentajeAtrasados = pendientes.length > 0 
      ? Math.round(cantAtrasados / pendientes.length * 100) 
      : 0;
    
    // Service más atrasado en minutos
    let masAtrasadoMins = 0;
    pendientes.forEach(s => {
      const delayMins = computeDelayMinutes(s.fch_hora_max_ent_comp);
      if (delayMins !== null && delayMins < 0) {
        const absMin = Math.abs(delayMins);
        if (absMin > masAtrasadoMins) masAtrasadoMins = absMin;
      }
    });
    
    return {
      pendientes: pendientes.length,
      realizados: realizados.length,
      cantAtrasados,
      porcentajeAtrasados,
      masAtrasadoMins: Math.round(masAtrasadoMins),
      total,
    };
  }, [services]);

  // ============= CÁLCULOS DE MÓVILES =============
  const movilesStats = useMemo(() => {
    const total = moviles.length;
    
    // Sin coordenadas: móviles que no reportaron GPS (sin posición actual o inactivos)
    const sinCoordenadas = moviles.filter(m => !m.currentPosition || m.isInactive).length;
    const activos = total - sinCoordenadas;
    
    return {
      total,
      activos,
      sinCoordenadas,
    };
  }, [moviles]);

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
      {/* ========== ALERTAS CRÍTICAS ========== */}
      <div className="flex items-center gap-1.5">
        {/* Pedidos Atrasados */}
        {pedidosStats.cantAtrasados > 0 && (
          <Indicator
            icon="⏰"
            label="Ped. Atrasados"
            value={pedidosStats.cantAtrasados}
            subtitle={`${pedidosStats.porcentajeAtrasados}%`}
            color="red"
            pulse
          />
        )}
        
        {/* Pedido Más Atrasado */}
        {pedidosStats.masAtrasadoMins > 0 && (
          <Indicator
            icon="🔴"
            label="Ped. +Atrasado"
            value={`${pedidosStats.masAtrasadoMins} min`}
            color="red"
          />
        )}
        
        {/* Services Atrasados */}
        {servicesStats.cantAtrasados > 0 && (
          <Indicator
            icon="⏱️"
            label="Svc. Atrasados"
            value={servicesStats.cantAtrasados}
            subtitle={`${servicesStats.porcentajeAtrasados}%`}
            color="red"
            pulse
          />
        )}
        
        {/* Service Más Atrasado */}
        {servicesStats.masAtrasadoMins > 0 && (
          <Indicator
            icon="🔴"
            label="Svc. +Atrasado"
            value={`${servicesStats.masAtrasadoMins} min`}
            color="red"
          />
        )}
      </div>

      {/* Separador */}
      {(pedidosStats.cantAtrasados > 0 || servicesStats.cantAtrasados > 0) && (
        <div className="h-6 w-px bg-white/30" />
      )}

      {/* ========== OPERACIONES ACTIVAS ========== */}
      <div className="flex items-center gap-1.5">
        {/* Pedidos Pendientes */}
        <Indicator
          icon="📦"
          label="Ped. Pend."
          value={pedidosStats.pendientes}
          color="blue"
        />
        
        {/* Services Pendientes */}
        <Indicator
          icon="🔧"
          label="Svc. Pend."
          value={servicesStats.pendientes}
          color="purple"
        />
      </div>

      {/* Separador */}
      <div className="h-6 w-px bg-white/30" />

      {/* ========== RECURSOS (MÓVILES) ========== */}
      <div className="flex items-center gap-1.5">
        {/* Móviles Activos */}
        <Indicator
          icon="🚗"
          label="Móviles"
          value={movilesStats.activos}
          color="green"
        />
        
        {/* Móviles sin coordenadas */}
        {movilesStats.sinCoordenadas > 0 && (
          <Indicator
            icon="📡"
            label="Sin Coord."
            value={movilesStats.sinCoordenadas}
            color="orange"
          />
        )}
      </div>

      {/* Separador */}
      <div className="h-6 w-px bg-white/30" />

      {/* ========== RESULTADOS ========== */}
      <div className="flex items-center gap-1.5">
        {/* Pedidos Entregados */}
        <Indicator
          icon="✅"
          label="Entregados"
          value={pedidosStats.entregados}
          color="green"
        />
        
        {/* Services OK */}
        <Indicator
          icon="✔️"
          label="Services OK"
          value={servicesStats.realizados}
          color="green"
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
}

function Indicator({ icon, label, value, subtitle, color = 'blue', pulse = false }: IndicatorProps) {
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
      className={`
        backdrop-blur-sm rounded-md px-1.5 py-0.5 lg:px-2 lg:py-1 border
        ${colorClasses[color]}
        ${pulse ? 'animate-pulse' : ''}
        hover:scale-105 transition-transform cursor-default
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
