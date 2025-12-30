'use client';

import { useMemo } from 'react';
import { MovilData, PedidoSupabase } from '@/types';
import { motion } from 'framer-motion';

interface DashboardIndicatorsProps {
  moviles: MovilData[];
  pedidos: PedidoSupabase[];
  selectedDate: string;
}

export default function DashboardIndicators({ moviles, pedidos, selectedDate }: DashboardIndicatorsProps) {
  // ============= CÁLCULOS DE MÓVILES =============
  const movilesStats = useMemo(() => {
    const activos = moviles.filter(m => !m.isInactive).length;
    const sinReportar = moviles.filter(m => m.isInactive).length;
    
    // Móviles con pedidos atrasados
    const conPedidosAtrasados = moviles.filter(m => {
      // Revisar si tiene pedidos pendientes y si alguno está atrasado
      const pedidosMovil = pedidos.filter(p => p.movil === m.id);
      return pedidosMovil.some(p => {
        if (!p.fch_para || (p.estado_nro !== 1 && p.estado_nro !== 2)) return false;
        const fechaPara = new Date(p.fch_para);
        const ahora = new Date();
        const diffMins = (ahora.getTime() - fechaPara.getTime()) / (1000 * 60);
        return diffMins > 30; // Más de 30 mins atrasado
      });
    }).length;
    
    // Móviles ociosos (sin pedidos asignados)
    const ociosos = moviles.filter(m => {
      const pedidosMovil = pedidos.filter(p => p.movil === m.id);
      return pedidosMovil.length === 0;
    }).length;
    
    // Capacidad máxima de entrega (tamaño de lote)
    const capacidadMax = moviles.reduce((sum, m) => sum + (m.tamanoLote || 10), 0);
    
    // Capacidad ocupada (pedidos activos asignados)
    const capacidadOcupada = moviles.reduce((sum, m) => {
      const pedidosMovil = pedidos.filter(p => p.movil === m.id && (p.estado_nro === 1 || p.estado_nro === 2));
      return sum + pedidosMovil.length;
    }, 0);
    
    const porcentajeCapacidad = capacidadMax > 0 ? (capacidadOcupada / capacidadMax * 100).toFixed(0) : '0';
    
    return {
      activos,
      sinReportar,
      conPedidosAtrasados,
      ociosos,
      capacidadMax,
      capacidadOcupada,
      porcentajeCapacidad,
    };
  }, [moviles, pedidos]);

  // ============= CÁLCULOS DE PEDIDOS =============
  const pedidosStats = useMemo(() => {
    // Filtrar por estados (ajusta según tu esquema)
    const pendientes = pedidos.filter(p => 
      p.estado_nro === 1 || p.estado_nro === 2 // Estados pendientes
    ).length;
    
    const entregados = pedidos.filter(p => 
      p.estado_nro === 4 || p.sub_estado_desc?.toLowerCase().includes('entregado')
    ).length;
    
    const noEntregados = pedidos.filter(p => 
      p.estado_nro === 5 || p.sub_estado_desc?.toLowerCase().includes('cancelado')
    ).length;
    
    const total = pedidos.length;
    const porcentajeEntregados = total > 0 ? (entregados / total * 100).toFixed(0) : '0';
    
    // Pedidos atrasados (ejemplo: más de X horas desde fch_para)
    const ahora = new Date();
    const atrasados = pedidos.filter(p => {
      if (!p.fch_para) return false;
      const fechaPara = new Date(p.fch_para);
      const diffMins = (ahora.getTime() - fechaPara.getTime()) / (1000 * 60);
      return diffMins > 30 && (p.estado_nro === 1 || p.estado_nro === 2); // Más de 30 mins atrasado
    });
    
    const cantAtrasados = atrasados.length;
    const porcentajeAtrasados = pendientes > 0 ? (cantAtrasados / pendientes * 100).toFixed(0) : '0';
    
    // Pedido más atrasado en minutos
    const masAtrasadoMins = atrasados.length > 0
      ? Math.max(...atrasados.map(p => {
          const fechaPara = new Date(p.fch_para!);
          return (ahora.getTime() - fechaPara.getTime()) / (1000 * 60);
        })).toFixed(0)
      : '0';
    
    return {
      pendientes,
      entregados,
      noEntregados,
      cantAtrasados,
      porcentajeAtrasados,
      masAtrasadoMins,
      porcentajeEntregados,
    };
  }, [pedidos]);

  // ============= CÁLCULOS DE SERVICES =============
  const servicesStats = useMemo(() => {
    // Filtrar services (tipo = 'SERVICE' o similar)
    const services = pedidos.filter(p => p.tipo?.toUpperCase() === 'SERVICE');
    
    const pendientes = services.filter(s => 
      s.estado_nro === 1 || s.estado_nro === 2
    ).length;
    
    const realizados = services.filter(s => 
      s.estado_nro === 4 || s.sub_estado_desc?.toLowerCase().includes('realizado')
    ).length;
    
    const noRealizados = services.filter(s => 
      s.estado_nro === 5 || s.sub_estado_desc?.toLowerCase().includes('cancelado')
    ).length;
    
    const total = services.length;
    const porcentajeRealizados = total > 0 ? (realizados / total * 100).toFixed(0) : '0';
    
    // Services atrasados
    const ahora = new Date();
    const atrasados = services.filter(s => {
      if (!s.fch_para) return false;
      const fechaPara = new Date(s.fch_para);
      const diffMins = (ahora.getTime() - fechaPara.getTime()) / (1000 * 60);
      return diffMins > 30 && (s.estado_nro === 1 || s.estado_nro === 2);
    });
    
    const cantAtrasados = atrasados.length;
    const porcentajeAtrasados = pendientes > 0 ? (cantAtrasados / pendientes * 100).toFixed(0) : '0';
    
    // Service más atrasado en minutos
    const masAtrasadoMins = atrasados.length > 0
      ? Math.max(...atrasados.map(s => {
          const fechaPara = new Date(s.fch_para!);
          return (ahora.getTime() - fechaPara.getTime()) / (1000 * 60);
        })).toFixed(0)
      : '0';
    
    return {
      pendientes,
      realizados,
      noRealizados,
      cantAtrasados,
      porcentajeAtrasados,
      masAtrasadoMins,
      porcentajeRealizados,
    };
  }, [pedidos]);

  return (
    <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
      {/* ========== ALERTAS CRÍTICAS ========== */}
      <div className="flex items-center gap-1.5">
        {/* Pedidos Atrasados */}
        {pedidosStats.cantAtrasados > 0 && (
          <Indicator
            icon="⏰"
            label="Pedidos Atrasados"
            value={pedidosStats.cantAtrasados}
            subtitle={`${pedidosStats.porcentajeAtrasados}%`}
            color="red"
            pulse
          />
        )}
        
        {/* Pedido Más Atrasado */}
        {parseInt(pedidosStats.masAtrasadoMins) > 0 && (
          <Indicator
            icon="🔴"
            label="Más Atrasado"
            value={`${pedidosStats.masAtrasadoMins} min`}
            color="red"
          />
        )}
        
        {/* Services Atrasados */}
        {servicesStats.cantAtrasados > 0 && (
          <Indicator
            icon="⏱️"
            label="Services Atrasados"
            value={servicesStats.cantAtrasados}
            subtitle={`${servicesStats.porcentajeAtrasados}%`}
            color="red"
            pulse
          />
        )}
        
        {/* Service Más Atrasado */}
        {parseInt(servicesStats.masAtrasadoMins) > 0 && (
          <Indicator
            icon="�"
            label="Service + Atrasado"
            value={`${servicesStats.masAtrasadoMins} min`}
            color="red"
          />
        )}
        
        {/* Móviles con Pedidos Atrasados */}
        {movilesStats.conPedidosAtrasados > 0 && (
          <Indicator
            icon="�"
            label="Móviles con Atrasos"
            value={movilesStats.conPedidosAtrasados}
            color="red"
          />
        )}
      </div>

      {/* Separador */}
      {(pedidosStats.cantAtrasados > 0 || servicesStats.cantAtrasados > 0 || movilesStats.conPedidosAtrasados > 0) && (
        <div className="h-6 w-px bg-white/30" />
      )}

      {/* ========== OPERACIONES ACTIVAS ========== */}
      <div className="flex items-center gap-1.5">
        {/* Pedidos Pendientes */}
        <Indicator
          icon="📦"
          label="Pedidos Pendientes"
          value={pedidosStats.pendientes}
          color="blue"
        />
        
        {/* Services Pendientes */}
        <Indicator
          icon="🔧"
          label="Services Pendientes"
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
          label="Móviles Activos"
          value={movilesStats.activos}
          color="green"
        />
        
        {/* Móviles sin Reportar */}
        {movilesStats.sinReportar > 0 && (
          <Indicator
            icon="⚠️"
            label="Sin Reportar"
            value={movilesStats.sinReportar}
            color="orange"
          />
        )}
        
        {/* Móviles Ociosos */}
        <Indicator
          icon="💤"
          label="Ociosos"
          value={movilesStats.ociosos}
          color="gray"
        />
        
        {/* Capacidad */}
        <Indicator
          icon="📊"
          label="Capacidad"
          value={`${movilesStats.capacidadOcupada}/${movilesStats.capacidadMax}`}
          subtitle={`${movilesStats.porcentajeCapacidad}%`}
          color={parseInt(movilesStats.porcentajeCapacidad) > 80 ? 'red' : 'blue'}
        />
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
          subtitle={`${pedidosStats.porcentajeEntregados}%`}
          color="green"
        />
        
        {/* Pedidos NO Entregados */}
        {pedidosStats.noEntregados > 0 && (
          <Indicator
            icon="❌"
            label="NO Entregados"
            value={pedidosStats.noEntregados}
            color="red"
          />
        )}
        
        {/* Services Realizados */}
        <Indicator
          icon="✔️"
          label="Services OK"
          value={servicesStats.realizados}
          subtitle={`${servicesStats.porcentajeRealizados}%`}
          color="green"
        />
        
        {/* Services NO Realizados */}
        {servicesStats.noRealizados > 0 && (
          <Indicator
            icon="✖️"
            label="Services NO"
            value={servicesStats.noRealizados}
            color="red"
          />
        )}
      </div>
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
        backdrop-blur-sm rounded-md px-2 py-1 border
        ${colorClasses[color]}
        ${pulse ? 'animate-pulse' : ''}
        hover:scale-105 transition-transform cursor-default
        whitespace-nowrap
        h-[38px] flex items-center
      `}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs">{icon}</span>
        <div className="flex flex-col leading-none justify-center">
          <div className="flex items-baseline gap-1">
            <span className="text-[9px] font-medium opacity-75">{label}</span>
            <span className="text-xs font-bold">{value}</span>
          </div>
          {subtitle && (
            <span className="text-[8px] opacity-60 mt-0.5">{subtitle}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
