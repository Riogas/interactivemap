'use client';

/**
 * Card "Laboratorio de variantes" (pedido de Diego, audio 7/8): en cada
 * corrida el motor graba, además de lo que publica, lo que HUBIERA
 * publicado cada configuración alternativa del catálogo (otro
 * estadístico, otro factor, otro escalón, sin escalera…). Esta card es
 * el ranking: qué combinación viene acertando más, contra el Despacho y
 * contra el motor real, por día y acumulado.
 *
 * Disciplina anti-ruido: el veredicto se lee por ventana de días y por
 * días ganados — la regla de promoción vive en variantes-logic.ts.
 *
 * Datos: /api/metricas/variantes (RPC metricas_variantes_scoreboard).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import type { LabJob, LabJobsData, VarianteScore, VariantesScoreboardData } from '@/types/metricas-variantes';
import { pctText, fechaCorta } from './desfasaje-analisis-logic';
import {
  RANGOS_DIAS, TOLERANCIAS, UMBRAL_ESPEJO_OK,
  buildReprocesoFetch, buildVariantesFetch, diasVsMotor, evaluarPromocion, fechaMontevideoHoy,
  hayJobActivo, knobChips, narrativaLab, restarDias, resumenJob,
} from './variantes-logic';

const COLOR_DESPACHO = 'var(--color-metricas-despacho)';
const COLOR_MOTOR = 'var(--color-metricas-serie)';

const TH_CLS = 'px-2 py-1.5 text-left text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg';
const TD_CLS = 'px-2 py-1 text-sm text-stats-foreground';
const CHIP_BTN_CLS = (activo: boolean) =>
  `rounded-md border px-2 py-0.5 text-[0.78rem] ${
    activo
      ? 'border-stats-primary bg-stats-primary/10 font-semibold text-stats-foreground'
      : 'border-stats-border text-stats-muted-fg hover:bg-stats-surface-2'
  }`;

const ESTADO_CHIP_CLS: Record<string, string> = {
  PENDIENTE: 'bg-stats-surface-2 text-stats-muted-fg',
  CORRIENDO: 'bg-amber-500/15 text-amber-500',
  LISTO: 'bg-emerald-500/15 text-emerald-500',
  ERROR: 'bg-red-500/15 text-stats-destructive',
};

function deltaText(v: number | null | undefined, ref: number | null | undefined): string {
  if (v == null || ref == null) return '—';
  const d = v - ref;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
}

/** Timestamp de la base → "7/8 14:32" en hora de Montevideo. */
function momento(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(',', '');
}

export function VariantesLabCard({
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
  const [tipo] = useState<TipoDesfasaje | null>('URGENTE');
  const [dias, setDias] = useState<number>(7);
  const [tolerancia, setTolerancia] = useState<number>(25);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [data, setData] = useState<VariantesScoreboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const hoy = useMemo(() => fechaMontevideoHoy(new Date()), []);

  const intent = useMemo(
    () => buildVariantesFetch({ escenario, tipo, dias, tolerancia, hoy, empresaSel, isRoot, empresasIds, funcionalidades }),
    [escenario, tipo, dias, tolerancia, hoy, empresaSel, isRoot, empresasIds, funcionalidades],
  );

  const cargar = useCallback(() => {
    if (intent.skip) return;
    setCargando(true);
    fetch(intent.url, { headers: intent.headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: VariantesScoreboardData; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, [intent]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (intent.skip) {
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        No tenés empresas asignadas para ver el laboratorio de variantes. Consultá con el administrador.
      </p>
    );
  }

  const minN = data?.min_n_dia ?? 20;
  const variantes: VarianteScore[] = data?.variantes ?? [];
  const conDatos = variantes.some((v) => v.n > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Ventana</span>
          {RANGOS_DIAS.map((d) => (
            <button key={d} type="button" onClick={() => setDias(d)} className={CHIP_BTN_CLS(dias === d)}>
              {d} días
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tolerancia</span>
          {TOLERANCIAS.map((t) => (
            <button key={t} type="button" onClick={() => setTolerancia(t)} className={CHIP_BTN_CLS(tolerancia === t)}>
              ±{t}′
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2 text-[0.78rem] text-stats-muted-fg">
          {data?.campeon_ok != null && (
            <span
              className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                (data.campeon_ok.pct ?? 0) >= UMBRAL_ESPEJO_OK
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}
              title={`Control de sanidad: la variante Campeón debe publicar lo mismo que el motor. Coincidió en ${data.campeon_ok.coincidencias} de ${data.campeon_ok.corridas} cálculos del rango (verde a partir de ${UMBRAL_ESPEJO_OK}%: el día en que se activa el laboratorio la escalera arranca sin historia y puede haber diferencias de un escalón).`}
            >
              espejo {pctText(data.campeon_ok.pct != null ? data.campeon_ok.pct / 100 : null)}
            </span>
          )}
          <button
            type="button"
            onClick={cargar}
            disabled={cargando}
            className="rounded-md border border-stats-border px-2 py-0.5 text-stats-foreground hover:bg-stats-surface-2 disabled:opacity-50"
          >
            {cargando ? '…' : 'Actualizar'}
          </button>
        </span>
      </div>

      <ReprocesoPanel
        escenario={escenario}
        isRoot={isRoot}
        funcionalidades={funcionalidades}
        hoy={hoy}
        variantes={variantes}
        onListo={cargar}
      />

      {error !== null ? (
        <p className="py-6 text-center text-sm text-stats-destructive">No se pudo cargar el laboratorio: {error}</p>
      ) : !data ? (
        <div className="h-[280px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : (
        <>
          <p className="rounded-md border border-stats-border bg-stats-surface-2 px-3 py-2 text-[0.82rem] leading-relaxed text-stats-foreground">
            {narrativaLab({ variantes, motor: data.motor, despacho: data.despacho, minN, tolerancia })}
            {data.desde_datos != null && (
              <span className="text-stats-muted-fg"> Midiendo desde el {fechaCorta(data.desde_datos)}.</span>
            )}
          </p>

          {!conDatos ? (
            <p className="py-4 text-center text-sm text-stats-muted-fg">
              Las variantes se calculan en cada corrida a partir de su activación; las primeras entregas comparables
              van a aparecer acá en el correr del día.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-md border border-stats-border">
              <table className="w-full min-w-[880px] border-collapse">
                <thead className="sticky top-0 z-10 bg-stats-surface-2">
                  <tr>
                    <th className={TH_CLS}>Variante</th>
                    <th className={TH_CLS} title={`% de pedidos con desfasaje ≤${tolerancia}′ (real vs lo que ESTA variante hubiera publicado)`}>
                      ≤{tolerancia}′
                    </th>
                    <th className={TH_CLS} title="Puntos de acierto sobre el Despacho (mismo conjunto de pedidos)">vs Despacho</th>
                    <th className={TH_CLS} title="Puntos de acierto sobre el motor real (lo efectivamente publicado)">vs Motor</th>
                    <th className={TH_CLS} title="Promedio del desfasaje con signo: negativo = se llega antes de lo prometido">Sesgo</th>
                    <th className={TH_CLS} title={`Días en los que le ganó al motor real (solo días con ≥${minN} pedidos)`}>Días vs motor</th>
                    <th className={TH_CLS}>n</th>
                    <th className={TH_CLS}>Veredicto</th>
                  </tr>
                </thead>
                <tbody>
                  {variantes.map((v) => {
                    const vsMotor = diasVsMotor(v, data.motor, minN);
                    const promo = evaluarPromocion(v, data.motor, minN);
                    const esControl = v.codigo === 'CAMPEON';
                    const expandida = abierta === v.id;
                    return (
                      <VarianteFila
                        key={v.id}
                        v={v}
                        data={data}
                        vsMotor={vsMotor}
                        promo={promo}
                        esControl={esControl}
                        expandida={expandida}
                        onToggle={() => setAbierta(expandida ? null : v.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[0.72rem] text-stats-muted-fg">
            Cada variante se calcula sobre la misma corrida que publicó el motor, con su propia escalera de suavizado, y
            acá se cruza contra las entregas reales (promesa = corrida vigente a la toma; agendados excluidos; mismo
            conjunto de pedidos para todos, motor y Despacho incluidos). Con 13 variantes compitiendo, un día suelto no
            prueba nada: una variante se declara promovible solo si le gana al motor la mayoría de los días y por margen
            acumulado — probar una idea nueva es un alta en el catálogo, sin tocar el motor.
            {data.desfase?.mediana_seg != null && (
              <> El laboratorio espeja cada corrida a los {Math.round(data.desfase.mediana_seg)} segundos (mediana): las
              variantes que recalculan el ritmo necesitan el estado del momento, así que una corrida vieja no se
              rellena en vez de reconstruirse mal.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Panel de reproceso (solo root). Encolar es barato; ejecutar no: el
 * worker de pg_cron simula corrida por corrida, así que la pantalla
 * encola y mira la cola, nunca espera al resultado en el request.
 *
 * Sirve para dos cosas concretas: dar de alta una variante nueva y
 * tener veredicto sobre la historia ya capturada (sin esperar días), y
 * rellenar un hueco cuando el laboratorio estuvo caído.
 */
function ReprocesoPanel({
  escenario,
  isRoot,
  funcionalidades,
  hoy,
  variantes,
  onListo,
}: {
  escenario: number | null;
  isRoot: boolean;
  funcionalidades: string[];
  hoy: string;
  variantes: VarianteScore[];
  onListo: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [dias, setDias] = useState<number>(7);
  const [todas, setTodas] = useState(true);
  const [sel, setSel] = useState<number[]>([]);
  const [jobs, setJobs] = useState<LabJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Para saber cuándo un reproceso PASÓ a terminado: es el único momento
  // en que tiene sentido recargar el scoreboard.
  const habiaActivo = useRef(false);

  const intentLista = useMemo(
    () => buildReprocesoFetch({ escenario, isRoot, funcionalidades }),
    [escenario, isRoot, funcionalidades],
  );

  const cargarJobs = useCallback(() => {
    if (intentLista.skip) return;
    fetch(intentLista.url, { method: intentLista.method, headers: intentLista.headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: LabJobsData; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        const lista = j.data.jobs ?? [];
        const activo = hayJobActivo(lista);
        // El reproceso reescribe lo que cada variante hubiera publicado en
        // todo el rango: apenas termina bien, lo que está en pantalla es
        // viejo. Un ERROR no escribió nada, así que no vale recargar.
        if (habiaActivo.current && !activo && lista[0]?.estado === 'LISTO') onListo();
        habiaActivo.current = activo;
        setJobs(lista);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [intentLista, onListo]);

  useEffect(() => {
    if (!abierto) return;
    cargarJobs();
  }, [abierto, cargarJobs]);

  const activo = hayJobActivo(jobs);

  // Mientras haya algo en la cola, seguimos el progreso solos. Dependemos
  // del booleano y no del array para no reiniciar el intervalo en cada
  // respuesta.
  useEffect(() => {
    if (!abierto || !activo) return;
    const t = setInterval(cargarJobs, 5000);
    return () => clearInterval(t);
  }, [abierto, activo, cargarJobs]);

  if (!isRoot || escenario == null) return null;

  const desde = restarDias(hoy, dias - 1);
  const puedeEnviar = !enviando && !activo && (todas || sel.length > 0);

  const toggleVariante = (id: number) => {
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const enviar = () => {
    const intent = buildReprocesoFetch({
      escenario,
      isRoot,
      funcionalidades,
      crear: { desde, hasta: hoy, variantes: todas ? null : sel },
    });
    if (intent.skip) return;
    setEnviando(true);
    fetch(intent.url, { method: intent.method, headers: intent.headers, body: intent.body })
      .then((r) => r.json())
      .then((j: { success: boolean; error?: string }) => {
        if (!j.success) throw new Error(j.error ?? 'Error desconocido');
        setError(null);
        // Recién encolado: el próximo pasaje a terminado tiene que
        // recargar el scoreboard aunque el poll lo vea ya listo.
        habiaActivo.current = true;
        cargarJobs();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setEnviando(false));
  };

  return (
    <div className="rounded-md border border-stats-border">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-stats-surface-2"
      >
        <span className="text-[0.8rem] font-semibold text-stats-foreground">Reprocesar</span>
        <span className="flex items-center gap-2 text-[0.72rem] text-stats-muted-fg">
          {activo && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-semibold text-amber-500">
              en curso
            </span>
          )}
          {abierto ? 'ocultar' : 'mostrar'}
        </span>
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 border-t border-stats-border px-3 py-3">
          <p className="text-[0.75rem] leading-relaxed text-stats-muted-fg">
            Recalcula lo que cada variante hubiera publicado sobre los días ya capturados. Sirve para tener veredicto de
            una variante nueva sin esperar días, o para rellenar un hueco. No toca lo que publicó el motor: reescribe
            solo la tabla del laboratorio. Corre de a un trabajo por vez y lo toma un job de la base cada minuto.
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Rango</span>
            {RANGOS_DIAS.map((d) => (
              <button key={d} type="button" onClick={() => setDias(d)} className={CHIP_BTN_CLS(dias === d)}>
                {d} días
              </button>
            ))}
            <span className="text-[0.72rem] text-stats-muted-fg">
              {fechaCorta(desde)} → {fechaCorta(hoy)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Variantes</span>
            <label className="flex items-center gap-1.5 text-[0.78rem] text-stats-foreground">
              <input
                type="checkbox"
                checked={todas}
                onChange={(e) => setTodas(e.target.checked)}
                className="accent-stats-primary"
              />
              Todas las variantes
            </label>
            {!todas &&
              (variantes.length === 0 ? (
                <span className="text-[0.72rem] text-stats-muted-fg">
                  Todavía no hay catálogo cargado en pantalla: pedilas todas.
                </span>
              ) : (
                variantes.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleVariante(v.id)}
                    className={CHIP_BTN_CLS(sel.includes(v.id))}
                    title={v.descripcion}
                  >
                    {v.nombre}
                  </button>
                ))
              ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={!puedeEnviar}
              className="rounded-md border border-stats-primary bg-stats-primary/10 px-3 py-1 text-[0.8rem] font-semibold text-stats-foreground hover:bg-stats-primary/20 disabled:opacity-50"
            >
              {enviando ? 'Encolando…' : 'Reprocesar'}
            </button>
            {activo && (
              <span className="text-[0.72rem] text-stats-muted-fg">
                Hay un reproceso en curso: va de a uno por escenario.
              </span>
            )}
            {!todas && sel.length === 0 && (
              <span className="text-[0.72rem] text-stats-muted-fg">Elegí al menos una variante.</span>
            )}
          </div>

          {error !== null && <p className="text-[0.78rem] text-stats-destructive">{error}</p>}

          {jobs.length === 0 ? (
            <p className="text-[0.75rem] text-stats-muted-fg">Todavía no se pidió ningún reproceso para este escenario.</p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-md border border-stats-border">
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="sticky top-0 z-10 bg-stats-surface-2">
                  <tr>
                    <th className={TH_CLS}>Estado</th>
                    <th className={TH_CLS}>Trabajo</th>
                    <th className={TH_CLS}>Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-stats-border/50">
                      <td className={TD_CLS}>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                            ESTADO_CHIP_CLS[j.estado] ?? 'bg-stats-surface-2 text-stats-muted-fg'
                          }`}
                        >
                          {j.estado}
                        </span>
                      </td>
                      <td className={`${TD_CLS} text-[0.78rem]`}>{resumenJob(j)}</td>
                      <td className={`${TD_CLS} whitespace-nowrap text-[0.72rem] text-stats-muted-fg`}>
                        {momento(j.creado_at)}
                        {j.pedido_por != null && j.pedido_por !== '' && <> · {j.pedido_por}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VarianteFila({
  v,
  data,
  vsMotor,
  promo,
  esControl,
  expandida,
  onToggle,
}: {
  v: VarianteScore;
  data: VariantesScoreboardData;
  vsMotor: { ganados: number; total: number };
  promo: { promovible: boolean; motivo: string };
  esControl: boolean;
  expandida: boolean;
  onToggle: () => void;
}) {
  const sinDatos = v.n === 0;
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-stats-border/50 hover:bg-stats-surface-2/60 ${sinDatos ? 'opacity-60' : ''}`}
        onClick={onToggle}
      >
        <td className={TD_CLS}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{v.nombre}</span>
            {knobChips(v.knobs).map((c) => (
              <span key={c} className="rounded-full bg-stats-surface-2 px-1.5 py-0.5 font-stats-mono text-[0.66rem] text-stats-muted-fg">
                {c}
              </span>
            ))}
          </div>
        </td>
        <td className={`${TD_CLS} font-stats-mono font-semibold`}>{v.le_tol != null ? `${v.le_tol.toFixed(1)}%` : '—'}</td>
        <td className={`${TD_CLS} font-stats-mono`} style={{ color: COLOR_DESPACHO }}>
          {deltaText(v.le_tol, data.despacho?.le_tol)}
        </td>
        <td className={`${TD_CLS} font-stats-mono`} style={{ color: COLOR_MOTOR }}>
          {deltaText(v.le_tol, data.motor?.le_tol)}
        </td>
        <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
          {v.sesgo != null ? `${v.sesgo > 0 ? '+' : ''}${v.sesgo.toFixed(1)}′` : '—'}
        </td>
        <td className={`${TD_CLS} font-stats-mono`}>
          {vsMotor.total > 0 ? `${vsMotor.ganados}/${vsMotor.total}` : '—'}
        </td>
        <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>{v.n}</td>
        <td className={TD_CLS}>
          {esControl ? (
            <span className="rounded-full bg-stats-surface-2 px-2 py-0.5 text-[0.68rem] font-semibold text-stats-muted-fg">CONTROL</span>
          ) : promo.promovible ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.68rem] font-semibold text-emerald-500" title={promo.motivo}>
              PROMOVIBLE
            </span>
          ) : (
            <span className="text-[0.72rem] text-stats-muted-fg" title={promo.motivo}>midiendo…</span>
          )}
        </td>
      </tr>
      {expandida && (
        <tr className="border-t border-stats-border/30 bg-stats-surface-2/40">
          <td colSpan={8} className="px-3 py-2">
            <p className="mb-2 text-[0.78rem] text-stats-muted-fg">{v.descripcion}</p>
            {v.dias.length === 0 ? (
              <p className="text-[0.78rem] text-stats-muted-fg">Sin días con datos todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {v.dias.map((d) => (
                  <div
                    key={d.fecha}
                    className="rounded-md border border-stats-border bg-stats-surface px-2 py-1 text-center"
                    title={`${d.n} pedidos comunes · Despacho ${d.despacho_le_tol != null ? `${d.despacho_le_tol.toFixed(1)}%` : '—'}`}
                  >
                    <div className="text-[0.64rem] uppercase text-stats-muted-fg">{fechaCorta(d.fecha)}</div>
                    <div className="font-stats-mono text-sm font-semibold">
                      {d.le_tol != null ? `${d.le_tol.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-[0.64rem] text-stats-muted-fg">
                      {d.gana == null ? `n=${d.n}` : d.gana ? 'ganó al Despacho' : 'perdió'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
