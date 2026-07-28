'use client';

/**
 * Comparativa cross-escenario: los mismos filtros (período, tipo de servicio,
 * empresa) aplicados a TODOS los escenarios con datos, uno al lado del otro.
 *
 * Cada fila viene calculada por separado sobre los hechos en la RPC
 * (percentiles exactos) — acá no se promedia ni se recompone nada.
 *
 * El escenario activo se resalta; clickear otra fila cambia de escenario, que
 * es la operación natural desde esta tabla.
 */

import type { ComparativaEscenarioRow } from '@/types/metricas-dashboard';
import { formatMin, formatCount, formatPct } from './metricas-theme';

const TH = 'border-b border-stats-border px-2.5 py-1.5 text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg';
const TD = 'border-b border-stats-border px-2.5 py-2 font-stats-mono tabular-nums text-stats-foreground';

export function EscenarioComparativa({
  comparativa,
  escenarioSel,
  onEscenarioChange,
}: {
  comparativa: ComparativaEscenarioRow[];
  escenarioSel: number | null;
  onEscenarioChange: (id: number) => void;
}) {
  if (comparativa.length === 0) {
    return <p className="py-6 text-center text-sm text-stats-muted-fg">Sin datos para comparar en este período.</p>;
  }

  // Un solo escenario: no hay comparación posible. Se dice explícitamente en
  // vez de mostrar una tabla de una fila que finge ser un ranking.
  if (comparativa.length === 1) {
    const only = comparativa[0];
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        <span className="font-semibold text-stats-foreground">{only.nombre}</span> es el único escenario con cumplidos en este
        período ({formatCount(only.cantidad)}). La comparativa aparece sola cuando haya más de uno.
      </p>
    );
  }

  // Escala de la barra: el peor promedio del período (mayor demora).
  const maxPromedio = Math.max(...comparativa.map((c) => c.promedio ?? 0), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${TH} text-left`}>Escenario</th>
            <th className={`${TH} text-left`}>Demora efectiva prom.</th>
            <th className={`${TH} text-right`}>Mediana</th>
            <th className={`${TH} text-right`}>P90</th>
            <th className={`${TH} text-right`}>Cumplidos</th>
            <th className={`${TH} text-right`}>Atraso</th>
            <th className={`${TH} text-right`}>A tiempo</th>
          </tr>
        </thead>
        <tbody>
          {comparativa.map((c) => {
            const activo = c.escenario === escenarioSel;
            const pct = Math.max(2, ((c.promedio ?? 0) / maxPromedio) * 100);
            return (
              <tr
                key={c.escenario}
                onClick={() => !activo && onEscenarioChange(c.escenario)}
                className={
                  activo
                    ? 'bg-stats-primary/10'
                    : 'cursor-pointer transition-colors hover:bg-stats-surface-2'
                }
                title={activo ? 'Escenario que estás viendo' : `Ver ${c.nombre}`}
              >
                <td className={`${TD} font-stats-sans font-semibold`}>
                  <span className="flex items-center gap-2">
                    {activo && (
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-stats-primary" aria-hidden="true" />
                    )}
                    <span className={activo ? '' : 'pl-[15px]'}>{c.nombre}</span>
                  </span>
                </td>
                <td className={`${TD} text-left`}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-[3.2rem] text-right">{formatMin(c.promedio)}</span>
                    <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-stats-surface-2">
                      <span
                        className="block h-full rounded-full bg-stats-primary"
                        style={{ width: `${pct}%`, opacity: activo ? 1 : 0.55 }}
                      />
                    </span>
                  </span>
                </td>
                <td className={`${TD} text-right`}>{formatMin(c.mediana)}</td>
                <td className={`${TD} text-right`}>{formatMin(c.p90)}</td>
                <td className={`${TD} text-right`}>{formatCount(c.cantidad)}</td>
                <td className={`${TD} text-right`}>{formatMin(c.promedio_atraso)}</td>
                <td className={`${TD} text-right`}>{formatPct(c.on_time_pct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2.5 px-0.5 text-[0.72rem] text-stats-muted-fg">
        Minutos. Atraso vs. compromiso con signo (negativo = entregó antes). Click en una fila para cambiar de escenario.
      </p>
    </div>
  );
}
