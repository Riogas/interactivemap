'use client';

/**
 * /dashboard/metricas-cumplimiento — Dashboard de Métricas de Cumplimiento.
 *
 * Ruta protegida (layout.tsx) accesible solo por URL (no linkeada en menús).
 * Consume GET /api/metricas/dashboard (RPC metricas_dashboard) con scope de
 * empresa fail-closed. Incluye los 3 enhancements pedidos: E1 period-picker
 * adaptativo, E2 modal de ampliación por card, E3 popover "i" por card.
 *
 * Ver .claude/runs/20260724-141300-2wy/{spec,plan}.md para el contrato completo.
 */

import { useEffect, useState } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { canSeeAllEmpresas } from '@/lib/auth-scope';
import { useMetricasDashboard } from '@/lib/hooks/use-metricas-dashboard';
import { TIPOS_SERVICIO } from '@/types/metricas-dashboard';
import type { Ventana, Dimension, TipoServicioDashboard, SeriePunto, PorTipoRow } from '@/types/metricas-dashboard';
import { FiltersBar, type EmpresaOption } from '@/components/metricas/FiltersBar';
import type { PeriodValue } from '@/components/metricas/PeriodPicker';
import { KpiCard } from '@/components/metricas/KpiCard';
import { CardShell } from '@/components/metricas/CardShell';
import { TrendChart } from '@/components/metricas/TrendChart';
import { TipoBarChart } from '@/components/metricas/TipoBarChart';
import { RankingList } from '@/components/metricas/RankingList';
import { DetalleTable } from '@/components/metricas/DetalleTable';
import { ExpandModal } from '@/components/metricas/ExpandModal';
import { EscenarioComparativa } from '@/components/metricas/EscenarioComparativa';
import { DemoraComparativa } from '@/components/metricas/DemoraComparativa';
import { DesfasajeCard } from '@/components/metricas/DesfasajeCard';
import { DesfasajeAnalisis } from '@/components/metricas/DesfasajeAnalisis';
import { EvolucionDiaCard } from '@/components/metricas/EvolucionDiaCard';
import { INFO_TEXTS, DIMENSION_LABEL, COLOR_TIPO, TIPO_LABEL, formatMin, formatPct } from '@/components/metricas/metricas-theme';

type ExpandedSection = 'tendencia' | 'tipo' | 'ranking' | 'tabla' | 'escenarios' | 'demora' | 'desfasaje' | 'analisis' | 'evolucion' | null;

// ─── Sub-tablas chicas usadas SOLO dentro del ExpandModal (E2: "tabla completa
// de datos de esa sección" para tendencia/por-tipo, complementando el chart). ──

function SerieTable({ serie, ventana }: { serie: SeriePunto[]; ventana: Ventana }) {
  if (serie.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-left text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">
              {ventana === 'diario' ? 'Día' : ventana === 'semanal' ? 'Semana' : 'Mes'}
            </th>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Prom.</th>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">P90</th>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Cumpl.</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((s) => (
            <tr key={s.periodo} className="hover:bg-stats-surface-2">
              <td className="border-b border-stats-border px-2.5 py-1.5 text-left text-stats-foreground">{s.periodo}</td>
              <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(s.promedio)}</td>
              <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(s.p90)}</td>
              <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{s.cantidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PorTipoTable({ porTipo }: { porTipo: PorTipoRow[] }) {
  if (porTipo.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-left text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Tipo</th>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Prom.</th>
            <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Cumpl.</th>
          </tr>
        </thead>
        <tbody>
          {porTipo.map((t) => (
            <tr key={t.tipo_servicio} className="hover:bg-stats-surface-2">
              <td className="border-b border-stats-border px-2.5 py-1.5 text-left text-stats-foreground">
                <span className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-middle" style={{ background: COLOR_TIPO[t.tipo_servicio] }} />
                {TIPO_LABEL[t.tipo_servicio]}
              </td>
              <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(t.promedio)}</td>
              <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{t.cantidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Skeletons de carga ─────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-stats-surface-2 ${className}`} />;
}

function KpiCardSkeleton({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <div className="stats-row-enter rounded-2xl border border-stats-border bg-stats-surface p-4" style={{ animationDelay: `${delayMs}ms` }}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-3 h-4 w-20" />
    </div>
  );
}

function csvEscape(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  // Neutraliza CSV/formula injection: si el valor arranca con =, +, -, @ (u
  // otro caracter que Excel/Sheets pueda interpretar como inicio de fórmula),
  // se antepone un apóstrofe para forzar interpretación como texto plano.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function MetricasCumplimientoContent() {
  const { user, escenarioId } = useAuth();

  // ── Tema (patrón app/dashboard/stats/page.tsx:376-383) ──────────────────
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('metricas-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('metricas-theme', theme);
  }, [theme]);

  // ── Escenario: clave principal de todo el modelo ──────────────────────
  // Arranca en el escenario de la sesión (el que el usuario eligió al
  // loguearse) y a partir de ahí manda la selección explícita del usuario —
  // por eso el `prev ??`: que llegue escenarioId tarde no debe pisar lo que
  // ya eligió. Cambiar de escenario invalida el período elegido (cada
  // escenario tiene su propio rango de fechas disponible).
  const [escenarioSel, setEscenarioSel] = useState<number | null>(null);
  useEffect(() => {
    setEscenarioSel((prev) => prev ?? escenarioId ?? null);
  }, [escenarioId]);

  // ── Filtros ───────────────────────────────────────────────────────────
  const [ventana, setVentana] = useState<Ventana>('diario');
  const [dimension, setDimension] = useState<Dimension>('chofer');
  const [tiposSel, setTiposSel] = useState<Set<TipoServicioDashboard>>(() => new Set(TIPOS_SERVICIO));
  const [empresaSel, setEmpresaSel] = useState<number | null>(null);
  const [periodValue, setPeriodValue] = useState<PeriodValue | null>(null);
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);

  function handleVentanaChange(v: Ventana) {
    setVentana(v);
    setPeriodValue(null); // el picker cambia de granularidad -> vuelve a "último disponible"
  }

  function handleEscenarioChange(id: number) {
    setEscenarioSel(id);
    setPeriodValue(null); // el rango disponible es otro -> "último disponible" del escenario nuevo
  }

  function toggleTipo(t: TipoServicioDashboard) {
    setTiposSel((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size === 1) return prev; // nunca dejar la selección vacía (ambigüedad con "todos" en la RPC)
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  }

  // tipos=null cuando están los 5 seleccionados (equivalente a "todos" en la RPC, evita un CSV largo innecesario).
  const tiposParam = tiposSel.size === TIPOS_SERVICIO.length ? null : Array.from(tiposSel);

  // ── Auth-scope (mismo patrón que app/dashboard/stats/page.tsx) ──────────
  const unrestricted = canSeeAllEmpresas(user);
  const empresasIdsForHeader = user?.allowedEmpresas ?? [];
  // Funcionalidades de todos los roles del usuario -> header x-track-funcs.
  // Tanto /api/metricas/dashboard como /api/demoras/comparativa corren
  // requireFuncionalidad('Estadisticas Cumplimiento'): sin esto, todo caller
  // no-root recibía 403 aunque tuviera la funcionalidad asignada (B5).
  // Mismo patrón que app/dashboard/page.tsx:1213.
  const funcionalidades = (user?.roles ?? []).flatMap((r) => (r.funcionalidades ?? []).map((f) => f.nombre));

  // ── Empresas para el selector (fetch on mount; filtradas al scope del caller) ──
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/empresas')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json?.success) return;
        let list: EmpresaOption[] = json.data ?? [];
        if (!unrestricted && empresasIdsForHeader.length > 0) {
          list = list.filter((e) => empresasIdsForHeader.includes(e.empresa_fletera_id));
        }
        setEmpresas(list);
      })
      .catch(() => {
        /* selector de empresa degradado a "Todas" si falla — no bloquea el dashboard */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unrestricted, empresasIdsForHeader.join(',')]);

  // ── Datos ─────────────────────────────────────────────────────────────
  const { data, isLoading, error, refetch } = useMetricasDashboard({
    escenario: escenarioSel,
    ventana,
    dimension,
    desde: periodValue?.desde ?? null,
    hasta: periodValue?.hasta ?? null,
    tipos: tiposParam,
    empresaSel,
    isRoot: unrestricted,
    empresasIds: empresasIdsForHeader,
    funcionalidades,
  });

  const kpis = data?.kpis;
  const kpisPrev = data?.kpis_prev;
  const serie = data?.serie ?? [];
  const sparkPromedio = serie.slice(-7).map((s) => s.promedio).filter((v): v is number => v != null);
  const sparkP90 = serie.slice(-7).map((s) => s.p90).filter((v): v is number => v != null);
  const sparkCantidad = serie.slice(-7).map((s) => s.cantidad);

  const dimLabel = DIMENSION_LABEL[dimension];
  const showEmptyScopeBanner = !isLoading && data && data.rango === null;

  const escenarios = data?.escenarios ?? [];
  const escenarioActual = escenarios.find((e) => e.escenario === escenarioSel);
  const escenarioLabel = escenarioActual?.nombre ?? (escenarioSel != null ? `Escenario ${escenarioSel}` : null);

  function exportCsv() {
    if (!data) return;
    // El escenario va como 1ª columna Y en el nombre del archivo: exportar dos
    // escenarios distintos no puede producir dos CSV indistinguibles.
    const header = ['Escenario', dimLabel.singularCap, 'Cumplidos', 'Promedio (min)', 'Mediana (min)', 'P90 (min)', 'Atraso (min)'];
    const rows = data.ranking.map((r) => [escenarioLabel ?? '', r.valor, r.cantidad, r.promedio, r.mediana, r.p90, r.atraso]);
    const periodo = periodValue?.desde ?? data.periodo_sel.desde ?? 'periodo';
    downloadCsv(`metricas-cumplimiento-esc${escenarioSel ?? 'NA'}-${dimension}-${periodo}.csv`, [header, ...rows]);
  }

  return (
    // `h-full overflow-y-auto` y NO `min-h-screen`: el <body> del layout raíz
    // es `overflow-hidden` (app/layout.tsx:42, porque la app es un mapa a
    // pantalla completa), así que cada página tiene que crear su PROPIO
    // contexto de scroll o el contenido queda cortado sin forma de bajar.
    // Mismo patrón que app/dashboard/stats/page.tsx:1196.
    <div data-theme={theme} className="h-full overflow-y-auto bg-stats-background font-stats-sans text-stats-foreground">
      <div className="mx-auto max-w-[1360px] px-4 pb-16 pt-6 sm:px-6">
        {/* ── Header ── */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-stats-primary to-stats-secondary text-white shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 15l4-5 3 3 5-7" />
              </svg>
            </div>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-[1.4rem] font-bold tracking-tight text-stats-foreground">
                Métricas de Cumplimiento
                {/* El escenario acota TODO lo de esta pantalla: se muestra en
                    el título para que nunca haya duda de qué se está mirando. */}
                {escenarioLabel && (
                  <span className="rounded-md border border-stats-primary/40 bg-stats-primary/10 px-2 py-0.5 font-stats-mono text-[0.72rem] font-semibold text-stats-primary">
                    {escenarioLabel}
                  </span>
                )}
              </h1>
              <p className="mt-0.5 text-[0.85rem] text-stats-muted-fg">Tiempo asignado → cumplido · por chofer, móvil y zona</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data?.rango?.max_fecha && (
              <span className="hidden items-center gap-1.5 rounded-md px-1.5 font-stats-mono text-[0.74rem] text-stats-muted-fg sm:inline-flex">
                <span className="h-[7px] w-[7px] rounded-full bg-stats-success" aria-hidden="true" />
                última actualización: {data.rango.max_fecha}
              </span>
            )}
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data}
              aria-label="Exportar CSV"
              title="Exportar CSV"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-stats-border bg-stats-surface text-stats-muted-fg transition-colors hover:border-stats-border/80 hover:text-stats-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="Cambiar tema"
              title="Tema"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-stats-border bg-stats-surface text-stats-muted-fg transition-colors hover:border-stats-border/80 hover:text-stats-foreground"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* ── Error banner ── */}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-stats-destructive/40 bg-stats-destructive-soft px-4 py-3 text-sm text-stats-destructive">
            <span>No se pudieron cargar las métricas: {error.message}</span>
            <button type="button" onClick={refetch} className="shrink-0 rounded-md border border-stats-destructive/40 px-2.5 py-1 text-xs font-semibold hover:bg-stats-destructive/10">
              Reintentar
            </button>
          </div>
        )}

        {/* ── Filtros ── */}
        <FiltersBar
          escenarios={escenarios}
          escenarioSel={escenarioSel}
          onEscenarioChange={handleEscenarioChange}
          empresas={empresas}
          empresaSel={empresaSel}
          onEmpresaChange={setEmpresaSel}
          tiposSel={tiposSel}
          onToggleTipo={toggleTipo}
          ventana={ventana}
          onVentanaChange={handleVentanaChange}
          dimension={dimension}
          onDimensionChange={setDimension}
          rango={data?.rango ?? null}
          periodoSel={data?.periodo_sel ?? { desde: null, hasta: null }}
          periodValue={periodValue}
          onPeriodChange={setPeriodValue}
        />

        {showEmptyScopeBanner && (
          <div className="mt-4 rounded-xl border border-stats-border bg-stats-surface-2 px-4 py-3 text-sm text-stats-muted-fg">
            Sin datos de cumplimiento para <span className="font-semibold text-stats-foreground">{escenarioLabel ?? 'el escenario'}</span> con
            la empresa seleccionada. Verificá que <code className="font-stats-mono">metricas_cumplimiento_run</code> ya corrió para este escenario.
            {/* La RPC devuelve la lista de escenarios aunque el pedido no tenga
                datos, justamente para poder ofrecer la salida acá. */}
            {escenarios.length > 0 && (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <span>Escenarios con datos:</span>
                {escenarios.map((e) => (
                  <button
                    key={e.escenario}
                    type="button"
                    onClick={() => handleEscenarioChange(e.escenario)}
                    className="rounded-md border border-stats-border bg-stats-surface px-2 py-0.5 text-[0.78rem] font-semibold text-stats-foreground transition-colors hover:border-stats-primary hover:text-stats-primary"
                  >
                    {e.nombre}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}

        {/* ── KPIs ── */}
        <div className="mt-4 grid grid-cols-1 gap-3 min-[561px]:grid-cols-2 min-[1081px]:grid-cols-5">
          {isLoading && !data ? (
            Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} delayMs={i * 50} />)
          ) : (
            <>
              <KpiCard
                label="Demora efectiva prom."
                value={kpis?.promedio ?? null}
                unit="min"
                prev={kpisPrev?.promedio ?? null}
                spark={sparkPromedio}
                accent="brand"
                deltaMode="abs"
                goodDirection="down"
                decimals={1}
                infoTitle={INFO_TEXTS.kpi_promedio.title}
                infoText={INFO_TEXTS.kpi_promedio.text}
                animationDelayMs={0}
              />
              <KpiCard
                label="Mediana"
                value={kpis?.mediana ?? null}
                unit="min"
                prev={kpisPrev?.mediana ?? null}
                accent="brand"
                deltaMode="abs"
                goodDirection="down"
                decimals={1}
                infoTitle={INFO_TEXTS.kpi_mediana.title}
                infoText={INFO_TEXTS.kpi_mediana.text}
                animationDelayMs={50}
              />
              <KpiCard
                label="P90"
                value={kpis?.p90 ?? null}
                unit="min"
                prev={kpisPrev?.p90 ?? null}
                spark={sparkP90}
                accent="brand"
                deltaMode="abs"
                goodDirection="down"
                decimals={1}
                infoTitle={INFO_TEXTS.kpi_p90.title}
                infoText={INFO_TEXTS.kpi_p90.text}
                animationDelayMs={100}
              />
              <KpiCard
                label="Cumplidos"
                value={kpis?.cantidad ?? null}
                unit=""
                prev={kpisPrev?.cantidad ?? null}
                spark={sparkCantidad}
                accent="brand"
                deltaMode="pct"
                goodDirection="up"
                decimals={0}
                infoTitle={INFO_TEXTS.kpi_cumplidos.title}
                infoText={INFO_TEXTS.kpi_cumplidos.text}
                animationDelayMs={150}
              />
              <KpiCard
                label="Atraso vs compromiso"
                value={kpis?.promedio_atraso ?? null}
                unit="min"
                prev={kpisPrev?.promedio_atraso ?? null}
                accent="accent"
                deltaMode="abs"
                goodDirection="down"
                decimals={1}
                infoTitle={INFO_TEXTS.kpi_atraso.title}
                infoText={INFO_TEXTS.kpi_atraso.text}
                secondary={kpis?.on_time_pct != null ? `${formatPct(kpis.on_time_pct)} a tiempo` : undefined}
                animationDelayMs={200}
              />
            </>
          )}
        </div>

        {/* ── Charts / ranking / tabla ── */}
        <div className="mt-3.5 grid grid-cols-12 gap-3.5">
          <CardShell
            title="Tendencia · demora efectiva"
            hint="promedio por período · banda p90"
            infoTitle={INFO_TEXTS.tendencia.title}
            infoText={INFO_TEXTS.tendencia.text}
            onExpand={() => setExpandedSection('tendencia')}
            className="col-span-12 min-[1081px]:col-span-8"
            style={{ animationDelay: '80ms' }}
          >
            {isLoading && !data ? <Skeleton className="h-[260px] w-full" /> : <TrendChart serie={serie} ventana={ventana} />}
          </CardShell>

          <CardShell
            title="Por tipo de servicio"
            hint="min prom."
            infoTitle={INFO_TEXTS.por_tipo.title}
            infoText={INFO_TEXTS.por_tipo.text}
            onExpand={() => setExpandedSection('tipo')}
            className="col-span-12 min-[1081px]:col-span-4"
            style={{ animationDelay: '140ms' }}
          >
            {isLoading && !data ? <Skeleton className="h-[230px] w-full" /> : <TipoBarChart porTipo={data?.por_tipo ?? []} />}
          </CardShell>

          <CardShell
            title={`Ranking · ${dimLabel.plural}`}
            hint="demora efectiva prom."
            infoTitle={INFO_TEXTS.ranking.title}
            infoText={INFO_TEXTS.ranking.text}
            onExpand={() => setExpandedSection('ranking')}
            className="col-span-12 min-[1081px]:col-span-5"
            style={{ animationDelay: '200ms' }}
          >
            {isLoading && !data ? <Skeleton className="h-[260px] w-full" /> : <RankingList ranking={data?.ranking ?? []} />}
          </CardShell>

          <CardShell
            title={`Detalle por ${dimLabel.singular}`}
            infoTitle={INFO_TEXTS.tabla.title}
            infoText={INFO_TEXTS.tabla.text}
            onExpand={() => setExpandedSection('tabla')}
            className="col-span-12 min-[1081px]:col-span-7"
            style={{ animationDelay: '260ms' }}
          >
            {isLoading && !data ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <DetalleTable ranking={data?.ranking ?? []} dimensionLabel={dimLabel.singularCap} limit={10} />
            )}
          </CardShell>

          {/* ── Comparativa entre escenarios ──
              Única card que mira FUERA del escenario seleccionado: los mismos
              filtros aplicados a todos los escenarios, para ver cuál viene
              mejor y saltar entre ellos. */}
          <CardShell
            title="Comparativa entre escenarios"
            hint="mismos filtros · todos los escenarios"
            infoTitle={INFO_TEXTS.comparativa.title}
            infoText={INFO_TEXTS.comparativa.text}
            onExpand={() => setExpandedSection('escenarios')}
            className="col-span-12"
            style={{ animationDelay: '320ms' }}
          >
            {isLoading && !data ? (
              <Skeleton className="h-[140px] w-full" />
            ) : (
              <EscenarioComparativa
                comparativa={data?.comparativa ?? []}
                escenarioSel={escenarioSel}
                onEscenarioChange={handleEscenarioChange}
              />
            )}
          </CardShell>

          {/* ── Evolución del día EN VIVO ──
              La sala de control de HOY: se refresca sola cada 60 s y por
              cada corrida deja una fila en la línea de tiempo (motor,
              Despacho, fases del arranque y cumplimiento acumulado). */}
          <CardShell
            title="Evolución del día"
            hint="EN VIVO · se actualiza sola cada 60 s"
            infoTitle="Evolución del día"
            infoText="Cada corrida del motor (10 min) deja su fila: qué publicó el motor y qué tenía el Despacho, cuántas zonas estaban en cada fase del arranque predictivo, y el % ≤25' acumulado del día calculado en vivo desde los pedidos entregados (la promesa del motor es la de la corrida vigente a la toma)."
            onExpand={() => setExpandedSection('evolucion')}
            className="col-span-12"
            style={{ animationDelay: '360ms' }}
          >
            <EvolucionDiaCard escenario={escenarioSel} empresaSel={empresaSel} isRoot={unrestricted} empresasIds={empresasIdsForHeader} funcionalidades={funcionalidades} />
          </CardShell>

          {/* ── Demora informada vs. calculada ──
              Última card: mira un dato distinto del resto de la pantalla
              (demora prospectiva, no cumplimiento histórico). */}
          <CardShell
            title="Demora calculada vs. informada"
            hint="cada 10 min · por zona"
            infoTitle={INFO_TEXTS.demora_comparativa.title}
            infoText={INFO_TEXTS.demora_comparativa.text}
            onExpand={() => setExpandedSection('demora')}
            className="col-span-12"
            style={{ animationDelay: '380ms' }}
          >
            <DemoraComparativa escenario={escenarioSel} isRoot={unrestricted} empresasIds={empresasIdsForHeader} funcionalidades={funcionalidades} />
          </CardShell>

          {/* ── Acierto de la demora ──
              La réplica de la planilla manual: franjas de desfasaje entre lo
              proyectado (AS400 / motor) y lo real, por pedido entregado. */}
          <CardShell
            title="Acierto de la demora"
            hint="franjas de 5 min · por pedido entregado"
            infoTitle={INFO_TEXTS.desfasaje.title}
            infoText={INFO_TEXTS.desfasaje.text}
            onExpand={() => setExpandedSection('desfasaje')}
            className="col-span-12"
            style={{ animationDelay: '420ms' }}
          >
            <DesfasajeCard escenario={escenarioSel} empresaSel={empresaSel} isRoot={unrestricted} empresasIds={empresasIdsForHeader} funcionalidades={funcionalidades} />
          </CardShell>

          {/* ── Análisis del acierto ──
              Las aperturas del informe semanal, vivas: por día (Despacho vs
              motor con veredicto), por hora de la toma, peores zonas y
              peores incumplimientos — con filtro por día (click en la fila). */}
          <CardShell
            title="Análisis del acierto"
            hint="dónde y cuándo falla · click en un día para filtrar"
            infoTitle="Análisis del acierto"
            infoText="Compara el Despacho y el motor sobre los MISMOS pedidos, día por día, y autopsia la proyección elegida por hora de la toma, por zona (con su lectura) y por peores casos. El sesgo es la mediana del desfasaje con signo: negativo = se llega antes de lo prometido."
            onExpand={() => setExpandedSection('analisis')}
            className="col-span-12"
            style={{ animationDelay: '460ms' }}
          >
            <DesfasajeAnalisis escenario={escenarioSel} empresaSel={empresaSel} isRoot={unrestricted} empresasIds={empresasIdsForHeader} funcionalidades={funcionalidades} />
          </CardShell>
        </div>

        <div className="mt-4 text-[0.76rem] text-stats-muted-fg">
          Datos de <span className="font-stats-mono">metricas_cumplimiento</span> (actualización nocturna, no en vivo). KPIs con percentiles
          exactos (percentile_cont) calculados directo sobre los hechos.
        </div>
      </div>

      {/* ── E2: modal de ampliación ── */}
      <ExpandModal
        open={expandedSection !== null}
        onClose={() => setExpandedSection(null)}
        title={
          expandedSection === 'tendencia'
            ? 'Tendencia · demora efectiva'
            : expandedSection === 'tipo'
              ? 'Por tipo de servicio'
              : expandedSection === 'ranking'
                ? `Ranking · ${dimLabel.plural}`
                : expandedSection === 'escenarios'
                  ? 'Comparativa entre escenarios'
                  : expandedSection === 'demora'
                    ? 'Demora calculada vs. informada'
                    : expandedSection === 'desfasaje'
                      ? 'Acierto de la demora'
                      : expandedSection === 'analisis'
                        ? 'Análisis del acierto'
                        : expandedSection === 'evolucion'
                          ? 'Evolución del día — en vivo'
                          : `Detalle por ${dimLabel.singular}`
        }
      >
        {data && expandedSection === 'tendencia' && (
          <div className="space-y-5">
            <TrendChart key="expand-trend" serie={serie} ventana={ventana} height={380} />
            <SerieTable serie={serie} ventana={ventana} />
          </div>
        )}
        {data && expandedSection === 'tipo' && (
          <div className="space-y-5">
            <TipoBarChart key="expand-tipo" porTipo={data.por_tipo} height={360} />
            <PorTipoTable porTipo={data.por_tipo} />
          </div>
        )}
        {data && expandedSection === 'ranking' && (
          <div className="space-y-5">
            <RankingList ranking={data.ranking} limit={15} />
            <div className="border-t border-stats-border pt-4">
              <DetalleTable ranking={data.ranking} dimensionLabel={dimLabel.singularCap} />
            </div>
          </div>
        )}
        {data && expandedSection === 'tabla' && <DetalleTable ranking={data.ranking} dimensionLabel={dimLabel.singularCap} />}
        {data && expandedSection === 'escenarios' && (
          <EscenarioComparativa
            comparativa={data.comparativa}
            escenarioSel={escenarioSel}
            onEscenarioChange={(id) => {
              handleEscenarioChange(id);
              setExpandedSection(null); // cambiar de escenario recarga todo: el modal ya no aplica
            }}
          />
        )}
        {expandedSection === 'demora' && (
          <DemoraComparativa escenario={escenarioSel} isRoot={unrestricted} empresasIds={empresasIdsForHeader} funcionalidades={funcionalidades} />
        )}
        {expandedSection === 'desfasaje' && (
          <DesfasajeCard
            escenario={escenarioSel}
            empresaSel={empresaSel}
            isRoot={unrestricted}
            empresasIds={empresasIdsForHeader}
            funcionalidades={funcionalidades}
            height={380}
          />
        )}
        {expandedSection === 'analisis' && (
          <DesfasajeAnalisis
            escenario={escenarioSel}
            empresaSel={empresaSel}
            isRoot={unrestricted}
            empresasIds={empresasIdsForHeader}
            funcionalidades={funcionalidades}
          />
        )}
        {expandedSection === 'evolucion' && (
          <EvolucionDiaCard
            escenario={escenarioSel}
            empresaSel={empresaSel}
            isRoot={unrestricted}
            empresasIds={empresasIdsForHeader}
            funcionalidades={funcionalidades}
          />
        )}
      </ExpandModal>
    </div>
  );
}

export default function MetricasCumplimientoPage() {
  return (
    <ProtectedRoute>
      <MetricasCumplimientoContent />
    </ProtectedRoute>
  );
}
