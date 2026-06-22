'use client';

import React from 'react';
import { PedidoSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';
import { getEstadoDescripcion, isPedidoEntregado } from '@/utils/estadoPedido';
import { fixEncoding } from '@/utils/fixEncoding';

interface PedidoCardMobileProps {
  pedido: PedidoSupabase;
  delayInfo: DelayInfo;
  isFinalizados: boolean;
  onClick?: (id: number) => void;
  onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
  formatCurrency: (v: number | null) => string;
}

function borderColor(p: PedidoSupabase, isFinalizados: boolean, info: DelayInfo): string {
  if (isFinalizados) return isPedidoEntregado(p) ? 'border-l-green-500' : 'border-l-red-500';
  if (!p.movil || Number(p.movil) === 0) return 'border-l-blue-500';
  switch (info.label) {
    case 'Muy Atrasado': return 'border-l-red-500';
    case 'Atrasado': return 'border-l-pink-500';
    case 'Hora Límite Cercana': return 'border-l-yellow-500';
    case 'En Hora': return 'border-l-green-500';
    default: return 'border-l-gray-500';
  }
}

function badgeStyle(info: DelayInfo): string {
  switch (info.label) {
    case 'Muy Atrasado': return 'bg-red-500/25 text-red-300';
    case 'Atrasado': return 'bg-pink-500/25 text-pink-300';
    case 'Hora Límite Cercana': return 'bg-yellow-500/25 text-yellow-300';
    case 'En Hora': return 'bg-green-500/25 text-green-300';
    default: return 'bg-gray-500/25 text-gray-400';
  }
}

export default function PedidoCardMobile({
  pedido: p, delayInfo, isFinalizados, onClick, onMovilClick,
  getMovilName, getMovilColor, formatTime, formatCurrency,
}: PedidoCardMobileProps) {
  const esEntregado = isFinalizados && isPedidoEntregado(p);
  const sinMovil = !p.movil || Number(p.movil) === 0;
  const isPendiente = Number(p.estado_nro) === 1;
  const estadoText = (isPendiente && sinMovil)
    ? 'Sin Asignar'
    : getEstadoDescripcion(p.sub_estado_nro, p.sub_estado_desc, p.estado_nro);
  const estadoColor = esEntregado
    ? 'bg-green-500/20 text-green-300'
    : (isPendiente && sinMovil) ? 'bg-blue-500/20 text-blue-300'
    : (!isPendiente && !esEntregado) ? 'bg-orange-500/20 text-orange-300'
    : 'bg-blue-500/20 text-blue-300';

  const atrasoMins = isFinalizados && p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
  const atrasoLabel = atrasoMins == null ? null : atrasoMins === 0 ? `0'` : atrasoMins < 0 ? `${Math.abs(atrasoMins)}' antes` : `${atrasoMins}'`;
  const atrasoColor = atrasoMins == null ? 'text-gray-500' : atrasoMins <= 0 ? 'text-green-400' : atrasoMins < 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div
      onClick={() => onClick?.(p.id)}
      className={`border-l-4 ${borderColor(p, isFinalizados, delayInfo)} bg-gray-800/60 active:bg-gray-700/70 rounded-r-lg px-3 py-2.5 text-sm cursor-pointer`}
    >
      {/* Top row: badge + #id + hora */}
      <div className="flex items-center justify-between gap-2">
        {isFinalizados ? (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${esEntregado ? 'bg-green-500/25 text-green-300' : 'bg-red-500/25 text-red-300'}`}>
            {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
          </span>
        ) : (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeStyle(delayInfo)}`}>⏱ {delayInfo.badgeText}</span>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white">#{p.id}</span>
          <span className="text-gray-400 font-mono">{formatTime(p.fch_hora_max_ent_comp)}</span>
        </div>
      </div>

      {/* Cliente */}
      <div className="mt-1.5 text-gray-100 font-semibold text-[13px]">{p.cliente_tel || '—'}</div>
      {p.cliente_nombre && <div className="text-[11px] text-gray-400">{fixEncoding(p.cliente_nombre)}</div>}

      {/* Dirección */}
      <div className="mt-1 text-gray-300 text-xs flex items-start gap-1">
        <span className="text-gray-500 mt-0.5">📍</span>
        <span>{fixEncoding(p.cliente_direccion) || '—'}{p.cliente_ciudad ? `, ${p.cliente_ciudad}` : ''}</span>
      </div>

      {/* Footer chips */}
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
        <button
          onClick={(e) => { e.stopPropagation(); if (p.movil) onMovilClick?.(Number(p.movil)); }}
          className="inline-flex items-center gap-1 text-gray-200 underline decoration-dotted"
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getMovilColor(p.movil) }} />
          {getMovilName(p.movil)}
        </button>
        {p.zona_nro ? <span className="text-gray-400">Z{p.zona_nro}</span> : null}
        {(p.producto_nom || p.producto_cod) && (
          <span className="text-gray-400">{(p.producto_nom || p.producto_cod)}{p.producto_cant ? ` x${p.producto_cant}` : ''}</span>
        )}
        {p.servicio_nombre && <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">{p.servicio_nombre}</span>}
      </div>

      {/* Estado + importe + (finalizados) cumplido/atraso */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${estadoColor}`}>{estadoText}</span>
        <div className="flex items-center gap-2 text-xs">
          {isFinalizados && (
            <span className="text-gray-400 font-mono">{p.fch_hora_finalizacion ? formatTime(p.fch_hora_finalizacion) : '—'}</span>
          )}
          {atrasoLabel && <span className={`font-bold ${atrasoColor}`}>{atrasoLabel}</span>}
          <span className="text-gray-300">{formatCurrency(p.imp_bruto)}</span>
        </div>
      </div>

      {(p.pedido_obs || p.cliente_obs) && (
        <div className="mt-1 text-[10px] text-gray-500 truncate">{p.pedido_obs || p.cliente_obs}</div>
      )}
    </div>
  );
}
