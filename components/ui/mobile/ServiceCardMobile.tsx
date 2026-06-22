'use client';

import React from 'react';
import { ServiceSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';
import { isServiceEntregado } from '@/utils/estadoPedido';
import { fixEncoding } from '@/utils/fixEncoding';

interface ServiceCardMobileProps {
  service: ServiceSupabase;
  delayInfo: DelayInfo;
  isFinalizados: boolean;
  onClick?: (id: number) => void;
  onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
}

function borderColor(s: ServiceSupabase, isFinalizados: boolean, info: DelayInfo): string {
  if (isFinalizados) return isServiceEntregado(s) ? 'border-l-green-500' : 'border-l-red-500';
  if (!s.movil || Number(s.movil) === 0) return 'border-l-blue-500';
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

export default function ServiceCardMobile({
  service: s, delayInfo, isFinalizados, onClick, onMovilClick,
  getMovilName, getMovilColor, formatTime,
}: ServiceCardMobileProps) {
  const esEntregado = isFinalizados && isServiceEntregado(s);

  return (
    <div
      onClick={() => onClick?.(s.id)}
      className={`border-l-4 ${borderColor(s, isFinalizados, delayInfo)} bg-gray-800/60 active:bg-gray-700/70 rounded-r-lg px-3 py-2.5 text-sm cursor-pointer`}
    >
      <div className="flex items-center justify-between gap-2">
        {isFinalizados ? (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${esEntregado ? 'bg-green-500/25 text-green-300' : 'bg-red-500/25 text-red-300'}`}>
            {esEntregado ? '✔ Entregado' : '✗ No Entregado'}
          </span>
        ) : (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeStyle(delayInfo)}`}>⏱ {delayInfo.badgeText}</span>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white">#{s.id}</span>
          <span className="text-gray-400 font-mono">{formatTime(s.fch_hora_max_ent_comp)}</span>
        </div>
      </div>

      <div className="mt-1.5 text-gray-100 font-semibold text-[13px]">{s.cliente_tel || '—'}</div>
      {s.cliente_nombre && <div className="text-[11px] text-gray-400">{fixEncoding(s.cliente_nombre)}</div>}

      <div className="mt-1 text-gray-300 text-xs flex items-start gap-1">
        <span className="text-gray-500 mt-0.5">📍</span>
        <span>{fixEncoding(s.cliente_direccion) || '—'}{s.cliente_ciudad ? `, ${s.cliente_ciudad}` : ''}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
        <button
          onClick={(e) => { e.stopPropagation(); if (s.movil) onMovilClick?.(Number(s.movil)); }}
          className="inline-flex items-center gap-1 text-gray-200 underline decoration-dotted"
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getMovilColor(s.movil) }} />
          {getMovilName(s.movil)}
        </button>
        {s.zona_nro ? <span className="text-gray-400">Z{s.zona_nro}</span> : null}
        {s.defecto && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{s.defecto}</span>}
      </div>

      {(s.pedido_obs || s.cliente_obs) && (
        <div className="mt-1 text-[10px] text-gray-500 truncate">{s.pedido_obs || s.cliente_obs}</div>
      )}
    </div>
  );
}
