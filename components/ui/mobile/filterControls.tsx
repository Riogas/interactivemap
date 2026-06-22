'use client';

import React from 'react';

/** Estilo de un botón segmentado (toggle) full-width usado en el header mobile. */
export function segClass(active: boolean): string {
  return `flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
    active ? 'bg-teal-500/30 text-teal-300' : 'text-gray-400'
  }`;
}

/** Grupo de filtro con label superior y children en wrap (chips o selects). */
export function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Chip toggle reutilizable (atraso, asignación, tipo, móvil…). */
export function Chip({
  active, disabled, onClick, children,
}: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={() => { if (!disabled) onClick(); }}
      className={`px-3 py-1.5 text-xs rounded-full border ${
        active ? 'bg-teal-500/20 border-teal-500/40 text-teal-300' : 'bg-gray-800 border-gray-600/50 text-gray-300'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {children}
    </button>
  );
}

/** Select de filtro (zona, producto, defecto…). */
export function FilterSelect({
  label, value, onChange, options, disabled,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</div>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 px-3 py-2 ${disabled ? 'opacity-50' : ''}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
