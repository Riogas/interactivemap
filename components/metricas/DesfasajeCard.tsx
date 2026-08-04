'use client';

/**
 * Acierto de la demora: distribución del desfasaje |proyectado − real| en
 * franjas de 5 minutos (hasta 90, después "90+"), para la demora informada
 * del AS400 y la calculada por el motor, con la población común como única
 * base de comparación justa. Réplica de la planilla manual de operaciones
 * (KPI: % de pedidos con desfasaje ≤ 25).
 *
 * Colores consistentes con DemoraComparativa: AS400 = nocturno,
 * motor = serie.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { DesfasajeData, FuenteDesfasaje, TipoDesfasaje, KpisPoblacion } from '@/types/metricas-desfasaje';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import { formatMin, formatPct, formatCount } from './metricas-theme';
import {
  buildDesfasajeFetch, filasGrafico, kpisDeFuente, mensajeVacioDesfasaje, esFranjaKpi,
  FUENTE_LABEL, DIAS_OPCIONES,
} from './desfasaje-logic';
import type { FilaFranjaGrafico } from './desfasaje-logic';
import { usePrefersReducedMotion } from './useCountUp';

// Despacho naranja / motor azul: par CVD-safe (antes eran dos azules).
const COLOR_INFORMADA = 'var(--color-metricas-despacho)';
const COLOR_CALCULADA = 'var(--color-metricas-serie)';
/** Las franjas por encima del KPI (≤25') se pintan atenuadas: la zona
 * "buena" resalta sin necesidad de una línea extra. */
const OPACIDAD_FUERA_KPI = 0.45;

function nombreFranja(label: string): string {
  return label === '90+' ? 'más de 90 min' : `hasta ${label} min`;
}

function DesfasajeTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as (FilaFranjaGrafico & { esComparar?: boolean }) | undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-stats-border bg-stats-surface px-3 py-2 shadow-xl">
      <div className="mb-1 text-xs font-bold text-stats-foreground">Desfasaje {nombreFranja(row.label)}</div>
      <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
        {row.esComparar ? 'Despacho: ' : ''}
        {row.principal == null ? '—' : `${row.principal}%`} · {formatCount(row.principal_n)} pedidos
      </div>
      {row.esComparar && (
        <div className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
          Motor: {row.secundaria == null ? '—' : `${row.secundaria}%`} · {formatCount(row.secundaria_n)} pedidos
        </div>
      )}
    </div>
  );
}

/** Fila de KPIs de una población, con etiqueta opcional (modo comparar). */
function KpisFila({ etiqueta, color, kpis }: { etiqueta?: string; color?: string; kpis: KpisPoblacion }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      {etiqueta && (
        <span className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-stats-muted-fg">
          <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: color }} />
          {etiqueta}
        </span>
      )}
      <span className="text-[0.78rem] text-stats-muted-fg">
        Pedidos <strong className="font-stats-mono tabular-nums text-stats-foreground">{formatCount(kpis.n)}</strong>
      </span>
      <span className="text-[0.78rem] text-stats-muted-fg">
        ≤25&apos; <strong className="font-stats-mono tabular-nums text-stats-foreground">{formatPct(kpis.pct_le_25)}</strong>
      </span>
      <span className="text-[0.78rem] text-stats-muted-fg">
        ≤90&apos; <strong className="font-stats-mono tabular-nums text-stats-foreground">{formatPct(kpis.pct_le_90)}</strong>
      </span>
      <span
        className="text-[0.78rem] text-stats-muted-fg"
        title="El 80% de los pedidos tuvo un desfasaje menor o igual a este valor."
      >
        p80 <strong className="font-stats-mono tabular-nums text-stats-foreground">{kpis.p80 == null ? '—' : `${formatMin(kpis.p80)} min`}</strong>
      </span>
    </div>
  );
}

const NOTA_FUENTE: Record<FuenteDesfasaje, string> = {
  informada:
    'Población: todos los URGENTE/NOCTURNO entregados, no agendados, con demora informada por el AS400 al tomarlos.',
  calculada:
    'Población: solo pedidos con una corrida del motor fresca (≤20 min) al momento de la toma — existe desde el 29/07.',
  comparar:
    'Las dos series se calculan sobre los MISMOS pedidos (los que tienen ambas proyecciones): es la única comparación justa de acierto.',
};

export function DesfasajeCard({
  escenario,
  empresaSel,
  isRoot,
  empresasIds,
  funcionalidades,
  height = 240,
}: {
  escenario: number | null;
  /** Empresa elegida en la FiltersBar de la página (null = todas las del scope). */
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
  /** Alto del gráfico (mayor en el ExpandModal). */
  height?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [tipo, setTipo] = useState<TipoDesfasaje | null>(null);
  const [dias, setDias] = useState<number>(30);
  const [fuente, setFuente] = useState<FuenteDesfasaje>('informada');
  const [data, setData] = useState<DesfasajeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  /** Contador de reintentos: el botón del estado de error re-dispara el efecto. */
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    const intent = buildDesfasajeFetch({ escenario, tipo, dias, empresaSel, isRoot, empresasIds, funcionalidades });
    if (intent.skip) return;

    const ac = new AbortController();
    setCargando(true);
    setError(null);

    fetch(intent.url, { headers: intent.headers, signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        if (!j?.success) throw new Error(j?.error ?? 'Error desconocido');
        setData(j.data as DesfasajeData);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escenario, tipo, dias, empresaSel, isRoot, empresasIds.join(','), funcionalidades.join(','), reintento]);

  const esComparar = fuente === 'comparar';
  const filas = useMemo(
    () => filasGrafico(data?.franjas ?? [], fuente).map((f) => ({ ...f, esComparar })),
    [data, fuente, esComparar],
  );
  const kpis = data == null ? null : kpisDeFuente(data, fuente);
  const vacio = mensajeVacioDesfasaje(fuente, data);

  if (!isRoot && empresasIds.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        No tenés empresas asignadas para ver el acierto de la demora. Consultá con el administrador.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo</span>
          <select
            value={tipo ?? ''}
            onChange={(e) => setTipo(e.target.value === '' ? null : (e.target.value as TipoDesfasaje))}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            <option value="">Urgente + Nocturno</option>
            {TIPOS_DESFASAJE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Rango</span>
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            {DIAS_OPCIONES.map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Demora</span>
          <select
            value={fuente}
            onChange={(e) => setFuente(e.target.value as FuenteDesfasaje)}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            {(Object.keys(FUENTE_LABEL) as FuenteDesfasaje[]).map((f) => (
              <option key={f} value={f}>{FUENTE_LABEL[f]}</option>
            ))}
          </select>
        </label>
      </div>

      {error !== null ? (
        // El error NO desmonta los selectores (fix Important del review):
        // cambiar Rango/Tipo o el botón reintentan sin recargar la página.
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-center text-sm text-stats-destructive">
            No se pudo cargar el acierto de la demora: {error}
          </p>
          <button
            type="button"
            onClick={() => setReintento((n) => n + 1)}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-3 py-1.5 text-sm text-stats-foreground hover:border-stats-primary"
          >
            Reintentar
          </button>
        </div>
      ) : data === null ? (
        // Primera carga (o escenario todavía sin resolver): skeleton, nunca
        // un "no hay datos" falso.
        <div className="animate-pulse rounded-lg bg-stats-surface-2" style={{ height }} />
      ) : vacio !== null ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">{vacio}</p>
      ) : (
        <>
          {kpis && (
            <div className="flex flex-col gap-1.5">
              <KpisFila
                etiqueta={esComparar ? 'Despacho' : undefined}
                color={COLOR_INFORMADA}
                kpis={kpis.principal}
              />
              {esComparar && kpis.secundaria && (
                <KpisFila etiqueta="Calculada (motor)" color={COLOR_CALCULADA} kpis={kpis.secundaria} />
              )}
            </div>
          )}

          {/* opacity durante el refetch: sin esto, cambiar Rango mostraba
              los números viejos con total confianza hasta que llegara la
              respuesta. */}
          <div style={{ width: '100%', height }} className={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filas} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
                <CartesianGrid stroke="var(--color-stats-border)" strokeOpacity={0.7} vertical={false} />
                {/* sin interval={0}: en mobile 19 ticks a 10px se pisan;
                    Recharts saltea los que no entren. */}
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fontFamily: 'var(--font-stats-mono)' }}
                  stroke="var(--color-stats-muted-fg)"
                  tickLine={false}
                />
                <YAxis unit="%" tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" />
                <Tooltip content={DesfasajeTooltip} cursor={{ fill: 'var(--color-stats-surface-2)' }} />
                <Bar
                  dataKey="principal"
                  name={esComparar ? 'Despacho' : 'Pedidos'}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  maxBarSize={30}
                  fill={fuente === 'calculada' ? COLOR_CALCULADA : COLOR_INFORMADA}
                >
                  {filas.map((f) => (
                    <Cell
                      key={f.label}
                      fillOpacity={esFranjaKpi(f.label) ? 1 : OPACIDAD_FUERA_KPI}
                    />
                  ))}
                </Bar>
                {esComparar && (
                  <Bar
                    dataKey="secundaria"
                    name="Motor"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={!reducedMotion}
                    maxBarSize={30}
                    fill={COLOR_CALCULADA}
                  >
                    {filas.map((f) => (
                      <Cell
                        key={f.label}
                        fillOpacity={esFranjaKpi(f.label) ? 1 : OPACIDAD_FUERA_KPI}
                      />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[0.76rem] leading-snug text-stats-muted-fg">
            {NOTA_FUENTE[fuente]}{' '}
            Las franjas hasta 25 min van a color pleno: ahí vive el KPI
            (&quot;% de pedidos con desfasaje ≤ 25&quot;).
          </p>
        </>
      )}
    </div>
  );
}
