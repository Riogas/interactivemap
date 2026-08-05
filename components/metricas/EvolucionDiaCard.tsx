'use client';

/**
 * Card "Evolución del día — EN VIVO": la sala de control de HOY. Se
 * refresca sola cada 60 segundos (pausable) y por cada corrida del motor
 * va dejando una fila en la línea de tiempo: qué publicó el motor, qué
 * tenía el Despacho, cuántas zonas estaban en cada fase del arranque
 * predictivo, y el acumulado de cumplimiento del día calculado EN VIVO
 * desde los pedidos entregados (sin esperar el job nocturno).
 *
 * Datos: /api/metricas/evolucion-dia (RPC metricas_evolucion_dia).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { EvolucionDiaData } from '@/types/metricas-evolucion';
import { formatMin } from './metricas-theme';
import { horaMontevideo } from './demora-comparativa-logic';
import { pctText } from './desfasaje-analisis-logic';
import { buildEvolucionFetch, hayFases, serieEvolucion } from './evolucion-dia-logic';

const COLOR_DESPACHO = 'var(--color-metricas-despacho)';
const COLOR_MOTOR = 'var(--color-metricas-serie)';
const COLOR_PRED = '#5B9BD5';
const COLOR_GRACIA = '#E0A800';
const COLOR_TRANSITO = '#8E6BB8';

const REFRESCO_MS = 60_000;

const SELECT_CLS =
  'rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary';
const TH_CLS = 'px-2 py-1.5 text-left text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg';
const TD_CLS = 'px-2 py-1 text-sm text-stats-foreground';

function FaseChip({ n, color, title }: { n: number; color: string; title: string }) {
  if (n <= 0) return null;
  return (
    <span
      title={title}
      className="rounded-full px-1.5 py-0.5 font-stats-mono text-[0.68rem] font-semibold text-white"
      style={{ background: color }}
    >
      {n}
    </span>
  );
}

export function EvolucionDiaCard({
  escenario,
  empresaSel,
  isRoot,
  empresasIds,
  funcionalidades,
}: {
  escenario: number | null;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}) {
  const [tipo, setTipo] = useState<TipoDesfasaje | null>(null);
  const [data, setData] = useState<EvolucionDiaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [auto, setAuto] = useState(true);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const intent = useMemo(
    () => buildEvolucionFetch({ escenario, tipo, empresaSel, isRoot, empresasIds, funcionalidades }),
    [escenario, tipo, empresaSel, isRoot, empresasIds, funcionalidades],
  );

  const cargar = useCallback(() => {
    if (intent.skip) return;
    setCargando(true);
    fetch(intent.url, { headers: intent.headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: EvolucionDiaData; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
        setError(null);
        setActualizado(new Date());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, [intent]);

  // Primera carga + cada cambio de filtros.
  useEffect(() => {
    cargar();
  }, [cargar]);

  // Auto-refresco cada 60 s, solo con la pestaña visible. Al volver a la
  // pestaña se refresca al toque (el intervalo solo, dejaría la foto vieja
  // hasta un minuto).
  useEffect(() => {
    if (!auto || intent.skip) return;
    const tick = () => {
      if (document.visibilityState === 'visible') cargar();
    };
    timerRef.current = setInterval(tick, REFRESCO_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [auto, intent.skip, cargar]);

  if (intent.skip) {
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        No tenés empresas asignadas para ver la evolución del día. Consultá con el administrador.
      </p>
    );
  }

  const serie = data ? serieEvolucion(data.corridas, horaMontevideo) : [];
  const conFases = data ? hayFases(data.corridas) : false;
  const resumen = data?.resumen ?? null;
  // La línea de tiempo se lee de arriba hacia abajo con lo más nuevo primero.
  const timeline = data ? [...data.corridas].reverse() : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-stats-foreground">
          <span className="relative flex h-2.5 w-2.5">
            {auto && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:hidden" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${auto ? 'bg-green-500' : 'bg-stats-muted-fg'}`} />
          </span>
          {auto ? 'EN VIVO' : 'Pausado'}
          {actualizado && (
            <span className="font-normal text-stats-muted-fg">
              · actualizado {actualizado.toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo', hour12: false })}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAuto((a) => !a)}
          className="rounded-md border border-stats-border px-2.5 py-1 text-[0.78rem] text-stats-foreground hover:bg-stats-surface-2"
        >
          {auto ? 'Pausar' : 'Reanudar'}
        </button>
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          className="rounded-md border border-stats-border px-2.5 py-1 text-[0.78rem] text-stats-foreground hover:bg-stats-surface-2 disabled:opacity-50"
        >
          {cargando ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
        <label className="ml-auto flex items-center gap-2">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo</span>
          <select
            value={tipo ?? ''}
            onChange={(e) => setTipo(e.target.value === '' ? null : (e.target.value as TipoDesfasaje))}
            className={SELECT_CLS}
          >
            <option value="">Urgente + Nocturno</option>
            {TIPOS_DESFASAJE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {error !== null ? (
        <p className="py-6 text-center text-sm text-stats-destructive">No se pudo cargar la evolución: {error}</p>
      ) : !data ? (
        <div className="h-[240px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : data.corridas.length === 0 ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">
          El motor todavía no corrió hoy (arranca a las 07:00). La card se actualiza sola.
        </p>
      ) : (
        <>
          {/* ── El acumulado del día, en vivo ── */}
          {resumen && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-sm text-stats-muted-fg">
                Entregados hoy <strong className="text-stats-foreground">{resumen.entregados.toLocaleString('es-UY')}</strong>
                {resumen.comun !== resumen.entregados && <> · comparables {resumen.comun.toLocaleString('es-UY')}</>}
              </span>
              <span className="flex items-center gap-1.5 text-sm">
                <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: COLOR_DESPACHO }} />
                Despacho ≤25′ <strong>{pctText(resumen.d_le25)}</strong>
              </span>
              <span className="flex items-center gap-1.5 text-sm">
                <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: COLOR_MOTOR }} />
                Motor ≤25′ <strong>{pctText(resumen.m_le25)}</strong>
              </span>
              <span className="text-[0.78rem] text-stats-muted-fg">
                p80: {resumen.d_p80 != null ? formatMin(resumen.d_p80) : '—'} / {resumen.m_p80 != null ? formatMin(resumen.m_p80) : '—'} min
              </span>
            </div>
          )}

          {/* ── Qué se está publicando (promedio por corrida) ── */}
          <div>
            <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
              Qué se publica: promedio por corrida
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={serie} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stats-border)" vertical={false} />
                <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" minTickGap={28} />
                <YAxis unit="'" tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" />
                <Tooltip formatter={(v: unknown) => (v == null ? '—' : `${formatMin(v as number)} min`)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey="prom_motor" name="Motor" stroke={COLOR_MOTOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="prom_despacho" name="Despacho" stroke={COLOR_DESPACHO} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Cómo se está cumpliendo (acumulado del día) ── */}
          {(resumen?.comun ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
                Cómo se cumple: % ≤25′ acumulado del día
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={serie} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stats-border)" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" minTickGap={28} />
                  <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" />
                  <Tooltip formatter={(v: unknown) => (v == null ? '—' : `${(v as number).toLocaleString('es-UY')}%`)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="m_le25" name="Motor ≤25′" stroke={COLOR_MOTOR} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="d_le25" name="Despacho ≤25′" stroke={COLOR_DESPACHO} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── El arranque predictivo en acción (solo si dejó rastro) ── */}
          {conFases && (
            <div>
              <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
                El arranque predictivo: zonas en cada fase
              </p>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={serie} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stats-border)" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" minTickGap={28} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--color-stats-muted-fg)" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="stepAfter" stackId="f" dataKey="f_predictivo" name="Esperando al 1er móvil" stroke={COLOR_PRED} fill={COLOR_PRED} fillOpacity={0.55} isAnimationActive={false} />
                  <Area type="stepAfter" stackId="f" dataKey="f_gracia" name="Gracia vencida" stroke={COLOR_GRACIA} fill={COLOR_GRACIA} fillOpacity={0.55} isAnimationActive={false} />
                  <Area type="stepAfter" stackId="f" dataKey="f_transito" name="Con tránsito" stroke={COLOR_TRANSITO} fill={COLOR_TRANSITO} fillOpacity={0.55} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── La línea de tiempo, corrida por corrida (lo nuevo arriba) ── */}
          <div>
            <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
              Línea de tiempo · {data.corridas.length} corridas
            </p>
            <div className="max-h-[360px] overflow-auto rounded-md border border-stats-border">
              <table className="w-full min-w-[700px] border-collapse">
                <thead className="sticky top-0 bg-stats-surface-2">
                  <tr>
                    <th className={TH_CLS}>Corrida</th>
                    <th className={TH_CLS}>Motor prom</th>
                    <th className={TH_CLS}>Despacho prom</th>
                    <th className={TH_CLS}>Fases arranque</th>
                    <th className={TH_CLS}>Sin móvil</th>
                    <th className={TH_CLS}>Entregados</th>
                    <th className={TH_CLS}>≤25′ D / M</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((c) => (
                    <tr key={c.corrida_at} className="border-t border-stats-border/50">
                      <td className={`${TD_CLS} font-stats-mono`}>{horaMontevideo(c.corrida_at)}</td>
                      <td className={`${TD_CLS} font-stats-mono`} style={{ color: COLOR_MOTOR }}>
                        {c.prom_motor != null ? `${formatMin(c.prom_motor)}′` : '—'}
                      </td>
                      <td className={`${TD_CLS} font-stats-mono`} style={{ color: COLOR_DESPACHO }}>
                        {c.prom_despacho != null ? `${formatMin(c.prom_despacho)}′` : '—'}
                      </td>
                      <td className={TD_CLS}>
                        <span className="flex items-center gap-1">
                          <FaseChip n={c.f_predictivo} color={COLOR_PRED} title="Esperando al primer móvil" />
                          <FaseChip n={c.f_gracia} color={COLOR_GRACIA} title="Gracia vencida" />
                          <FaseChip n={c.f_transito} color={COLOR_TRANSITO} title="Con tránsito" />
                          {c.f_predictivo + c.f_gracia + c.f_transito === 0 && (
                            <span className="text-stats-muted-fg">—</span>
                          )}
                        </span>
                      </td>
                      <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>{c.sin_movil}</td>
                      <td className={`${TD_CLS} font-stats-mono`}>{c.entregados.toLocaleString('es-UY')}</td>
                      <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                        {c.comun > 0 ? <>{pctText(c.d_le25)} / {pctText(c.m_le25)}</> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[0.72rem] text-stats-muted-fg">
            Cumplimiento calculado EN VIVO desde los pedidos entregados (la promesa del motor es la de la corrida
            vigente cuando se tomó cada pedido; agendados excluidos). Puede diferir décimas del cierre nocturno.
            "≤25′ D / M" es el acumulado del día hasta esa corrida, sobre los pedidos con las dos promesas.
          </p>
        </>
      )}
    </div>
  );
}
