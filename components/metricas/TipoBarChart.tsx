'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
import type { TooltipContentProps, XAxisTickContentProps } from 'recharts';
import type { PorTipoRow, TipoServicioDashboard } from '@/types/metricas-dashboard';
import { COLOR_TIPO, TIPO_LABEL, formatMin, orderPorTipo } from './metricas-theme';
import { usePrefersReducedMotion } from './useCountUp';

function TipoTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as PorTipoRow | undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-stats-border bg-stats-surface px-3 py-2 shadow-xl">
      <div className="mb-1 text-xs font-bold text-stats-foreground">{TIPO_LABEL[row.tipo_servicio]}</div>
      <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
        {formatMin(row.promedio)} min prom. · {row.cantidad} cumplidos
      </div>
    </div>
  );
}

/** Tick de eje X con 2 líneas: tipo abreviado + cantidad de cumplidos debajo (como el mockup). */
function makeTipoAxisTick(byTipo: Map<TipoServicioDashboard, PorTipoRow>) {
  return function TipoAxisTick(props: XAxisTickContentProps) {
    const { x, y, payload } = props;
    const tipo = payload.value as TipoServicioDashboard;
    const row = byTipo.get(tipo);
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={12} textAnchor="middle" fontSize={9} fontFamily="var(--font-stats-mono)" fill="var(--color-stats-muted-fg)">
          {(TIPO_LABEL[tipo] ?? tipo).slice(0, 4).toUpperCase()}
        </text>
        <text dy={24} textAnchor="middle" fontSize={9} fontFamily="var(--font-stats-mono)" fill="var(--color-stats-muted-fg)">
          {row?.cantidad ?? 0}
        </text>
      </g>
    );
  };
}

export function TipoBarChart({ porTipo, height = 230 }: { porTipo: PorTipoRow[]; height?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const data = useMemo(() => orderPorTipo(porTipo), [porTipo]);
  const byTipo = useMemo(() => new Map(data.map((d) => [d.tipo_servicio, d])), [data]);
  const AxisTick = useMemo(() => makeTipoAxisTick(byTipo), [byTipo]);
  const totalCantidad = data.reduce((s, d) => s + d.cantidad, 0);

  if (totalCantidad === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-sm text-stats-muted-fg">
        Sin cumplidos por tipo de servicio en el período seleccionado.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-stats-border)" strokeOpacity={0.7} vertical={false} />
          <XAxis
            dataKey="tipo_servicio"
            tick={AxisTick}
            axisLine={{ stroke: 'var(--color-stats-border)' }}
            tickLine={false}
            interval={0}
            height={34}
          />
          <YAxis hide />
          <Tooltip content={TipoTooltip} cursor={{ fill: 'var(--color-stats-surface-2)' }} />
          <Bar dataKey="promedio" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} maxBarSize={56}>
            {data.map((d) => (
              <Cell key={d.tipo_servicio} fill={COLOR_TIPO[d.tipo_servicio]} />
            ))}
            <LabelList
              dataKey="promedio"
              position="top"
              formatter={(v: unknown) => (v == null ? '' : formatMin(v as number))}
              style={{ fill: 'var(--color-stats-foreground)', fontFamily: 'var(--font-stats-mono)', fontSize: 10, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
