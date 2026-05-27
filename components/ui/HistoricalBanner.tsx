'use client';

import React from 'react';

interface HistoricalBannerProps {
  date: string; // YYYY-MM-DD
}

/**
 * Banner persistente que aparece cuando el dashboard está viendo una fecha
 * anterior a hoy (modo histórico). Indica al usuario que Realtime está
 * pausado y que está viendo datos de un día pasado.
 *
 * Diseño: borde y fondo ámbar, ícono de calendario, sticky debajo del navbar.
 */
export default function HistoricalBanner({ date }: HistoricalBannerProps) {
  // Formatear fecha a DD/MM/YYYY para mostrar al usuario
  const [year, month, day] = date.split('-');
  const formattedDate = `${day}/${month}/${year}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center justify-center gap-2 z-40 flex-shrink-0"
      style={{ minHeight: '36px' }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 text-amber-600 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span className="text-sm font-medium text-amber-800">
        Modo hist&#243;rico &mdash; viendo {formattedDate}
      </span>
      <span className="text-amber-500 text-sm select-none" aria-hidden="true">·</span>
      <span className="text-sm text-amber-700">Realtime pausado</span>
    </div>
  );
}
