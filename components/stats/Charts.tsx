'use client';

// ─── Charts extraídos de app/dashboard/stats/page.tsx ────────────────────────
// Mantener en sync con los originales si se modifica la lógica de visualización.

export interface StackRow {
  label: string;
  entregados: number;
  noEntregados: number;
  pendientes: number;
}

export function BarChart({
  data,
  colorClass = 'bg-stats-info',
}: {
  data: { label: string; value: number; pct: number }[];
  colorClass?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const summary =
    data.length === 0
      ? 'Sin datos'
      : `${data.length} categorias, total ${total}. ${data
          .map((d) => `${d.label}: ${d.value}`)
          .slice(0, 5)
          .join('; ')}${data.length > 5 ? '; …' : ''}.`;
  return (
    <div className="space-y-2" role="img" aria-label={summary}>
      {data.map((item, i) => {
        const pctOfTotal = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <div
            key={item.label}
            className="group stats-row-enter rounded -mx-1 px-1 py-0.5 transition-colors hover:bg-stats-surface-2 dark:hover:bg-white/5"
            style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
            title={`${item.label}: ${item.value} (${pctOfTotal}%)`}
          >
            <div className="flex justify-between items-baseline gap-2 text-xs mb-0.5 text-stats-muted-fg dark:text-gray-400">
              <span className="truncate max-w-[55%]">{item.label}</span>
              <span className="font-semibold tabular-nums font-stats-mono text-stats-foreground dark:text-white flex items-baseline gap-1">
                <span className="text-right min-w-[3ch]">{item.value}</span>
                <span className="text-stats-muted-fg/70 dark:text-gray-500 font-normal text-right min-w-[3.5ch]">
                  · {pctOfTotal}%
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-stats-surface-2 dark:bg-white/10">
              <div
                className={`h-full ${colorClass} rounded-full transition-all duration-700 group-hover:brightness-110`}
                style={{ width: `${Math.max(item.pct, item.value > 0 ? 6 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StackedBarChart({
  data,
  expanded = false,
}: {
  data: StackRow[];
  expanded?: boolean;
}) {
  const maxTotal = Math.max(
    ...data.map((r) => r.entregados + r.noEntregados + r.pendientes),
    1,
  );
  const barH = expanded ? 'h-7' : 'h-5';
  const spacing = expanded ? 'space-y-5' : 'space-y-2.5';
  return (
    <div
      className={spacing}
      role="img"
      aria-label={`Distribucion entregados/no entregados/pendientes en ${data.length} filas, total ${data.reduce((s, r) => s + r.entregados + r.noEntregados + r.pendientes, 0)}.`}
    >
      {/* Leyenda */}
      <div className="flex gap-3 text-[10px] mb-1 text-stats-muted-fg dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-stats-success inline-block" />
          Entregados
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-stats-warning inline-block" />
          No entregados
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-stats-info inline-block" />
          Pendientes
        </span>
      </div>
      {data.map((row, i) => {
        const total = row.entregados + row.noEntregados + row.pendientes;
        const barWidth = Math.round((total / maxTotal) * 100);
        const pEnt = total > 0 ? Math.round((row.entregados / total) * 100) : 0;
        const pNoEnt = total > 0 ? Math.round((row.noEntregados / total) * 100) : 0;
        const pPend = total > 0 ? 100 - pEnt - pNoEnt : 0;
        return (
          <div
            key={row.label}
            className="group stats-row-enter rounded -mx-1 px-1 py-0.5 transition-colors hover:bg-stats-surface-2 dark:hover:bg-white/5"
            style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
            title={`${row.label}: total ${total} · entregados ${row.entregados} (${pEnt}%) · no entregados ${row.noEntregados} (${pNoEnt}%) · pendientes ${row.pendientes} (${pPend}%)`}
          >
            <div
              className={`flex justify-between items-baseline gap-2 ${expanded ? 'text-sm' : 'text-xs'} mb-0.5 text-stats-foreground/80 dark:text-gray-300`}
            >
              <span className="truncate max-w-[70%] font-medium">{row.label}</span>
              <span className="font-bold tabular-nums font-stats-mono text-right min-w-[3ch] text-stats-foreground dark:text-white">
                {total}
              </span>
            </div>
            <div className={`${barH} rounded-full overflow-hidden bg-stats-surface-2 dark:bg-white/10`}>
              <div
                className="h-full flex rounded-full overflow-hidden"
                style={{ width: `${Math.max(barWidth, total > 0 ? 6 : 0)}%` }}
              >
                {row.entregados > 0 && (
                  <div
                    className="h-full bg-stats-success flex items-center justify-center overflow-hidden"
                    style={{ width: `${pEnt}%` }}
                  >
                    {(expanded || pEnt >= 15) && (
                      <span
                        className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-white leading-none [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]`}
                      >
                        {pEnt}%
                      </span>
                    )}
                  </div>
                )}
                {row.noEntregados > 0 && (
                  <div
                    className="h-full bg-stats-warning flex items-center justify-center overflow-hidden"
                    style={{ width: `${pNoEnt}%` }}
                  >
                    {(expanded || pNoEnt >= 15) && (
                      <span
                        className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-white leading-none [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]`}
                      >
                        {pNoEnt}%
                      </span>
                    )}
                  </div>
                )}
                {row.pendientes > 0 && (
                  <div
                    className="h-full bg-stats-info flex items-center justify-center overflow-hidden"
                    style={{ width: `${pPend}%` }}
                  >
                    {(expanded || pPend >= 15) && (
                      <span
                        className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-white leading-none [text-shadow:_0_1px_1px_rgba(0,0,0,0.35)]`}
                      >
                        {pPend}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            {expanded && total > 0 && (
              <div className="flex gap-4 mt-1.5">
                {pEnt > 0 && (
                  <span className="text-[10px] text-stats-success font-semibold">{pEnt}% ent.</span>
                )}
                {pNoEnt > 0 && (
                  <span className="text-[10px] text-stats-warning font-semibold">{pNoEnt}% no ent.</span>
                )}
                {pPend > 0 && (
                  <span className="text-[10px] text-stats-info font-semibold">{pPend}% pend.</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
