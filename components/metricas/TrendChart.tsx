'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { SeriePunto, Ventana } from '@/types/metricas-dashboard';
import { SERIE_COLOR, formatMin } from './metricas-theme';
import { usePrefersReducedMotion } from './useCountUp';

function formatPeriodo(periodo: string, ventana: Ventana): string {
  const d = new Date(`${periodo}T00:00:00`);
  if (Number.isNaN(d.getTime())) return periodo;
  if (ventana === 'mensual') return d.toLocaleDateString('es-UY', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' });
}

function TrendTooltip({
  active,
  payload,
  ventana,
}: TooltipContentProps & { ventana: Ventana }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as SeriePunto | undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-stats-border bg-stats-surface px-3 py-2 shadow-xl">
      <div className="mb-1 text-xs font-bold text-stats-foreground">{formatPeriodo(row.periodo, ventana)}</div>
      <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
        prom <span className="font-semibold text-stats-foreground">{formatMin(row.promedio)}</span> min
      </div>
      <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
        p90 <span className="font-semibold text-stats-foreground">{formatMin(row.p90)}</span> min
      </div>
      <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">{row.cantidad} cumplidos</div>
    </div>
  );
}

export function TrendChart({
  serie,
  ventana,
  height = 260,
}: {
  serie: SeriePunto[];
  ventana: Ventana;
  height?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();

  if (serie.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-stats-muted-fg">
        Sin datos de tendencia para el período/scope seleccionado.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-stats-border)" strokeOpacity={0.7} vertical={false} />
          <XAxis
            dataKey="periodo"
            tickFormatter={(v: string) => formatPeriodo(v, ventana)}
            tick={{ fill: 'var(--color-stats-muted-fg)', fontSize: 10 }}
            axisLine={{ stroke: 'var(--color-stats-border)' }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: 'var(--color-stats-muted-fg)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          <Tooltip content={(props) => <TrendTooltip {...props} ventana={ventana} />} cursor={{ stroke: 'var(--color-stats-border)' }} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: 'var(--color-stats-muted-fg)' }}
            formatter={(value) => <span style={{ color: 'var(--color-stats-muted-fg)' }}>{value}</span>}
          />
          {/* Banda p90: dibujada PRIMERO (queda debajo). El área de "promedio",
              dibujada después con más opacidad, ocluye la parte 0..promedio,
              dejando visible la banda tenue solo entre promedio y p90. */}
          <Area
            type="monotone"
            dataKey="p90"
            name="P90"
            stroke="none"
            fill={SERIE_COLOR}
            fillOpacity={0.1}
            legendType="none"
            isAnimationActive={!reducedMotion}
          />
          <Area
            type="monotone"
            dataKey="promedio"
            name="Promedio"
            stroke="none"
            fill={SERIE_COLOR}
            fillOpacity={0.22}
            legendType="none"
            isAnimationActive={!reducedMotion}
          />
          <Line
            type="monotone"
            dataKey="promedio"
            name="Promedio"
            stroke={SERIE_COLOR}
            strokeWidth={2.4}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={!reducedMotion}
          />
          <Line
            type="monotone"
            dataKey="p90"
            name="P90"
            stroke={SERIE_COLOR}
            strokeWidth={1.4}
            strokeDasharray="3 3"
            strokeOpacity={0.75}
            dot={false}
            isAnimationActive={!reducedMotion}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
