'use client';

import type { Ventana, Dimension, RangoDisponible, PeriodoSel, TipoServicioDashboard } from '@/types/metricas-dashboard';
import { TIPOS_SERVICIO } from '@/types/metricas-dashboard';
import { COLOR_TIPO, TIPO_LABEL } from './metricas-theme';
import { PeriodPicker, type PeriodValue } from './PeriodPicker';

const VENTANA_OPTIONS: { value: Ventana; label: string }[] = [
  { value: 'diario', label: 'Diario' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensual', label: 'Mensual' },
];

const DIMENSION_OPTIONS: { value: Dimension; label: string }[] = [
  { value: 'chofer', label: 'Chofer' },
  { value: 'movil', label: 'Móvil' },
  { value: 'zona', label: 'Zona' },
];

function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex items-center gap-0.5 rounded-[9px] border border-stats-border bg-stats-surface-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[0.8rem] font-semibold transition-colors ${
              active
                ? 'bg-stats-surface text-stats-primary shadow-sm dark:bg-stats-primary/15'
                : 'text-stats-muted-fg hover:text-stats-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface EmpresaOption {
  empresa_fletera_id: number;
  nombre: string;
}

export function FiltersBar({
  empresas,
  empresaSel,
  onEmpresaChange,
  tiposSel,
  onToggleTipo,
  ventana,
  onVentanaChange,
  dimension,
  onDimensionChange,
  rango,
  periodoSel,
  periodValue,
  onPeriodChange,
}: {
  empresas: EmpresaOption[];
  empresaSel: number | null;
  onEmpresaChange: (id: number | null) => void;
  tiposSel: Set<TipoServicioDashboard>;
  onToggleTipo: (tipo: TipoServicioDashboard) => void;
  ventana: Ventana;
  onVentanaChange: (v: Ventana) => void;
  dimension: Dimension;
  onDimensionChange: (d: Dimension) => void;
  rango: RangoDisponible | null;
  periodoSel: PeriodoSel;
  periodValue: PeriodValue | null;
  onPeriodChange: (p: PeriodValue) => void;
}) {
  return (
    <div className="stats-section-enter mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-stats-border bg-stats-surface p-3 shadow-sm">
      {empresas.length > 0 && (
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Empresa fletera</span>
          <select
            value={empresaSel ?? ''}
            onChange={(e) => onEmpresaChange(e.target.value === '' ? null : Number(e.target.value))}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            <option value="">Todas las empresas</option>
            {empresas.map((e) => (
              <option key={e.empresa_fletera_id} value={e.empresa_fletera_id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo de servicio</span>
        <div className="flex flex-wrap gap-1.5">
          {TIPOS_SERVICIO.map((t) => {
            const active = tiposSel.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleTipo(t)}
                className={`inline-flex select-none items-center gap-1.5 rounded-full border border-stats-border bg-stats-surface-2 px-2.5 py-1 text-[0.78rem] font-semibold text-stats-foreground transition-opacity hover:border-stats-border ${
                  active ? 'opacity-100' : 'opacity-40'
                }`}
              >
                <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: COLOR_TIPO[t] }} aria-hidden="true" />
                {TIPO_LABEL[t]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Ventana</span>
        <Seg options={VENTANA_OPTIONS} value={ventana} onChange={onVentanaChange} ariaLabel="Ventana de agrupación" />
      </div>

      <PeriodPicker ventana={ventana} rango={rango} value={periodValue} periodoSel={periodoSel} onChange={onPeriodChange} />

      <div className="flex-1" />

      <div className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Dimensión</span>
        <Seg options={DIMENSION_OPTIONS} value={dimension} onChange={onDimensionChange} ariaLabel="Dimensión del ranking y la tabla" />
      </div>
    </div>
  );
}
