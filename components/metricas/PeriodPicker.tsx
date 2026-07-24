'use client';

/**
 * E1 — selector de período adaptativo a la ventana (día/semana/mes), acotado
 * al rango de datos disponible (`rango.min_fecha..max_fecha`). Reemplaza el
 * 7d/30d/mes del mockup.
 *
 * `value === null` significa "auto" (la RPC resuelve el último período
 * disponible); en ese caso el control muestra `periodoSel` (el eco que
 * devolvió el servidor). Al interactuar, el picker computa SIEMPRE un par
 * {desde,hasta} completo (nunca uno solo) porque la RPC, si recibe solo uno
 * de los dos, ignora ambos y vuelve a auto-resolver — ver
 * docs/sqls/2026-07-24-metricas-dashboard-rpc.sql.
 */

import { useMemo } from 'react';
import type { Ventana, RangoDisponible, PeriodoSel } from '@/types/metricas-dashboard';

export interface PeriodValue {
  desde: string;
  hasta: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function addDays(s: string, n: number): string {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
/** Lunes de la semana ISO (date_trunc('week', ...) de Postgres también arranca en lunes). */
function mondayOf(s: string): string {
  const d = parseIso(s);
  const day = d.getDay(); // 0=domingo..6=sábado
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIso(d);
}
function firstOfMonth(s: string): string {
  const d = parseIso(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function lastOfMonth(s: string): string {
  const d = parseIso(s);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return toIso(last);
}
function addMonthsFirstOf(s: string, n: number): string {
  const d = parseIso(s);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function fmtDDMM(s: string): string {
  const d = parseIso(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtMonthYear(s: string): string {
  const d = parseIso(s);
  const label = d.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function PeriodPicker({
  ventana,
  rango,
  value,
  periodoSel,
  onChange,
}: {
  ventana: Ventana;
  rango: RangoDisponible | null;
  value: PeriodValue | null;
  periodoSel: PeriodoSel;
  onChange: (period: PeriodValue) => void;
}) {
  const effectiveDesde = value?.desde ?? periodoSel.desde ?? rango?.max_fecha ?? null;

  const weekOptions = useMemo(() => {
    if (!rango) return [];
    const opts: { value: string; label: string }[] = [];
    let cur = mondayOf(rango.min_fecha);
    let guard = 0;
    while (cur <= rango.max_fecha && guard < 500) {
      opts.push({ value: cur, label: `Semana ${fmtDDMM(cur)} – ${fmtDDMM(addDays(cur, 6))}` });
      cur = addDays(cur, 7);
      guard += 1;
    }
    return opts.reverse();
  }, [rango]);

  const monthOptions = useMemo(() => {
    if (!rango) return [];
    const opts: { value: string; label: string }[] = [];
    let cur = firstOfMonth(rango.min_fecha);
    const maxMonth = firstOfMonth(rango.max_fecha);
    let guard = 0;
    while (cur <= maxMonth && guard < 240) {
      opts.push({ value: cur, label: fmtMonthYear(cur) });
      cur = addMonthsFirstOf(cur, 1);
      guard += 1;
    }
    return opts.reverse();
  }, [rango]);

  if (!rango) {
    return (
      <div className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Período</span>
        <span className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-muted-fg">Sin datos</span>
      </div>
    );
  }

  if (ventana === 'diario') {
    return (
      <label className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Día</span>
        <input
          type="date"
          min={rango.min_fecha}
          max={rango.max_fecha}
          value={effectiveDesde ?? ''}
          onChange={(e) => {
            if (!e.target.value) return;
            onChange({ desde: e.target.value, hasta: e.target.value });
          }}
          className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
        />
      </label>
    );
  }

  if (ventana === 'semanal') {
    const currentWeek = effectiveDesde ? mondayOf(effectiveDesde) : weekOptions[0]?.value;
    return (
      <label className="flex flex-col gap-[0.3rem]">
        <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Semana</span>
        <select
          value={currentWeek}
          onChange={(e) => {
            const monday = e.target.value;
            onChange({ desde: monday, hasta: addDays(monday, 6) });
          }}
          className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
        >
          {weekOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // mensual
  const currentMonth = effectiveDesde ? firstOfMonth(effectiveDesde) : monthOptions[0]?.value;
  return (
    <label className="flex flex-col gap-[0.3rem]">
      <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Mes</span>
      <select
        value={currentMonth}
        onChange={(e) => {
          const first = e.target.value;
          onChange({ desde: first, hasta: lastOfMonth(first) });
        }}
        className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
      >
        {monthOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
