'use client';

/**
 * Card "Análisis del acierto — dónde y cuándo falla": las aperturas del
 * informe semanal, vivas y filtrables. Por día (Despacho vs motor sobre la
 * población común, con veredicto), por hora de la toma, peores zonas con
 * su lectura y peores incumplimientos. La fila de un día se clickea para
 * filtrar todo el detalle a ese día.
 *
 * Datos: /api/metricas/desfasaje/analisis (RPC metricas_desfasaje_analisis
 * sobre metricas_cumplimiento). Lógica de redacción y veredictos en
 * desfasaje-analisis-logic.ts (testeada sin render).
 */

import { useEffect, useMemo, useState } from 'react';
import type { DesfasajeAnalisisData, FuenteAnalisis, TipoDesfasaje } from '@/types/metricas-desfasaje';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import { formatMin } from './metricas-theme';
import {
  buildAnalisisFetch, lecturaZona, veredicto, diasGanados, fechaCorta, pctText, sesgoText,
  FUENTE_ANALISIS_LABEL, DIAS_ANALISIS,
} from './desfasaje-analisis-logic';

const COLOR_DESPACHO = 'var(--color-metricas-despacho)';
const COLOR_MOTOR = 'var(--color-metricas-serie)';

const SELECT_CLS =
  'rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary';
const TH_CLS = 'px-2 py-1.5 text-left text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg';
const TD_CLS = 'px-2 py-1.5 text-sm text-stats-foreground';

function PillVeredicto({ despacho, motor }: { despacho: number | null; motor: number | null }) {
  const v = veredicto(despacho, motor);
  if (v === null) return <span className="text-stats-muted-fg">—</span>;
  if (v.ganador === 'empate') {
    return <span className="rounded-full bg-stats-surface-2 px-2 py-0.5 text-[0.68rem] font-semibold text-stats-muted-fg">empate</span>;
  }
  const color = v.ganador === 'motor' ? COLOR_MOTOR : COLOR_DESPACHO;
  const label = v.ganador === 'motor' ? 'motor' : 'Despacho';
  return (
    <span className="rounded-full px-2 py-0.5 text-[0.68rem] font-semibold text-white" style={{ background: color }}>
      {label} +{v.puntos.toLocaleString('es-UY')}
    </span>
  );
}

function Barra({ pct, color }: { pct: number | null; color: string }) {
  if (pct == null) return null;
  return (
    <span className="inline-block h-[7px] w-16 overflow-hidden rounded-full bg-stats-surface-2 align-middle">
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
    </span>
  );
}

export function DesfasajeAnalisis({
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
  const [dias, setDias] = useState<number>(7);
  const [fuente, setFuente] = useState<FuenteAnalisis>('informada');
  const [fecha, setFecha] = useState<string | null>(null);
  const [data, setData] = useState<DesfasajeAnalisisData | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reintento, setReintento] = useState(0);

  // Cambiar rango/tipo/empresa invalida el día elegido (puede quedar fuera).
  useEffect(() => {
    setFecha(null);
  }, [tipo, dias, empresaSel, escenario]);

  const intent = useMemo(
    () => buildAnalisisFetch({ escenario, tipo, dias, fuente, fecha, empresaSel, isRoot, empresasIds, funcionalidades }),
    [escenario, tipo, dias, fuente, fecha, empresaSel, isRoot, empresasIds, funcionalidades],
  );

  useEffect(() => {
    if (intent.skip) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch(intent.url, { headers: intent.headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: DesfasajeAnalisisData; error?: string }) => {
        if (!vivo) return;
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [intent, reintento]);

  if (intent.skip) {
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        No tenés empresas asignadas para ver el análisis del acierto. Consultá con el administrador.
      </p>
    );
  }

  const ganados = data ? diasGanados(data.por_dia) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-[0.3rem]">
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
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Rango</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={SELECT_CLS}>
            {DIAS_ANALISIS.map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Analizar la demora de</span>
          <select value={fuente} onChange={(e) => setFuente(e.target.value as FuenteAnalisis)} className={SELECT_CLS}>
            {(Object.keys(FUENTE_ANALISIS_LABEL) as FuenteAnalisis[]).map((f) => (
              <option key={f} value={f}>{FUENTE_ANALISIS_LABEL[f]}</option>
            ))}
          </select>
        </label>
        {(data?.por_dia.length ?? 0) > 0 && (
          <div className="flex flex-col gap-[0.3rem]">
            <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Día</span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setFecha(null)}
                className={`rounded-md border px-2 py-1 text-[0.76rem] ${fecha === null ? 'border-stats-primary bg-stats-surface-2 font-semibold text-stats-foreground' : 'border-stats-border text-stats-muted-fg hover:text-stats-foreground'}`}
              >
                Todos
              </button>
              {(data?.por_dia ?? []).map((d) => (
                <button
                  key={d.fecha}
                  type="button"
                  onClick={() => setFecha(d.fecha === fecha ? null : d.fecha)}
                  className={`rounded-md border px-2 py-1 text-[0.76rem] ${fecha === d.fecha ? 'border-stats-primary bg-stats-surface-2 font-semibold text-stats-foreground' : 'border-stats-border text-stats-muted-fg hover:text-stats-foreground'}`}
                >
                  {fechaCorta(d.fecha)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error !== null ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-center text-sm text-stats-destructive">No se pudo cargar el análisis: {error}</p>
          <button
            type="button"
            onClick={() => setReintento((n) => n + 1)}
            className="rounded-md border border-stats-border px-3 py-1.5 text-sm text-stats-foreground hover:bg-stats-surface-2"
          >
            Reintentar
          </button>
        </div>
      ) : cargando && !data ? (
        <div className="h-[280px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : (data?.por_dia.length ?? 0) === 0 && (data?.resumen?.n ?? 0) === 0 ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">
          Todavía no hay pedidos con las dos proyecciones en este rango.
        </p>
      ) : data ? (
        <>
          {/* ── Resumen del corte ── */}
          {data.resumen && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-sm text-stats-muted-fg">
                Pedidos comparables <strong className="text-stats-foreground">{data.resumen.n.toLocaleString('es-UY')}</strong>
                {data.fecha !== null && <> el <strong className="text-stats-foreground">{fechaCorta(data.fecha)}</strong></>}
              </span>
              <span className="flex items-center gap-1.5 text-sm">
                <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: COLOR_DESPACHO }} />
                Despacho ≤25′ <strong>{pctText(data.resumen.despacho_le25)}</strong>
              </span>
              <span className="flex items-center gap-1.5 text-sm">
                <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: COLOR_MOTOR }} />
                Motor ≤25′ <strong>{pctText(data.resumen.motor_le25)}</strong>
              </span>
              <PillVeredicto despacho={data.resumen.despacho_le25} motor={data.resumen.motor_le25} />
              {fecha === null && ganados !== null && data.por_dia.length > 1 && (
                <span className="text-[0.78rem] text-stats-muted-fg">
                  días ganados: motor {ganados.motor} · Despacho {ganados.despacho}
                  {ganados.empates > 0 ? ` · ${ganados.empates} empate(s)` : ''}
                </span>
              )}
            </div>
          )}

          {/* ── Por día (click en la fila = filtrar el detalle) ── */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-stats-border">
                  <th className={TH_CLS}>Día</th>
                  <th className={TH_CLS}>Pedidos</th>
                  <th className={TH_CLS}>Despacho ≤25′</th>
                  <th className={TH_CLS}>Motor ≤25′</th>
                  <th className={TH_CLS}>p80 D / M</th>
                  <th className={TH_CLS}>Veredicto</th>
                </tr>
              </thead>
              <tbody>
                {data.por_dia.map((d) => (
                  <tr
                    key={d.fecha}
                    onClick={() => setFecha(d.fecha === fecha ? null : d.fecha)}
                    className={`cursor-pointer border-b border-stats-border/50 hover:bg-stats-surface-2/60 ${fecha === d.fecha ? 'bg-stats-surface-2' : ''}`}
                  >
                    <td className={TD_CLS}>{fechaCorta(d.fecha)}</td>
                    <td className={`${TD_CLS} font-stats-mono`}>{d.n.toLocaleString('es-UY')}</td>
                    <td className={TD_CLS}>
                      <span className="mr-2 font-stats-mono">{pctText(d.despacho_le25)}</span>
                      <Barra pct={d.despacho_le25} color={COLOR_DESPACHO} />
                    </td>
                    <td className={TD_CLS}>
                      <span className="mr-2 font-stats-mono">{pctText(d.motor_le25)}</span>
                      <Barra pct={d.motor_le25} color={COLOR_MOTOR} />
                    </td>
                    <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                      {d.despacho_p80 != null ? formatMin(d.despacho_p80) : '—'} / {d.motor_p80 != null ? formatMin(d.motor_p80) : '—'}
                    </td>
                    <td className={TD_CLS}><PillVeredicto despacho={d.despacho_le25} motor={d.motor_le25} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Por hora de la toma ── */}
          {data.por_hora.length > 0 && (
            <div>
              <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
                Cuándo falla {FUENTE_ANALISIS_LABEL[fuente]}: por hora de la toma
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse">
                  <thead>
                    <tr className="border-b border-stats-border">
                      <th className={TH_CLS}>Hora</th>
                      <th className={TH_CLS}>Pedidos</th>
                      <th className={TH_CLS}>Tarde &gt;30′</th>
                      <th className={TH_CLS}>Sesgo (mediana)</th>
                      <th className={TH_CLS}>p80 |desf|</th>
                      <th className={TH_CLS}>≤25′ Despacho / motor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_hora.map((h) => (
                      <tr key={h.hora} className="border-b border-stats-border/50">
                        <td className={`${TD_CLS} font-stats-mono`}>{h.hora}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{h.n.toLocaleString('es-UY')}</td>
                        <td className={TD_CLS}>
                          <span className="mr-2 font-stats-mono">{pctText(h.tarde30_pct)}</span>
                          <Barra pct={Math.min(1, h.tarde30_pct * 4)} color="var(--color-stats-destructive, #c0392b)" />
                        </td>
                        <td className={`${TD_CLS} font-stats-mono`}>{sesgoText(h.sesgo_mediana)}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{formatMin(h.p80)}</td>
                        <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                          {h.n_comun > 0 ? <>{pctText(h.despacho_le25)} / {pctText(h.motor_le25)}</> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Peores zonas ── */}
          {data.por_zona.length > 0 && (
            <div>
              <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
                Dónde falla {FUENTE_ANALISIS_LABEL[fuente]}: las zonas con peor acierto
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead>
                    <tr className="border-b border-stats-border">
                      <th className={TH_CLS}>Zona</th>
                      <th className={TH_CLS}>Pedidos</th>
                      <th className={TH_CLS}>A tiempo</th>
                      <th className={TH_CLS}>Tarde &gt;30′</th>
                      <th className={TH_CLS}>Sesgo (mediana)</th>
                      <th className={TH_CLS}>p80 |desf|</th>
                      <th className={TH_CLS}>Lectura</th>
                      <th className={TH_CLS}>≤25′ D / M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_zona.map((z) => (
                      <tr key={z.zona_id} className="border-b border-stats-border/50">
                        <td className={TD_CLS}>Zona {z.zona_id}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{z.n.toLocaleString('es-UY')}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{pctText(z.a_tiempo_pct)}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{pctText(z.tarde30_pct)}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{sesgoText(z.sesgo_mediana)}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{formatMin(z.p80)}</td>
                        <td className={TD_CLS}>
                          <span className="rounded-full border border-stats-border px-2 py-0.5 text-[0.68rem] text-stats-muted-fg">
                            {lecturaZona(z)}
                          </span>
                        </td>
                        <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                          {z.n_comun > 0 ? <>{pctText(z.despacho_le25)} / {pctText(z.motor_le25)}</> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Peores incumplimientos ── */}
          {data.peores.length > 0 && (
            <div>
              <p className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-stats-muted-fg">
                Los incumplimientos más gruesos de {FUENTE_ANALISIS_LABEL[fuente]} (llegaron MÁS tarde de lo prometido)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-stats-border">
                      <th className={TH_CLS}>Día</th>
                      <th className={TH_CLS}>Toma</th>
                      <th className={TH_CLS}>Zona</th>
                      <th className={TH_CLS}>Prometido</th>
                      <th className={TH_CLS}>Tardó</th>
                      <th className={TH_CLS}>Desfasaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.peores.map((p2, i) => (
                      <tr key={`${p2.fecha}-${p2.toma}-${p2.zona_id}-${i}`} className="border-b border-stats-border/50">
                        <td className={TD_CLS}>{fechaCorta(p2.fecha)}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{p2.toma}</td>
                        <td className={TD_CLS}>Zona {p2.zona_id}</td>
                        <td className={`${TD_CLS} font-stats-mono`}>{p2.prometido}′</td>
                        <td className={`${TD_CLS} font-stats-mono`}>
                          {p2.tardo}′{p2.tardo >= 120 ? ` (${(p2.tardo / 60).toLocaleString('es-UY', { maximumFractionDigits: 1 })} h)` : ''}
                        </td>
                        <td className={`${TD_CLS} font-stats-mono font-semibold`}>+{p2.desfasaje}′</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[0.72rem] text-stats-muted-fg">
            Sesgo = mediana del desfasaje CON signo (negativo: se llega antes de lo prometido). "≤25′ D / M" compara
            Despacho y motor sobre los MISMOS pedidos de ese corte. Zonas con menos de {data.fecha !== null ? 10 : 30} pedidos
            no se listan. Desde el 5/8 la línea del motor es el sistema nuevo completo (arranque predictivo incluido).
          </p>
        </>
      ) : null}
    </div>
  );
}
