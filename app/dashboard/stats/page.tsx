'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { canSeeAllEmpresas, isRoot } from '@/lib/auth-scope';
import { resolveLandingRoute } from '@/lib/role-attributes';
import { useSearchParams } from 'next/navigation';
import {
  computeDelayMinutes,
  bucketAtrasoPendiente,
  bucketAtrasoFinalizado,
  BUCKETS_PENDIENTE_ORDEN,
  BUCKETS_FINALIZADO_ORDEN,
} from '@/utils/pedidoDelay';
import type { BucketRow } from '@/components/stats/GraficosInlineSection';
import { GraficosInlineSection } from '@/components/stats/GraficosInlineSection';
import { BarChart, type StackRow } from '@/components/stats/Charts';
import { isPedidoEntregado, isServiceEntregado } from '@/utils/estadoPedido';
import { isMovilActiveForUI } from '@/lib/moviles/visibility';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { todayMontevideo, pendienteDateRangeCompact } from '@/lib/date-utils';
import { msUntilNextRollover } from '@/lib/kiosk';
import { useServerTime } from '@/hooks/useServerTime';
import { useEscenarioSettings } from '@/hooks/useEscenarioSettings';
import { isWithinSaWindow } from '@/lib/sa-window-filter';
import { hasSaAcumulados, hasFuncionalidad } from '@/lib/role-funcionalidades';
import {
  exportCardPdf,
  exportCardExcel,
  sectionFromValuePct,
  sectionFromStackRows,
  sectionFromBucketRows,
  type CardExportModel,
} from '@/lib/stats-export';

// ─── Tipos mínimos para este módulo ───────────────────────────────────────────
interface Pedido {
  pedido_id: number;
  estado_nro: number | string;
  sub_estado_nro?: number | string | null;
  sub_estado_desc?: string | null;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
  fch_para?: string;
  zona_nro?: number | string | null;
  fch_hora_max_ent_comp?: string | null;
  fch_hora_mov?: string | null;
  fch_hora_finalizacion?: string | null;
  pedido_hijo?: number | null;
  producto_cod?: string | null;
  atraso_cump_mins?: number | null;
}
interface Service {
  service_id: number;
  estado_nro?: number | string;
  sub_estado_nro?: number | string | null;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
  fch_hora_max_ent_comp?: string | null;
  fch_hora_finalizacion?: string | null;
}
interface Empresa {
  empresa_fletera_id: number;
  nombre: string;
}
interface Movil {
  nro: number;
  empresa_fletera_id: number;
  empresa_fletera_nom: string | null;
  tamanoLote: number;
  estadoNro: number | null;
  pedidosAsignados: number;
}
// Mismo criterio que el sidebar: activo = estadoNro null/undefined/0/1/2

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[parseInt(m) - 1]} ${y}`;
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return 'cargando…';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'recién';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}


function getEmpresaNombre(p: { movil?: unknown; empresa_fletera_id?: unknown }, movilEmpresa: Map<number, string>, empresas: Map<number, string>): string {
  const movilNro = p.movil != null ? Number(p.movil) : null;
  if (movilNro && movilNro !== 0 && movilEmpresa.has(movilNro)) return movilEmpresa.get(movilNro)!;
  const empId = p.empresa_fletera_id != null ? Number(p.empresa_fletera_id) : null;
  if (!empId || empId === 0) return 'Sin empresa';
  return empresas.has(empId) ? empresas.get(empId)! : `Empresa ${empId}`;
}

// Tonos KPI tokenizados — funcionan en light y dark via [data-theme].
// Cada tono define superficie suave + borde + color de texto del numero.
const KPI_TONES: Record<string, { surface: string; border: string; text: string }> = {
  green:  { surface: 'bg-stats-success-soft dark:bg-stats-success/15',         border: 'border-stats-success/40',     text: 'text-stats-success' },
  blue:   { surface: 'bg-stats-info-soft dark:bg-stats-info/15',               border: 'border-stats-info/40',        text: 'text-stats-info' },
  orange: { surface: 'bg-stats-warning-soft dark:bg-stats-warning/15',         border: 'border-stats-warning/40',     text: 'text-stats-warning' },
  red:    { surface: 'bg-stats-destructive-soft dark:bg-stats-destructive/15', border: 'border-stats-destructive/40', text: 'text-stats-destructive' },
  purple: { surface: 'bg-stats-info-soft dark:bg-stats-info/10',               border: 'border-stats-info/30',        text: 'text-stats-info' },
  gray:   { surface: 'bg-stats-neutral-soft dark:bg-white/5',                  border: 'border-stats-border dark:border-white/10', text: 'text-stats-foreground dark:text-white' },
};

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  const t = KPI_TONES[color] ?? KPI_TONES.gray;
  return (
    <div
      className={`relative rounded-xl border p-3.5 backdrop-blur-sm transition-colors hover:shadow-sm ${t.surface} ${t.border}`}
    >
      {/* Accent bar a la izquierda — refuerza la jerarquia de color sin saturar */}
      <span aria-hidden className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-r ${t.text.replace('text-', 'bg-')}`} />
      <p className="text-[10px] uppercase tracking-wider text-stats-muted-fg dark:text-gray-400 mb-1 pl-1.5">{label}</p>
      <p className={`text-2xl font-bold leading-none font-stats-mono tabular-nums pl-1.5 ${t.text}`}>{value}</p>
      {sub && <p className="text-[11px] text-stats-muted-fg dark:text-gray-400 mt-1 pl-1.5">{sub}</p>}
    </div>
  );
}

// Skeleton para los KPI cards mientras carga. Mantiene la grilla "estable"
// (no hay layout shift cuando termina la carga).
function KpiSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-stats-border dark:border-white/10 bg-stats-surface-2 dark:bg-white/5 p-3.5 animate-pulse"
          aria-hidden
        >
          <div className="h-2.5 w-16 rounded bg-stats-border dark:bg-white/10 mb-3" />
          <div className="h-6 w-12 rounded bg-stats-border dark:bg-white/15 mb-2" />
          <div className="h-2 w-20 rounded bg-stats-border dark:bg-white/10" />
        </div>
      ))}
    </div>
  );
}

// Icono pequeno (16x16) por categoria de card. SVG inline para no agregar deps.
// Familia: outline 1.5px stroke, lucide-style.
const CARD_ICONS = {
  clock: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>,
  grid: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  building: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="15" y1="6" x2="15" y2="6" /><line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" /><path d="M10 22V18h4v4" /></svg>,
  truck: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h13v13H1z" /><polygon points="14 8 18 8 21 11 21 16 14 16 14 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /></svg>,
  pin: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  alert: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
} as const;

type CardIconName = keyof typeof CARD_ICONS;

// ─── Botones de export (PDF / Excel) por card ────────────────────────────────
function CardExportButtons({
  getNode,
  buildModel,
  fechaLabel,
}: {
  getNode: () => HTMLElement | null;
  buildModel: () => CardExportModel | null;
  fechaLabel?: string;
}) {
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx'>(null);

  const run = async (kind: 'pdf' | 'xlsx') => {
    const node = getNode();
    const model = buildModel();
    if (!node || !model) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') await exportCardPdf(node, model, fechaLabel);
      else await exportCardExcel(node, model, fechaLabel);
    } catch (e) {
      console.error('[stats-export] error exportando', kind, e);
    } finally {
      setBusy(null);
    }
  };

  const btnBase =
    'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold leading-none border transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info disabled:opacity-50 disabled:cursor-wait';
  const pdfCls =
    `${btnBase} text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-300 dark:border-red-500/40 dark:bg-red-500/10 dark:hover:bg-red-500/20`;
  const xlsCls =
    `${btnBase} text-green-700 border-green-300 bg-green-50 hover:bg-green-100 dark:text-green-300 dark:border-green-500/40 dark:bg-green-500/10 dark:hover:bg-green-500/20`;

  const fileIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => run('pdf')} disabled={busy !== null} className={pdfCls} title="Descargar PDF" aria-label="Descargar PDF">
        {fileIcon}
        <span>{busy === 'pdf' ? '...' : 'PDF'}</span>
      </button>
      <button onClick={() => run('xlsx')} disabled={busy !== null} className={xlsCls} title="Descargar Excel" aria-label="Descargar Excel">
        {fileIcon}
        <span>{busy === 'xlsx' ? '...' : 'Excel'}</span>
      </button>
    </div>
  );
}

// ─── Tarjeta expandible ───────────────────────────────────────────────────────
function ExpandableCard({ title, icon, children, expandedChildren, exportModel, fechaLabel }: { title: string; icon?: CardIconName; children: React.ReactNode; expandedChildren?: React.ReactNode; exportModel?: () => CardExportModel | null; fechaLabel?: string }) {
  const [expanded, setExpanded] = useState(false);
  const iconNode = icon ? CARD_ICONS[icon] : null;
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto py-8 px-4 stats-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div className="w-full max-w-5xl stats-modal-content">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold tracking-tight text-stats-foreground dark:text-white flex items-center gap-2.5">
                {iconNode && <span className="text-stats-muted-fg dark:text-gray-400">{iconNode}</span>}
                {title}
              </h3>
              <button
                onClick={() => setExpanded(false)}
                className="p-2 rounded-xl transition-all duration-200 group text-stats-muted-fg hover:text-stats-foreground hover:bg-stats-surface-2 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
                title="Cerrar"
                aria-label="Cerrar tarjeta expandida"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:rotate-90 transition-transform duration-200" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="text-sm">{expandedChildren ?? children}</div>
          </div>
        </div>
      )}
      <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 hover:-translate-y-px hover:shadow-md dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40 dark:hover:bg-white/[0.07]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-stats-foreground dark:text-gray-200 flex items-center gap-2">
            {iconNode && <span className="text-stats-info">{iconNode}</span>}
            {title}
          </h3>
          <div className="flex items-center gap-1">
            {exportModel && (
              <CardExportButtons getNode={() => contentRef.current} buildModel={exportModel} fechaLabel={fechaLabel} />
            )}
            <button
              onClick={() => setExpanded(true)}
              className="p-1 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 text-stats-muted-fg hover:text-stats-foreground hover:bg-stats-surface-2 dark:text-gray-500 dark:hover:text-white dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
              title="Expandir"
              aria-label="Expandir tarjeta"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        <div ref={contentRef}>{children}</div>
      </div>
    </>
  );
}

// ─── Bloque revelado (móviles/zona/empresa) con export ────────────────────────
function RevealChartBlock({
  title,
  icon,
  stackedData,
  pendientesData,
  finalizadosData,
  fechaLabel,
  labelCol,
}: {
  title: string;
  icon: CardIconName;
  stackedData: StackRow[];
  pendientesData: BucketRow[];
  finalizadosData: BucketRow[];
  fechaLabel?: string;
  labelCol: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buildModel = (): CardExportModel => ({
    title,
    subtitle: `${stackedData.length} ${labelCol.toLowerCase()}s con actividad`,
    sections: [
      sectionFromStackRows('Volumen (entregados / no entregados / pendientes)', labelCol, stackedData),
      sectionFromBucketRows('Pendientes por atraso', labelCol, pendientesData, BUCKETS_PENDIENTE_ORDEN),
      sectionFromBucketRows('Finalizados por atraso', labelCol, finalizadosData, BUCKETS_FINALIZADO_ORDEN),
    ],
  });
  return (
    <div className="col-span-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-stats-foreground dark:text-gray-200 flex items-center gap-2">
          <span className="text-stats-info">{CARD_ICONS[icon]}</span>
          {title}
        </h3>
        <CardExportButtons getNode={() => ref.current} buildModel={buildModel} fechaLabel={fechaLabel} />
      </div>
      <div ref={ref}>
        <GraficosInlineSection
          stackedData={stackedData}
          pendientesData={pendientesData}
          finalizadosData={finalizadosData}
        />
      </div>
    </div>
  );
}

// ─── Contenido principal ──────────────────────────────────────────────────────
function StatsContent() {
  const searchParams = useSearchParams();
  const date = searchParams.get('date') ?? todayMontevideo();
  const { user, escenarioId, isKiosko } = useAuth();
  // Botón "Abrir mapa": solo para usuarios cuya pantalla de inicio es stats
  // (PantallaLogin=stats). Estos no ven el mapa por defecto, así que les damos un
  // acceso rápido a abrirlo en otra pestaña. Reusa el helper de landing (single
  // source of truth). Usuario normal (que arranca en el mapa) no ve el botón.
  const showMapButton = resolveLandingRoute(user) === '/dashboard/stats';
  // Gate: puede ver sin-asignar — controlado únicamente por la funcionalidad 'Ped s/asignar acumulados'.
  // Root siempre puede. El rol del usuario ya no condiciona esta visibilidad.
  const canSeeUnassigned = isRoot(user) || hasSaAcumulados(user?.roles);
  const isPrivilegedScope = canSeeAllEmpresas(user);
  // Gates por card de la fila 2 — SIN bypass de root (decisión: respetar la
  // funcionalidad aunque el usuario sea root):
  //   - 'Estadist.GlobalxMovil' → Top móviles por entregas
  //   - 'Estadist.GlobalxZona'  → Pedidos por zona
  //   - 'Estadist.GlobalxEF'    → Pedidos por empresa (EF = empresa fletera)
  const canSeeStatsMovil = hasFuncionalidad(user?.roles, 'Estadist.GlobalxMovil');
  const canSeeStatsZona = hasFuncionalidad(user?.roles, 'Estadist.GlobalxZona');
  const canSeeStatsEmpresa = hasFuncionalidad(user?.roles, 'Estadist.GlobalxEF');
  const { serverNow } = useServerTime();
  const { settings: escenarioSettings } = useEscenarioSettings(escenarioId);
  const minutosAntesSa = escenarioSettings?.pedidosSaMinutosAntes ?? null;

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [empresas, setEmpresas] = useState<Map<number, string>>(new Map());
  // Mapa movilNro → nombre de empresa (obtenido del join moviles → empresa_fletera)
  const [movilEmpresa, setMovilEmpresa] = useState<Map<number, string>>(new Map());
  const [movilesRaw, setMovilesRaw] = useState<Movil[]>([]);
  // Set de IDs de móviles con GPS vigente (INNER JOIN gps_latest_positions)
  const [movilesConGps, setMovilesConGps] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>('Todas');
  const [selectedProducto, setSelectedProducto] = useState<string>('Todos');
  const [refreshSeconds, setRefreshSeconds] = useState<number>(60);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [zonasNoActivasCount, setZonasNoActivasCount] = useState<number | null>(null);
  const [zonasSinMovilCount, setZonasSinMovilCount] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  // Theme dark/light. Default dark (era el unico valor antes). Persistencia
  // en localStorage scoped a esta pantalla — toggle solo afecta /dashboard/stats.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  // Modal states para las 3 tarjetas de porcentaje por entidad
  const [showEmpresa, setShowEmpresa] = useState(false);
  const [showMoviles, setShowMoviles] = useState(false);
  const [showZona, setShowZona] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('stats-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('stats-theme', theme);
  }, [theme]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Auth scope para /api/pedidos y /api/services
        // Ambos endpoints usan fail-closed server-side:
        //   Si x-track-isroot != S y empresas_fleteras ausente devuelve [].
        // Patron identico al de app/dashboard/page.tsx (fetchPedidos/fetchServices).
        const isRootUser = isRoot(user);
        // Header x-track-isroot efectivo: 'S' para acceso total no-root (rol Despacho o
        // "Ver todas las empresas", señalados por allowedEmpresas == null). Sin esto, esos
        // usuarios mandaban 'N' sin empresas y el server hacía fail-closed -> []. Mismo
        // criterio que app/dashboard/page.tsx (isRootHeader).
        const hasFullEmpresaAccess = !!user && (isRootUser || user.allowedEmpresas == null);
        const isRootHeader: 'S' | 'N' = hasFullEmpresaAccess ? 'S' : 'N';
        const authHeaders: Record<string, string> = {
          'x-track-isroot': isRootHeader,
          'x-track-funcs': (user?.roles ?? []).flatMap(r => (r.funcionalidades ?? []).map(f => f.nombre)).join(','),
        };
        const pedidosParams = new URLSearchParams({ fecha: date });
        const servicesParams = new URLSearchParams({ fecha: date });
        if (escenarioId != null) {
          pedidosParams.set('escenario', String(escenarioId));
          servicesParams.set('escenario', String(escenarioId));
        }
        if (!isRootUser && user?.allowedEmpresas && user.allowedEmpresas.length > 0) {
          const empresasStr = user.allowedEmpresas.join(',');
          pedidosParams.set('empresas_fleteras', empresasStr);
          servicesParams.set('empresas_fleteras', empresasStr);
        }

        const [pRes, sRes, eRes, mRes, gRes] = await Promise.all([
          fetch(`/api/pedidos?${pedidosParams.toString()}`, { headers: authHeaders }),
          fetch(`/api/services?${servicesParams.toString()}`, { headers: authHeaders }),
          fetch(`/api/empresas`),
          fetch(`/api/moviles-extended`),
          fetch(`/api/all-positions`),
        ]);
        const [pData, sData, eData, mData, gData] = await Promise.all([pRes.json(), sRes.json(), eRes.json(), mRes.json(), gRes.json()]);
        setPedidos(pData.data ?? pData ?? []);
        setServices(sData.data ?? sData ?? []);
        // Mapa empresa_fletera_id → nombre
        const eMap = new Map<number, string>();
        (eData.data ?? []).forEach((e: Empresa) => eMap.set(e.empresa_fletera_id, e.nombre));
        setEmpresas(eMap);
        // Mapa movilNro → nombre empresa (via join movil → empresa_fletera)
        const mMap = new Map<number, string>();
        (mData.data ?? []).forEach((m: Movil) => {
          if (m.nro != null) {
            const nombre = (m.empresa_fletera_id && m.empresa_fletera_id !== 0)
              ? (eMap.get(m.empresa_fletera_id) ?? `Empresa ${m.empresa_fletera_id}`)
              : 'Sin empresa';
            mMap.set(m.nro, nombre);
          }
        });
        setMovilEmpresa(mMap);
        setMovilesRaw(mData.data ?? []);
        // Set de IDs con GPS vigente (equivalente al INNER JOIN gps_latest_positions)
        const gpsIds = new Set<string>((gData.data ?? []).map((g: { movilId: number }) => String(g.movilId)));
        setMovilesConGps(gpsIds);
        setLastUpdatedAt(new Date());
      } catch (e) {
        setError('Error al cargar los datos');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [date, refreshTick, user, escenarioId]);

  // ─── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const id = setInterval(() => setRefreshTick(t => t + 1), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds]);

  // ─── Fetch data for zone indicators ────────────────────────────────────────
  useEffect(() => {
    const loadZoneData = async () => {
      try {
        // ── Calcular empresaIds efectivos para el scope del usuario ──
        // Misma lógica que effectiveEmpresas en useScopedZonaIds.
        //   - Privilegiado + "Todas"          → null (sin filtro)
        //   - Privilegiado + empresa concreta → [id de esa empresa]
        //   - No privilegiado + "Todas"       → allowedEmpresas
        //   - No privilegiado + empresa concreta → [id de esa empresa]
        let empresaIds: number[] | null = null;
        if (selectedEmpresa !== 'Todas') {
          // Empresa concreta seleccionada: buscar su ID en el mapa nombre→id
          const empresaId = Array.from(empresas.entries())
            .find(([, nombre]) => nombre === selectedEmpresa)?.[0] ?? null;
          empresaIds = empresaId !== null ? [empresaId] : [];
        } else if (!isPrivilegedScope) {
          // No privilegiado con "Todas": limitar a sus allowedEmpresas
          empresaIds = user?.allowedEmpresas ?? [];
        }
        // Construir query param (omitir si null = sin filtro)
        const empresaParam = empresaIds !== null && empresaIds.length > 0
          ? `?empresaIds=${empresaIds.join(',')}`
          : '';

        const [demorasRes, zonasRes, mzRes] = await Promise.all([
          fetch(`/api/demoras${empresaParam}`),
          fetch(`/api/zonas${empresaParam}`),
          fetch(`/api/moviles-zonas${empresaParam}`),
        ]);
        const [demorasData, zonasData, mzData] = await Promise.all([
          demorasRes.json(),
          zonasRes.json(),
          mzRes.json(),
        ]);

        // ── Mapa de demoras: zona_id → registro con mayor minutos (igual que DashboardIndicators) ──
        const dMap = new Map<number, { minutos: number; activa: boolean }>();
        if (demorasData.success && Array.isArray(demorasData.data)) {
          for (const d of demorasData.data) {
            const existing = dMap.get(d.zona_id);
            if (!existing || d.minutos > existing.minutos) {
              dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
            }
          }
        }

        // ── Zonas No Activas: solo zonas reales (con geojson) donde activa===false ──
        if (zonasData.success && Array.isArray(zonasData.data)) {
          const allZonasReal: { zona_id: number }[] = (zonasData.data || []).filter((z: any) => z.geojson);
          const noActivas = allZonasReal.filter(z => {
            const info = dMap.get(z.zona_id);
            return info !== undefined && info.activa === false;
          }).length;
          setZonasNoActivasCount(noActivas);
        }

        // ── Zonas Sin Móvil (tipo URGENTE, excluyendo zonas no activas) ──
        if (zonasData.success && mzData.success) {
          const allZonas: { zona_id: number }[] = (zonasData.data || []).filter((z: any) => z.geojson);

          // Mapa movil_id (string) → estadoNro, construido desde movilesRaw ya cargados.
          // Criterio inclusivo: undefined = activo (optimista), isMovilActiveForUI incluye BAJA MOMENTÁNEA (4).
          // Si movilesRaw está vacío → no se construye el map y no se filtra (evita falsos "sin móvil" durante carga).
          const movilEstadosMap = new Map<string, number | null>();
          for (const m of movilesRaw) {
            movilEstadosMap.set(String(m.nro), m.estadoNro ?? null);
          }

          // Filtrar moviles-zonas por tipo URGENTE y por estado activo (inclusivo)
          const movilesZonas = (mzData.data || []).filter((mz: any) => {
            if ((mz.tipo_de_servicio || '').toUpperCase() !== 'URGENTE') return false;
            if (movilEstadosMap.size === 0) return true; // estados aún no cargados → asumir activo
            const key = String(mz.movil_id);
            if (!movilEstadosMap.has(key)) return true; // estado desconocido → asumir activo
            const estado = movilEstadosMap.get(key);
            return estado === null || estado === undefined || isMovilActiveForUI(estado);
          });

          // Conteos por zona
          const zonaCounts = new Map<number, { prioridad: number; transito: number }>();
          for (const mz of movilesZonas) {
            const existing = zonaCounts.get(mz.zona_id) || { prioridad: 0, transito: 0 };
            if (mz.prioridad_o_transito === 1) existing.prioridad++;
            else existing.transito++;
            zonaCounts.set(mz.zona_id, existing);
          }

          // Zonas sin móvil excluyendo zonas no activas
          const sinMovil = allZonas.filter((z) => {
            const dInfo = dMap.get(z.zona_id);
            if (dInfo && dInfo.activa === false) return false;
            const counts = zonaCounts.get(z.zona_id);
            return !counts || (counts.prioridad === 0 && counts.transito === 0);
          }).length;
          setZonasSinMovilCount(sinMovil);
        }
      } catch {
        // si falla, simplemente no mostramos el dato
      }
    };
    loadZoneData();
  }, [refreshTick, selectedEmpresa, isPrivilegedScope, user?.allowedEmpresas, empresas, movilesRaw]);

  // ─── Opciones de empresa (para el filtro) ──────────────────────────────────
  // Opciones del combo Empresa:
  //   - Privilegiados (root/despacho/dashboard/supervisor) → todas las empresas.
  //   - Distribuidores → solo las empresas en allowedEmpresas.
  const empresaOptions = useMemo(() => {
    const allNombres = Array.from(empresas.entries()); // [id, nombre][]
    if (isPrivilegedScope) {
      return allNombres.map(([, nombre]) => nombre).sort();
    }
    // Distribuidor: filtrar por allowedEmpresas
    const allowed = new Set(user?.allowedEmpresas ?? []);
    return allNombres
      .filter(([id]) => allowed.has(id))
      .map(([, nombre]) => nombre)
      .sort();
  }, [empresas, isPrivilegedScope, user?.allowedEmpresas]);

  // ─── Pedidos filtrados por empresa y producto ─────────────────────────────
  // Distribuidores: cuando selectedEmpresa='Todas' solo ven sus allowedEmpresas.
  const filteredPedidos = useMemo(() => {
    // Filtro asimétrico de arrastre: alineado con pedidosCompletos en dashboard/page.tsx.
    // Cuando es hoy: acepta fch_para=hoy (cualquier estado), fch_para=ayer solo si
    // estado_nro===1 (pendiente arrastrado), o fch_hora_para que cae en hoy.
    // Para días pasados: solo fch_para === fechaCompact.
    // pendienteDateRangeCompact devuelve [hoy, ayer] si date===hoy, [date] si es pasado.
    const dateRange = pendienteDateRangeCompact(date);
    const fechaCompact = dateRange[0];   // siempre la fecha principal
    const ayerCompact = dateRange[1];    // definido solo cuando date === hoy
    const hasArrastre = dateRange.length === 2;
    let result = pedidos.filter(p => {
      const fchParaStr = p.fch_para != null ? String(p.fch_para).replace(/-/g, '') : null;
      const fchHoraParaInDate = p.fch_hora_para
        ? String(p.fch_hora_para).startsWith(date)
        : false;
      if (fchParaStr === fechaCompact) return true;
      if (fchHoraParaInDate) return true;
      if (hasArrastre && fchParaStr === ayerCompact && Number(p.estado_nro) === 1) return true;
      // Si no tiene ninguno de los dos campos, incluir (consistente con dashboard)
      if (!p.fch_para && !p.fch_hora_para) return true;
      return false;
    });
    if (selectedEmpresa !== 'Todas') {
      // Filtro por empresa seleccionada explícitamente
      result = result.filter(p => getEmpresaNombre(p, movilEmpresa, empresas) === selectedEmpresa);
    } else if (!isPrivilegedScope) {
      // Distribuidor con "Todas" → limitar a allowedEmpresas
      const allowedIds = new Set(user?.allowedEmpresas ?? []);
      const allowedNombres = new Set(
        Array.from(empresas.entries())
          .filter(([id]) => allowedIds.has(id))
          .map(([, nombre]) => nombre)
      );
      result = result.filter(p => {
        // Los SA (estado=1 sin móvil) tienen empresa=0 → getEmpresaNombre daría
        // "Sin empresa" y quedarían fuera. Ya vienen zona-scoped del server, así
        // que se dejan pasar (el gate canSeeUnassigned los recorta más abajo si
        // el usuario no tiene la funcionalidad).
        const esSA = Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0);
        if (esSA) return true;
        const nombre = getEmpresaNombre(p, movilEmpresa, empresas);
        return allowedNombres.has(nombre);
      });
    }
    if (selectedProducto !== 'Todos')
      result = result.filter(p => String(p.producto_cod ?? '') === selectedProducto);
    // Usuarios sin la funcionalidad no ven pedidos sin asignar (movil=0)
    if (!canSeeUnassigned)
      result = result.filter(p => !(Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0)));
    return result;
  }, [pedidos, date, selectedEmpresa, selectedProducto, movilEmpresa, empresas, isPrivilegedScope, canSeeUnassigned, user?.allowedEmpresas]);

  // ─── Services filtrados por empresa ────────────────────────────────────────
  // Misma lógica de scope que filteredPedidos pero sin filtro de producto.
  const filteredServices = useMemo(() => {
    if (selectedEmpresa !== 'Todas') {
      return services.filter(s => {
        const empId = s.empresa_fletera_id != null ? Number(s.empresa_fletera_id) : null;
        const movilNro = s.movil != null ? Number(s.movil) : null;
        const nombre = (movilNro && movilNro !== 0 && movilEmpresa.has(movilNro))
          ? movilEmpresa.get(movilNro)!
          : (empId && empId !== 0 && empresas.has(empId) ? empresas.get(empId)! : 'Sin empresa');
        return nombre === selectedEmpresa;
      });
    }
    if (!isPrivilegedScope) {
      // Distribuidor con "Todas" → limitar a allowedEmpresas
      const allowedIds = new Set(user?.allowedEmpresas ?? []);
      const allowedNombres = new Set(
        Array.from(empresas.entries())
          .filter(([id]) => allowedIds.has(id))
          .map(([, nombre]) => nombre)
      );
      return services.filter(s => {
        // SA (estado=1 sin móvil, empresa=0) ya vienen zona-scoped del server.
        const esSA = Number(s.estado_nro) === 1 && (!s.movil || Number(s.movil) === 0);
        if (esSA) return true;
        const empId = s.empresa_fletera_id != null ? Number(s.empresa_fletera_id) : null;
        const movilNro = s.movil != null ? Number(s.movil) : null;
        const nombre = (movilNro && movilNro !== 0 && movilEmpresa.has(movilNro))
          ? movilEmpresa.get(movilNro)!
          : (empId && empId !== 0 && empresas.has(empId) ? empresas.get(empId)! : 'Sin empresa');
        return allowedNombres.has(nombre);
      });
    }
    // Usuarios sin la funcionalidad no ven services sin asignar
    if (!canSeeUnassigned) {
      return services.filter(s => !(Number(s.estado_nro) === 1 && (!s.movil || Number(s.movil) === 0)));
    }
    return services;
  }, [services, selectedEmpresa, movilEmpresa, empresas, isPrivilegedScope, canSeeUnassigned, user?.allowedEmpresas]);

  // ─── KPIs Pedidos ──────────────────────────────────────────────────────────
  const pedidosStats = useMemo(() => {
    // filteredPedidos ya excluye sinAsignar para usuarios sin la funcionalidad (canSeeUnassigned=false)
    const total = filteredPedidos.length;
    const finalizados = filteredPedidos.filter(p => Number(p.estado_nro) === 2);
    // Excluir pedidos hijo (re-entregas) del % entregados
    const finalizadosSinHijo = finalizados.filter(p => !p.pedido_hijo);
    const entregados = finalizadosSinHijo.filter(p => isPedidoEntregado(p));
    const noEntregados = finalizadosSinHijo.filter(p => !isPedidoEntregado(p));
    // sinAsignar solo visible si tiene la funcionalidad (distribuidor ya los tiene excluidos)
    const sinAsignar = filteredPedidos.filter(p =>
      Number(p.estado_nro) === 1 &&
      (!p.movil || Number(p.movil) === 0) &&
      isWithinSaWindow(p.fch_hora_para ?? null, serverNow, minutosAntesSa)
    );
    const pendientes = filteredPedidos.filter(p => Number(p.estado_nro) === 1 && p.movil && Number(p.movil) !== 0);
    const totalPendientes = sinAsignar.length + pendientes.length; // todos los estado 1
    const pct = finalizadosSinHijo.length > 0 ? Math.round((entregados.length / finalizadosSinHijo.length) * 100) : 0;
    return { total, finalizados: finalizados.length, finalizadosSinHijo: finalizadosSinHijo.length, entregados: entregados.length, noEntregados: noEntregados.length, sinAsignar: sinAsignar.length, pendientes: pendientes.length, totalPendientes, pct };
  }, [filteredPedidos, canSeeUnassigned, serverNow, minutosAntesSa]);

  // ─── KPIs Services ─────────────────────────────────────────────────────────
  const servicesStats = useMemo(() => {
    // filteredServices ya excluye sinAsignar para usuarios sin la funcionalidad
    const total = filteredServices.length;
    const finalizados = filteredServices.filter(s => Number(s.estado_nro) === 2);
    const realizados = finalizados.filter(s => isServiceEntregado(s));
    const noRealizados = finalizados.filter(s => !isServiceEntregado(s));
    // sinAsignar solo visible si tiene la funcionalidad
    const sinAsignar = filteredServices.filter(s =>
      Number(s.estado_nro) === 1 &&
      (!s.movil || Number(s.movil) === 0) &&
      isWithinSaWindow(s.fch_hora_para ?? null, serverNow, minutosAntesSa)
    );
    const pendientes = filteredServices.filter(s => Number(s.estado_nro) === 1 && s.movil && Number(s.movil) !== 0);
    // % Con atraso sobre todos los pendientes (filteredServices ya maneja el scope)
    const pendientesList = filteredServices.filter(s => Number(s.estado_nro) === 1);
    const conAtraso = pendientesList.filter(s => {
      const d = computeDelayMinutes(s.fch_hora_max_ent_comp ?? null);
      return d !== null && d < 0;
    }).length;
    const pctAtraso = pendientesList.length > 0 ? Math.round((conAtraso / pendientesList.length) * 100) : 0;
    const pctNoRealizados = finalizados.length > 0 ? Math.round((noRealizados.length / finalizados.length) * 100) : 0;
    const totalPendientes = sinAsignar.length + pendientes.length; // todos los estado 1
    return { total, finalizados: finalizados.length, realizados: realizados.length, noRealizados: noRealizados.length, sinAsignar: sinAsignar.length, pendientes: pendientes.length, totalPendientes, conAtraso, pctAtraso, pctNoRealizados };
  }, [filteredServices, serverNow, minutosAntesSa]);

  // ─── % Realizados en hora (services) ────────────────────────────────────────
  const pctRealizadosEnHora = useMemo(() => {
    const realizados = filteredServices.filter(s => isServiceEntregado(s));
    if (realizados.length === 0) return null;
    const conAmbas = realizados.filter(s => s.fch_hora_max_ent_comp && s.fch_hora_finalizacion);
    if (conAmbas.length < 3) return null;
    const enHora = conAmbas.filter(s => {
      const fin = new Date(s.fch_hora_finalizacion!.replace(/\+00$/, '+00:00'));
      const lim = new Date(s.fch_hora_max_ent_comp!.replace(/\+00$/, '+00:00'));
      return fin <= lim;
    });
    return Math.round((enHora.length / conAmbas.length) * 100);
  }, [filteredServices]);

  // ─── Pedidos por hora ──────────────────────────────────────────────────────
  const pedidosPorHora = useMemo(() => {
    const map: Record<string, number> = {};
    filteredPedidos.forEach(p => {
      const fch = p.fch_hora_para ?? '';
      const hora = fch.includes('T') ? fch.split('T')[1]?.substring(0, 2) : fch.substring(8, 10);
      if (hora && hora.match(/^\d{2}$/)) {
        const h = `${hora}:00`;
        map[h] = (map[h] ?? 0) + 1;
      }
    });
    const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(...sorted.map(e => e[1]), 1);
    return sorted.map(([label, value]) => ({ label, value, pct: Math.round((value / max) * 100) }));
  }, [filteredPedidos]);


  // ─── Pedidos por empresa (multi-serie) ────────────────────────────────────
  const pedidosPorEmpresa = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.forEach(p => {
      const key = getEmpresaNombre(p, movilEmpresa, empresas);
      if (key === 'Sin empresa') return; // excluir pedidos sin empresa fletera
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if (isPedidoEntregado(p)) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes));
  }, [filteredPedidos, empresas, movilEmpresa]);

  // ─── Estados de pedidos (agrupados) ──────────────────────────────────────
  // Finalizado → Entregados (3/19) y No entregados, excluyendo pedido_hijo
  // Pendiente  → Móvil Asignado (5) y Sin Móvil Asignado (6+7 fusionados)
  const estadosPedidos = useMemo(() => {
    const total = filteredPedidos.length;
    const byEstado: Record<number, typeof filteredPedidos> = {};
    filteredPedidos.forEach(p => {
      const n = Number(p.estado_nro);
      if (!byEstado[n]) byEstado[n] = [];
      byEstado[n].push(p);
    });
    const maxCount = Math.max(...Object.values(byEstado).map(a => a.length), 1);
    const estadoNombres: Record<number, string> = { 1: 'Pendiente', 2: 'Finalizado', 4: 'Cancelado' };
    return (Object.entries(byEstado) as [string, typeof filteredPedidos][])
      .sort((a, b) => b[1].length - a[1].length)
      .map(([nroStr, list]) => {
        const nro = Number(nroStr);
        const label = estadoNombres[nro] ?? `Estado ${nro}`;
        const count = list.length;
        type SubRow = { label: string; value: number; pct: number; isEntregado: boolean };
        let subEstados: SubRow[];
        if (nro === 2) {
          // Finalizado: agrupar excluyendo pedido_hijo
          const sinHijo = list.filter(p => !p.pedido_hijo);
          const entregCnt = sinHijo.filter(p => isPedidoEntregado(p)).length;
          const noEntCnt = sinHijo.length - entregCnt;
          const den = Math.max(sinHijo.length, 1);
          subEstados = [
            { label: 'Entregados', value: entregCnt, pct: Math.round((entregCnt / den) * 100), isEntregado: true },
            { label: 'No entregados', value: noEntCnt, pct: Math.round((noEntCnt / den) * 100), isEntregado: false },
          ].filter(s => s.value > 0);
        } else if (nro === 1) {
          // Pendiente: fusionar sub-estados 6 (Ruteo Man) + 7 (Pend Asig Móvil)
          const subMap: Record<string, number> = {};
          list.forEach(p => {
            const sub = Number(p.sub_estado_nro);
            let key: string;
            if (sub === 6 || sub === 7) {
              key = 'Sin Móvil Asignado';
            } else {
              const desc = (p.sub_estado_desc ?? '').trim();
              key = desc ? `${desc} (${sub})` : `Sub-estado ${sub}`;
            }
            subMap[key] = (subMap[key] ?? 0) + 1;
          });
          subEstados = Object.entries(subMap)
            .sort((a, b) => b[1] - a[1])
            .map(([subLabel, sc]) => ({
              label: subLabel,
              value: sc,
              pct: Math.round((sc / count) * 100),
              isEntregado: false,
            }));
        } else {
          // Otros estados: mostrar sub-estados individuales
          const subMap: Record<string, { count: number; nro: number | null }> = {};
          list.forEach(p => {
            const subNro = p.sub_estado_nro != null ? Number(p.sub_estado_nro) : null;
            const desc = (p.sub_estado_desc ?? '').trim();
            const key = desc ? `${desc} (${subNro ?? ''})` : subNro != null ? `Sub-estado ${subNro}` : 'Sin sub-estado';
            if (!subMap[key]) subMap[key] = { count: 0, nro: subNro };
            subMap[key].count++;
          });
          subEstados = Object.entries(subMap)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([subLabel, { count: sc, nro: subNro }]) => ({
              label: subLabel,
              value: sc,
              pct: Math.round((sc / count) * 100),
              isEntregado: isPedidoEntregado({ estado_nro: nro, sub_estado_nro: subNro }),
            }));
        }
        return {
          label,
          value: count,
          pct: Math.round((count / Math.max(total, 1)) * 100),
          barPct: Math.round((count / maxCount) * 100),
          subEstados,
        };
      });
  }, [filteredPedidos]);

  // ─── Pedidos por zona (top 12 por total) ────────────────────────────────────
  const pedidosPorZona = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.filter(p => p.zona_nro).forEach(p => {
      const key = `Zona ${p.zona_nro}`;
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if (isPedidoEntregado(p)) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes));
  }, [filteredPedidos]);

  // ─── Atrasos de pedidos pendientes ─────────────────────────────────────────
  const atrasosStats = useMemo(() => {
    // filteredPedidos ya excluye sinAsignar para usuarios sin la funcionalidad
    const pendientes = filteredPedidos.filter(p => Number(p.estado_nro) === 1);
    let muyAtrasado = 0, atrasado = 0, limiteCercana = 0, enHora = 0, sinHora = 0;
    pendientes.forEach(p => {
      const diffMin = computeDelayMinutes(p.fch_hora_max_ent_comp ?? null);
      if (diffMin === null) { sinHora++; return; }
      if (diffMin >= 10) enHora++;
      else if (diffMin >= 0) limiteCercana++;
      else if (diffMin >= -10) atrasado++;
      else muyAtrasado++;
    });
    const total = pendientes.length;
    const conAtraso = muyAtrasado + atrasado;
    const pctAtraso = total > 0 ? Math.round((conAtraso / total) * 100) : 0;
    return { total, muyAtrasado, atrasado, limiteCercana, enHora, sinHora, pctAtraso };
  }, [filteredPedidos]);

  // ─── Atrasos por pedidos entregados (rangos de cumplimiento) ─────────────────────────
  const atrasosEntregadosStats = useMemo(() => {
    const entregados = filteredPedidos.filter(p => isPedidoEntregado(p) && !p.pedido_hijo);
    let rango1a15 = 0, rango15a30 = 0, rango30a60 = 0, rango60mas = 0, sinDato = 0;
    entregados.forEach(p => {
      const min = p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
      if (min === null) { sinDato++; return; }
      if (min <= 0) { sinDato++; return; } // en hora o anticipado: sin atraso
      if (min <= 15) rango1a15++;
      else if (min <= 30) rango15a30++;
      else if (min <= 60) rango30a60++;
      else rango60mas++;
    });
    const total = entregados.length;
    const conAtraso = rango1a15 + rango15a30 + rango30a60 + rango60mas;
    return { total, rango1a15, rango15a30, rango30a60, rango60mas, sinDato, conAtraso };
  }, [filteredPedidos]);

  // ─── Móviles con más entregas ──────────────────────────────────────────────
  const movilesTop = useMemo((): StackRow[] => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.filter(p => p.movil && Number(p.movil) !== 0).forEach(p => {
      const key = `Móvil ${p.movil}`;
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if (isPedidoEntregado(p)) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => {
        const totalB = b.entregados + b.noEntregados + b.pendientes;
        const totalA = a.entregados + a.noEntregados + a.pendientes;
        if (totalB !== totalA) return totalB - totalA;
        return b.entregados - a.entregados;
      });
  }, [filteredPedidos]);

  // ─── Pendientes por atraso × móvil ────────────────────────────────────────
  const pendientesPorMovil = useMemo<BucketRow[]>(() => {
    const map = new Map<number, BucketRow>();
    for (const p of filteredPedidos) {
      if (isPedidoEntregado(p)) continue;
      if (Number(p.estado_nro) !== 1) continue;
      const movilNum = p.movil ? Number(p.movil) : 0;
      if (!movilNum) continue;
      const mins = computeDelayMinutes(p.fch_hora_max_ent_comp ?? null);
      const bucket = bucketAtrasoPendiente(mins);
      if (!map.has(movilNum)) {
        map.set(movilNum, {
          label: `Móvil ${movilNum}`,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_PENDIENTE_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(movilNum)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos]);

  // ─── Finalizados por atraso × móvil ───────────────────────────────────────
  const finalizadosPorMovil = useMemo<BucketRow[]>(() => {
    const map = new Map<number, BucketRow>();
    for (const p of filteredPedidos) {
      if (!isPedidoEntregado(p)) continue;
      const movilNum = p.movil ? Number(p.movil) : 0;
      if (!movilNum) continue;
      const mins = p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
      const bucket = bucketAtrasoFinalizado(mins);
      if (!map.has(movilNum)) {
        map.set(movilNum, {
          label: `Móvil ${movilNum}`,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_FINALIZADO_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(movilNum)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos]);

  // ─── Pendientes por atraso × zona ─────────────────────────────────────────
  const pendientesPorZona = useMemo<BucketRow[]>(() => {
    const map = new Map<string, BucketRow>();
    for (const p of filteredPedidos) {
      if (isPedidoEntregado(p)) continue;
      if (Number(p.estado_nro) !== 1) continue;
      if (!p.zona_nro) continue;
      const key = `Zona ${p.zona_nro}`;
      const mins = computeDelayMinutes(p.fch_hora_max_ent_comp ?? null);
      const bucket = bucketAtrasoPendiente(mins);
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_PENDIENTE_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(key)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos]);

  // ─── Finalizados por atraso × zona ────────────────────────────────────────
  const finalizadosPorZona = useMemo<BucketRow[]>(() => {
    const map = new Map<string, BucketRow>();
    for (const p of filteredPedidos) {
      if (!isPedidoEntregado(p)) continue;
      if (!p.zona_nro) continue;
      const key = `Zona ${p.zona_nro}`;
      const mins = p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
      const bucket = bucketAtrasoFinalizado(mins);
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_FINALIZADO_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(key)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos]);

  // ─── Pendientes por atraso × empresa ──────────────────────────────────────
  const pendientesPorEmpresa = useMemo<BucketRow[]>(() => {
    const map = new Map<string, BucketRow>();
    for (const p of filteredPedidos) {
      if (isPedidoEntregado(p)) continue;
      if (Number(p.estado_nro) !== 1) continue;
      const key = getEmpresaNombre(p, movilEmpresa, empresas);
      if (key === 'Sin empresa') continue;
      const mins = computeDelayMinutes(p.fch_hora_max_ent_comp ?? null);
      const bucket = bucketAtrasoPendiente(mins);
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_PENDIENTE_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(key)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos, movilEmpresa, empresas]);

  // ─── Finalizados por atraso × empresa ─────────────────────────────────────
  const finalizadosPorEmpresa = useMemo<BucketRow[]>(() => {
    const map = new Map<string, BucketRow>();
    for (const p of filteredPedidos) {
      if (!isPedidoEntregado(p)) continue;
      const key = getEmpresaNombre(p, movilEmpresa, empresas);
      if (key === 'Sin empresa') continue;
      const mins = p.atraso_cump_mins != null ? Number(p.atraso_cump_mins) : null;
      const bucket = bucketAtrasoFinalizado(mins);
      if (!map.has(key)) {
        map.set(key, {
          label: key,
          total: 0,
          buckets: Object.fromEntries(BUCKETS_FINALIZADO_ORDEN.map(b => [b, 0])),
        });
      }
      const row = map.get(key)!;
      row.buckets[bucket] += 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPedidos, movilEmpresa, empresas]);

  // ─── Móviles stats (respeta filtro de empresa) ─────────────────────────────
  const movilesStats = useMemo(() => {
    // Solo móviles con GPS vigente (INNER JOIN gps_latest_positions)
    const conGps = movilesRaw.filter(m => movilesConGps.has(String(m.nro)));
    // Filtrar por empresa seleccionada o por allowedEmpresas (distribuidores)
    let list: typeof conGps;
    if (selectedEmpresa !== 'Todas') {
      list = conGps.filter(m => {
        const nombre = empresas.get(m.empresa_fletera_id) ?? `Empresa ${m.empresa_fletera_id}`;
        return nombre === selectedEmpresa;
      });
    } else if (!isPrivilegedScope) {
      const allowedIds = new Set(user?.allowedEmpresas ?? []);
      list = conGps.filter(m => allowedIds.has(m.empresa_fletera_id));
    } else {
      list = conGps;
    }
    // Móviles "ocultos pero operativos": no-activos con pedidos o services asignados.
    // Se excluyen de TODO conteo de móviles (activos, conPedidos, totalLote, etc.).
    const hiddenMovilIds = new Set<number>();
    for (const m of list) {
      if (isMovilActiveForUI(m.estadoNro)) continue;
      const hasPedido = filteredPedidos.some(p => p.movil != null && Number(p.movil) === m.nro);
      if (hasPedido) { hiddenMovilIds.add(m.nro); continue; }
      const hasService = filteredServices.some(s => s.movil != null && Number(s.movil) === m.nro);
      if (hasService) hiddenMovilIds.add(m.nro);
    }
    // Activos: mismo criterio que sidebar — solo estadoNro null/undefined/0/1/2,
    // y excluyendo los ocultos-pero-operativos.
    const activos = list.filter(m => isMovilActiveForUI(m.estadoNro) && !hiddenMovilIds.has(m.nro));
    const totalActivos = activos.length;
    const conPedidos = activos.filter(m => m.pedidosAsignados > 0).length;
    const sinPedidos = totalActivos - conPedidos;
    const pctConPedidos = totalActivos > 0 ? Math.round((conPedidos / totalActivos) * 100) : 0;
    const pctSinPedidos = totalActivos > 0 ? Math.round((sinPedidos / totalActivos) * 100) : 0;
    // Disponibilidad de lote
    const totalLote = activos.reduce((s, m) => s + (m.tamanoLote ?? 0), 0);
    const disponible = activos.reduce((s, m) => s + Math.max(0, (m.tamanoLote ?? 0) - m.pedidosAsignados), 0);
    const pctDisponibilidad = totalLote > 0 ? Math.round((disponible / totalLote) * 100) : null;
    return { totalActivos, conPedidos, sinPedidos, pctConPedidos, pctSinPedidos, totalLote, disponible, pctDisponibilidad };
  }, [movilesRaw, movilesConGps, selectedEmpresa, empresas, filteredPedidos, filteredServices, isPrivilegedScope, user?.allowedEmpresas]);

  // ─── % Entregados en hora ───────────────────────────────────────────────────
  const pctEntregadosEnHora = useMemo(() => {
    const entregados = filteredPedidos.filter(p => isPedidoEntregado(p) && !p.pedido_hijo);
    if (entregados.length === 0) return null;
    const conAmbas = entregados.filter(p => p.fch_hora_max_ent_comp && p.fch_hora_finalizacion);
    if (conAmbas.length < 3) return null; // no hay suficientes datos
    const enHora = conAmbas.filter(p => {
      const finalizacion = new Date(p.fch_hora_finalizacion!.replace(/\+00$/, '+00:00'));
      const limite = new Date(p.fch_hora_max_ent_comp!.replace(/\+00$/, '+00:00'));
      return finalizacion <= limite;
    });
    return Math.round((enHora.length / conAmbas.length) * 100);
  }, [filteredPedidos]);

  // ─── Modo Kiosko: rollover de medianoche ───────────────────────────────────
  // Con ModoKiosko activo, poco después de medianoche (Montevideo) la vista
  // rueda sola a la fecha de hoy con datos frescos (AC4), sin intervención
  // humana. `window.location.assign` a la ruta pelada (sin `?date`) descarta
  // cualquier `?date=<pasado>` que hubiera en la URL. El id del timer se guarda
  // en un ref y se limpia en cleanup/reprogramación (lección
  // settimeout-id-persistence, AC10): nunca queda un timer duplicado ni un
  // reload huérfano al navegar fuera de stats. El catch-up por
  // `visibilitychange` cubre una PC que hibernó/suspendió cruzando medianoche.
  const rolloverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isKiosko) return;

    const scheduleNext = () => {
      if (rolloverTimerRef.current) {
        clearTimeout(rolloverTimerRef.current);
        rolloverTimerRef.current = null;
      }
      rolloverTimerRef.current = setTimeout(() => {
        window.location.assign('/dashboard/stats');
      }, msUntilNextRollover());
    };
    scheduleNext();

    const onVisibilityCatchUp = () => {
      if (document.visibilityState !== 'visible') return;
      if (todayMontevideo() !== date) {
        window.location.assign('/dashboard/stats');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityCatchUp);

    return () => {
      if (rolloverTimerRef.current) {
        clearTimeout(rolloverTimerRef.current);
        rolloverTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityCatchUp);
    };
  }, [isKiosko, date]);

  // ─── Modo Kiosko: fullscreen best-effort ───────────────────────────────────
  // El fullscreen REAL lo da el acceso directo `msedge --kiosk` (AC6); este
  // intento es solo un plus por si el navegador ya tuvo un gesto de usuario
  // previo. Si `requestFullscreen` rechaza (sin gesto), se captura y no bloquea
  // nada.
  useEffect(() => {
    if (!isKiosko) return;
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      // no-op: Fullscreen API no disponible o rechazada sin gesto de usuario.
    }
  }, [isKiosko]);

  const isFiltered = selectedEmpresa !== 'Todas' || selectedProducto !== 'Todos';
  const clearFilters = () => { setSelectedEmpresa('Todas'); setSelectedProducto('Todos'); };

  return (
    <div
      data-theme={theme}
      className="h-full overflow-y-auto font-stats-sans bg-stats-background text-stats-foreground dark:bg-gradient-to-br dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 dark:text-white"
    >
      {/* ─── Header compacto ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 backdrop-blur-md border-b px-4 py-2 bg-white/85 border-stats-border dark:bg-gray-900/85 dark:border-white/10">
        {/* Row 1: titulo + KPIs inline (desktop) + acciones */}
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-base font-bold tracking-tight whitespace-nowrap">Centro Estadístico</h1>
            <span className="text-xs text-stats-muted-fg dark:text-gray-400 whitespace-nowrap">{formatDate(date)}</span>
            <span
              className="text-[10px] text-stats-muted-fg/70 dark:text-gray-500 hidden md:inline whitespace-nowrap"
              title={lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString('es-UY') : ''}
            >
              · act. {formatTimeAgo(lastUpdatedAt)}
              {isLoading && <span className="ml-1 text-stats-info animate-pulse">●</span>}
            </span>
          </div>
          {/* Acciones */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Abrir mapa en otra pestaña — solo para usuarios con pantalla de inicio = stats */}
            {showMapButton && (
              <a
                href="/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir mapa en otra pestaña"
                aria-label="Abrir mapa en otra pestaña"
                className="p-1.5 rounded-lg transition-colors hover:bg-stats-surface-2 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="22" />
                </svg>
              </a>
            )}
            {/* Combo refresh: 1m–30m en pasos de 1 minuto */}
            <select
              value={refreshSeconds}
              onChange={(e) => setRefreshSeconds(Number(e.target.value))}
              className="text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-stats-info cursor-pointer bg-white border border-gray-300 text-gray-900 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              aria-label="Intervalo de refresh"
              title="Intervalo de refresh"
            >
              {Array.from({ length: 30 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m * 60}>{m}m</option>
              ))}
            </select>
            <button
              onClick={() => setRefreshTick((t) => t + 1)}
              title="Actualizar ahora"
              aria-label="Actualizar ahora"
              className="p-1.5 rounded-lg transition-colors hover:bg-stats-surface-2 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
            >
              <svg className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={`Cambiar a tema ${theme === 'dark' ? 'claro' : 'oscuro'}`}
              aria-label={`Cambiar a tema ${theme === 'dark' ? 'claro' : 'oscuro'}`}
              className="p-1.5 rounded-lg transition-colors hover:bg-stats-surface-2 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
            >
              {theme === 'dark' ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => window.close()}
              title="Cerrar"
              aria-label="Cerrar"
              className="p-1.5 rounded-lg transition-colors text-stats-muted-fg hover:bg-stats-surface-2 dark:text-gray-400 dark:hover:bg-white/10"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: filter pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Pill: Empresa */}
          <label className={`group flex items-center gap-1.5 text-xs rounded-full pl-2.5 pr-1 py-0.5 transition-colors border ${
            selectedEmpresa !== 'Todas'
              ? 'bg-stats-info-soft border-stats-info text-stats-info dark:bg-stats-info/15 dark:border-stats-info/40'
              : 'bg-stats-surface-2 border-stats-border text-stats-muted-fg dark:bg-white/5 dark:border-white/10 dark:text-gray-300'
          }`}>
            <svg className="h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" /></svg>
            <span className="opacity-70">Empresa:</span>
            <select
              value={selectedEmpresa}
              onChange={(e) => setSelectedEmpresa(e.target.value)}
              className="bg-transparent border-0 focus:outline-none focus:ring-0 cursor-pointer pr-1 py-0.5 font-medium"
              aria-label="Filtrar por empresa"
            >
              <option value="Todas" className="bg-stats-surface dark:bg-gray-900 text-stats-foreground dark:text-white">Todas</option>
              {empresaOptions.map((emp) => (
                <option key={emp} value={emp} className="bg-stats-surface dark:bg-gray-900 text-stats-foreground dark:text-white">{emp}</option>
              ))}
            </select>
            {selectedEmpresa !== 'Todas' && (
              <button
                onClick={() => setSelectedEmpresa('Todas')}
                className="ml-0.5 p-0.5 rounded-full hover:bg-stats-info/20"
                aria-label="Quitar filtro empresa"
                title="Quitar filtro"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
          </label>

          {/* Pill: Producto */}
          <label className={`group flex items-center gap-1.5 text-xs rounded-full pl-2.5 pr-1 py-0.5 transition-colors border ${
            selectedProducto !== 'Todos'
              ? 'bg-stats-info-soft border-stats-info text-stats-info dark:bg-stats-info/15 dark:border-stats-info/40'
              : 'bg-stats-surface-2 border-stats-border text-stats-muted-fg dark:bg-white/5 dark:border-white/10 dark:text-gray-300'
          }`}>
            <svg className="h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
            <span className="opacity-70">Producto:</span>
            <select
              value={selectedProducto}
              onChange={(e) => setSelectedProducto(e.target.value)}
              className="bg-transparent border-0 focus:outline-none focus:ring-0 cursor-pointer pr-1 py-0.5 font-medium"
              aria-label="Filtrar por producto"
            >
              <option value="Todos" className="bg-stats-surface dark:bg-gray-900 text-stats-foreground dark:text-white">Todos</option>
              <option value="1002013" className="bg-stats-surface dark:bg-gray-900 text-stats-foreground dark:text-white">GLP Envasado 13 Kg</option>
            </select>
            {selectedProducto !== 'Todos' && (
              <button
                onClick={() => setSelectedProducto('Todos')}
                className="ml-0.5 p-0.5 rounded-full hover:bg-stats-info/20"
                aria-label="Quitar filtro producto"
                title="Quitar filtro"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
          </label>

          {isFiltered && (
            <button
              onClick={clearFilters}
              className="text-[11px] px-2 py-0.5 rounded-full text-stats-info hover:underline focus:outline-none focus:ring-2 focus:ring-stats-info"
            >
              Limpiar filtros
            </button>
          )}

        </div>
      </div>

      {/* Skeleton durante carga inicial (no en refreshes — el indicador de
          "act. Ns" + ● en el header avisa de las recargas posteriores). */}
      {isLoading && !lastUpdatedAt && (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
          <section>
            <div className="h-3 w-20 rounded bg-stats-border dark:bg-white/10 mb-3 animate-pulse" />
            <KpiSkeleton count={6} />
          </section>
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl p-4 border bg-stats-info-soft/50 border-stats-info/20 dark:bg-stats-info/5 dark:border-stats-info/15">
              <div className="h-3 w-32 rounded bg-stats-info/30 mb-3 animate-pulse" />
              <KpiSkeleton count={3} />
            </div>
            <div className="rounded-xl p-4 border bg-stats-success-soft/50 border-stats-success/20 dark:bg-stats-success/5 dark:border-stats-success/15">
              <div className="h-3 w-32 rounded bg-stats-success/30 mb-3 animate-pulse" />
              <KpiSkeleton count={3} />
            </div>
          </section>
        </div>
      )}

      {error && (
        <div className="m-6 p-4 rounded-xl text-sm border bg-stats-destructive-soft border-stats-destructive/40 text-stats-destructive dark:bg-stats-destructive/10 dark:border-stats-destructive/30 dark:text-stats-destructive-soft">
          {error}
        </div>
      )}

      {/* Contenido: en la primer carga el skeleton arriba ocupa el lugar; los
          refreshes posteriores mantienen los datos viejos visibles + indicador. */}
      {(!isLoading || lastUpdatedAt) && !error && (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">

          {/* ── KPIs Móviles ── */}
          <section className="stats-section-enter" style={{ animationDelay: '0ms' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-muted-fg dark:text-gray-500">Móviles</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                label="Móviles Activos"
                value={movilesStats.totalActivos}
                sub="total activos"
                color="blue"
              />
              <KpiCard
                label="Con Pedidos Pend."
                value={`${movilesStats.pctConPedidos}%`}
                sub={`${movilesStats.conPedidos} móviles`}
                color={movilesStats.pctConPedidos >= 80 ? 'green' : movilesStats.pctConPedidos >= 40 ? 'orange' : 'red'}
              />
              <KpiCard
                label="Sin Pedidos"
                value={`${movilesStats.pctSinPedidos}%`}
                sub={`${movilesStats.sinPedidos} móviles`}
                color={movilesStats.sinPedidos > 0 ? 'purple' : 'gray'}
              />
              <KpiCard
                label="Zonas No Activas"
                value={zonasNoActivasCount !== null ? zonasNoActivasCount : '—'}
                color={zonasNoActivasCount !== null && zonasNoActivasCount > 0 ? 'red' : 'gray'}
              />
              <KpiCard
                label="Zonas Sin Móvil"
                value={zonasSinMovilCount !== null ? zonasSinMovilCount : '—'}
                sub="tipo urgente"
                color={zonasSinMovilCount !== null && zonasSinMovilCount > 0 ? 'orange' : 'gray'}
              />
              <KpiCard
                label="% Disponibilidad"
                value={movilesStats.pctDisponibilidad !== null ? `${movilesStats.pctDisponibilidad}%` : '—'}
                sub={movilesStats.totalLote > 0 ? `${movilesStats.disponible}/${movilesStats.totalLote} lote` : undefined}
                color={movilesStats.pctDisponibilidad === null ? 'gray' : movilesStats.pctDisponibilidad >= 60 ? 'green' : movilesStats.pctDisponibilidad >= 30 ? 'orange' : 'red'}
              />
            </div>
          </section>

          {/* ── KPIs: Pedidos Pendientes / Finalizados ── */}
          <section className="stats-section-enter" style={{ animationDelay: '60ms' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Columna Pedidos Pendientes */}
              <div className="rounded-xl p-4 border bg-stats-info-soft border-stats-info/30 dark:bg-stats-info/5 dark:border-stats-info/20">
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-info">Pedidos Pendientes</h2>
                <div className={`grid gap-2 ${canSeeUnassigned ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {canSeeUnassigned && (
                    <KpiCard
                      label="Sin asignar"
                      value={pedidosStats.sinAsignar}
                      color={pedidosStats.sinAsignar > 0 ? 'orange' : 'gray'}
                    />
                  )}
                  <KpiCard
                    label="Total pendientes"
                    value={canSeeUnassigned ? pedidosStats.totalPendientes : pedidosStats.pendientes}
                    sub={!canSeeUnassigned ? 'asignados' : undefined}
                    color="blue"
                  />
                  <KpiCard
                    label="% Con atraso"
                    value={`${atrasosStats.pctAtraso}%`}
                    sub={`${atrasosStats.muyAtrasado + atrasosStats.atrasado} pedidos`}
                    color={atrasosStats.pctAtraso >= 50 ? 'red' : atrasosStats.pctAtraso >= 20 ? 'orange' : 'green'}
                  />
                </div>
              </div>
              {/* Columna Pedidos Finalizados */}
              <div className="rounded-xl p-4 border bg-stats-success-soft border-stats-success/30 dark:bg-stats-success/5 dark:border-stats-success/20">
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-success">Pedidos Finalizados</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Entregados"
                    value={pedidosStats.entregados}
                    sub={`de ${pedidosStats.finalizadosSinHijo}`}
                    color="green"
                  />
                  <KpiCard
                    label="% No entregados"
                    value={pedidosStats.finalizadosSinHijo > 0 ? `${Math.round((pedidosStats.noEntregados / pedidosStats.finalizadosSinHijo) * 100)}%` : '—'}
                    sub={`${pedidosStats.noEntregados} pedidos`}
                    color={pedidosStats.noEntregados > 0 ? 'orange' : 'green'}
                  />
                  <KpiCard
                    label="% Entregados en hora"
                    value={pctEntregadosEnHora !== null ? `${pctEntregadosEnHora}%` : '—'}
                    color={pctEntregadosEnHora === null ? 'gray' : pctEntregadosEnHora >= 80 ? 'green' : pctEntregadosEnHora >= 50 ? 'orange' : 'red'}
                  />
                </div>
              </div>
            </div>

          </section>

          {/* ── KPIs Services ── */}
          <section className="stats-section-enter" style={{ animationDelay: '120ms' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Columna Services Pendientes */}
              <div className="rounded-xl p-4 border bg-stats-info-soft border-stats-info/30 dark:bg-stats-info/5 dark:border-stats-info/20">
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-info">Services Pendientes</h2>
                <div className={`grid gap-2 ${canSeeUnassigned ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {canSeeUnassigned && (
                    <KpiCard
                      label="Sin asignar"
                      value={servicesStats.sinAsignar}
                      color={servicesStats.sinAsignar > 0 ? 'orange' : 'gray'}
                    />
                  )}
                  <KpiCard
                    label="Total pendientes"
                    value={canSeeUnassigned ? servicesStats.totalPendientes : servicesStats.pendientes}
                    sub={!canSeeUnassigned ? 'asignados' : undefined}
                    color="blue"
                  />
                  <KpiCard
                    label="% Con atraso"
                    value={`${servicesStats.pctAtraso}%`}
                    sub={`${servicesStats.conAtraso} services`}
                    color={servicesStats.pctAtraso >= 50 ? 'red' : servicesStats.pctAtraso >= 20 ? 'orange' : 'green'}
                  />
                </div>
              </div>
              {/* Columna Services Finalizados */}
              <div className="rounded-xl p-4 border bg-stats-success-soft border-stats-success/30 dark:bg-stats-success/5 dark:border-stats-success/20">
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-success">Services Finalizados</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Realizados"
                    value={servicesStats.realizados}
                    sub={`de ${servicesStats.finalizados}`}
                    color="green"
                  />
                  <KpiCard
                    label="% No realizados"
                    value={servicesStats.finalizados > 0 ? `${servicesStats.pctNoRealizados}%` : '—'}
                    sub={`${servicesStats.noRealizados} services`}
                    color={servicesStats.noRealizados > 0 ? 'orange' : 'green'}
                  />
                  <KpiCard
                    label="% Realizados en hora"
                    value={pctRealizadosEnHora !== null ? `${pctRealizadosEnHora}%` : '—'}
                    color={pctRealizadosEnHora === null ? 'gray' : pctRealizadosEnHora >= 80 ? 'green' : pctRealizadosEnHora >= 50 ? 'orange' : 'red'}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Gráficos ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stats-section-enter" style={{ animationDelay: '180ms' }}>

            {/* Atrasos de pedidos pendientes — primera tarjeta, fila 1 */}
            <ExpandableCard
              title="Atrasos de pedidos pendientes"
              icon="alert"
              fechaLabel={`Datos del ${formatDate(date)}`}
              exportModel={() => ({
                title: 'Atrasos de pedidos pendientes',
                subtitle: `${atrasosStats.total} pendientes en total · ${atrasosStats.pctAtraso}% con atraso`,
                sections: [
                  {
                    heading: 'Pendientes por categoría',
                    columns: ['Categoría', 'Cantidad', '%'],
                    rows: [
                      ['Muy Atrasado', atrasosStats.muyAtrasado, atrasosStats.total > 0 ? `${Math.round((atrasosStats.muyAtrasado / atrasosStats.total) * 100)}%` : '0%'],
                      ['Atrasado', atrasosStats.atrasado, atrasosStats.total > 0 ? `${Math.round((atrasosStats.atrasado / atrasosStats.total) * 100)}%` : '0%'],
                      ['Límite Cercana', atrasosStats.limiteCercana, atrasosStats.total > 0 ? `${Math.round((atrasosStats.limiteCercana / atrasosStats.total) * 100)}%` : '0%'],
                      ['En Hora', atrasosStats.enHora, atrasosStats.total > 0 ? `${Math.round((atrasosStats.enHora / atrasosStats.total) * 100)}%` : '0%'],
                    ],
                  },
                  {
                    heading: `Atrasos por entregados (${atrasosEntregadosStats.total} entregados · ${atrasosEntregadosStats.conAtraso} con atraso)`,
                    columns: ['Rango', 'Cantidad'],
                    rows: [
                      ['1 a 15 min', atrasosEntregadosStats.rango1a15],
                      ['15 a 30 min', atrasosEntregadosStats.rango15a30],
                      ['30 a 60 min', atrasosEntregadosStats.rango30a60],
                      ['60+ min', atrasosEntregadosStats.rango60mas],
                    ],
                  },
                ],
              })}
            >
              <p className="text-xs mb-4 text-stats-muted-fg dark:text-gray-500">{atrasosStats.total} pendientes en total</p>

              {/* % general con atraso */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-stats-muted-fg dark:text-gray-400">Con atraso</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums font-stats-mono" style={{ color: atrasosStats.pctAtraso >= 50 ? 'var(--color-stats-destructive)' : atrasosStats.pctAtraso >= 20 ? 'var(--color-stats-warning)' : 'var(--color-stats-success)' }}>
                    {atrasosStats.pctAtraso}%
                  </span>
                  <span className="text-xs tabular-nums text-stats-muted-fg/80 dark:text-gray-500">({atrasosStats.muyAtrasado + atrasosStats.atrasado})</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mb-4 bg-stats-surface-2 dark:bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${atrasosStats.pctAtraso}%`,
                    background: atrasosStats.pctAtraso >= 50 ? 'var(--color-stats-destructive)' : atrasosStats.pctAtraso >= 20 ? 'var(--color-stats-warning)' : 'var(--color-stats-success)',
                  }}
                />
              </div>

              {/* Categorías pendientes */}
              <div className="space-y-2.5 text-xs">
                {[
                  { label: 'Muy Atrasado', value: atrasosStats.muyAtrasado, cssVar: 'var(--color-stats-destructive)', dot: 'bg-stats-destructive' },
                  { label: 'Atrasado', value: atrasosStats.atrasado, cssVar: '#f472b6', dot: 'bg-pink-400' },
                  { label: 'Límite Cercana', value: atrasosStats.limiteCercana, cssVar: 'var(--color-stats-warning)', dot: 'bg-stats-warning' },
                  { label: 'En Hora', value: atrasosStats.enHora, cssVar: 'var(--color-stats-success)', dot: 'bg-stats-success' },
                ].map(cat => (
                  <div key={cat.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cat.dot}`} />
                      <span className="text-stats-foreground/85 dark:text-gray-300">{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1 rounded-full overflow-hidden bg-stats-surface-2 dark:bg-white/10">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: atrasosStats.total > 0 ? `${Math.round((cat.value / atrasosStats.total) * 100)}%` : '0%',
                            background: cat.cssVar,
                          }}
                        />
                      </div>
                      <span className="font-semibold tabular-nums font-stats-mono w-6 text-right text-stats-foreground dark:text-white">{cat.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Sub-sección: Atrasos por pedidos entregados */}
              <div className="mt-5 pt-4 border-t border-stats-border dark:border-white/10">
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 text-stats-muted-fg dark:text-gray-400">
                  Atrasos por pedidos entregados
                </h4>
                {atrasosEntregadosStats.conAtraso === 0 ? (
                  <p className="text-xs text-stats-muted-fg dark:text-gray-500 italic">Sin atrasos registrados en entregados</p>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    {[
                      { label: '1 a 15 min', value: atrasosEntregadosStats.rango1a15, cssVar: 'var(--color-stats-warning)', dot: 'bg-stats-warning' },
                      { label: '15 a 30 min', value: atrasosEntregadosStats.rango15a30, cssVar: '#f97316', dot: 'bg-orange-400' },
                      { label: '30 a 60 min', value: atrasosEntregadosStats.rango30a60, cssVar: '#f472b6', dot: 'bg-pink-400' },
                      { label: '60+ min', value: atrasosEntregadosStats.rango60mas, cssVar: 'var(--color-stats-destructive)', dot: 'bg-stats-destructive' },
                    ].map(rango => (
                      <div key={rango.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rango.dot}`} />
                          <span className="text-stats-foreground/85 dark:text-gray-300">{rango.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1 rounded-full overflow-hidden bg-stats-surface-2 dark:bg-white/10">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: atrasosEntregadosStats.conAtraso > 0 ? `${Math.round((rango.value / atrasosEntregadosStats.conAtraso) * 100)}%` : '0%',
                                background: rango.cssVar,
                              }}
                            />
                          </div>
                          <span className="font-semibold tabular-nums font-stats-mono w-6 text-right text-stats-foreground dark:text-white">{rango.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-stats-muted-fg/60 dark:text-gray-600 mt-2">
                  {atrasosEntregadosStats.total} entregados totales · {atrasosEntregadosStats.conAtraso} con atraso registrado
                </p>
              </div>
            </ExpandableCard>

            {/* Pedidos por hora — fila 1, segunda tarjeta */}
            {pedidosPorHora.length > 0 && (
              <ExpandableCard
                title="Pedidos por hora"
                icon="clock"
                fechaLabel={`Datos del ${formatDate(date)}`}
                exportModel={() => ({
                  title: 'Pedidos por hora',
                  subtitle: `${pedidosPorHora.length} franjas horarias`,
                  sections: [sectionFromValuePct(undefined, 'Hora', pedidosPorHora)],
                })}
              >
                <BarChart data={pedidosPorHora} colorClass="bg-stats-info" />
              </ExpandableCard>
            )}

            {/* Estados de pedidos — fila 1, tercera tarjeta */}
            {estadosPedidos.length > 0 && (
              <ExpandableCard
                title="Pedidos por estado"
                icon="grid"
                fechaLabel={`Datos del ${formatDate(date)}`}
                exportModel={() => ({
                  title: 'Pedidos por estado',
                  subtitle: `${estadosPedidos.reduce((s, e) => s + e.value, 0)} pedidos en total`,
                  sections: [
                    {
                      heading: 'Por estado',
                      columns: ['Estado', 'Cantidad', '%'],
                      rows: estadosPedidos.map((e) => [e.label, e.value, `${e.pct}%`]),
                    },
                    ...estadosPedidos
                      .filter((e) => e.subEstados.length > 0)
                      .map((e) => ({
                        heading: `${e.label} — detalle`,
                        columns: ['Sub-estado', 'Cantidad', '%'],
                        rows: e.subEstados.map((s) => [s.label, s.value, `${s.pct}%`]),
                      })),
                  ],
                })}
              >
                <div className="space-y-4">
                  {estadosPedidos.map(estado => {
                    const labelUpper = (estado.label || '').toUpperCase();
                    const estadoBarColor =
                      labelUpper.includes('FINALIZ') || labelUpper.includes('ENTREGA') ? 'var(--color-stats-success)' :
                      labelUpper.includes('PENDIENT') || labelUpper.includes('PROCESO') ? 'var(--color-stats-info)' :
                      labelUpper.includes('CANCEL') || labelUpper.includes('ANUL') || labelUpper.includes('RECHAZ') ? 'var(--color-stats-destructive)' :
                      'var(--color-stats-neutral)';
                    return (
                    <div key={estado.label}>
                      <div className="flex justify-between items-baseline gap-2 text-xs mb-0.5">
                        <span className="font-semibold text-stats-foreground/90 dark:text-gray-200">{estado.label}</span>
                        <span className="font-bold tabular-nums font-stats-mono text-stats-foreground dark:text-white flex items-baseline gap-1">
                          <span className="text-right min-w-[3ch]">{estado.value}</span>
                          <span className="text-stats-muted-fg/70 dark:text-gray-500 font-normal text-right min-w-[3.5ch]">· {estado.pct}%</span>
                        </span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden mb-2 bg-stats-surface-2 dark:bg-white/10">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.max(estado.barPct, estado.value > 0 ? 6 : 0)}%`,
                            background: estadoBarColor,
                          }}
                        />
                      </div>
                      <div className="pl-3 border-l border-stats-border dark:border-white/10 space-y-1.5">
                        {estado.subEstados.map(sub => (
                          <div key={sub.label}>
                            <div className="flex justify-between items-baseline gap-2 text-[10px] mb-0.5">
                              <span className="text-stats-muted-fg dark:text-gray-400 truncate max-w-[60%]">{sub.label}</span>
                              <span className="font-semibold tabular-nums font-stats-mono text-stats-foreground/90 dark:text-gray-300 flex items-baseline gap-1">
                                <span className="text-right min-w-[3ch]">{sub.value}</span>
                                <span className="text-stats-muted-fg/60 dark:text-gray-600 font-normal text-right min-w-[3.5ch]">· {sub.pct}%</span>
                              </span>
                            </div>
                            <div className="h-3 rounded-full overflow-hidden bg-stats-surface-2/60 dark:bg-white/5">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  sub.isEntregado ? 'bg-stats-success' :
                                  estado.label === 'Pendiente' ? 'bg-stats-info' : 'bg-stats-warning'
                                }`}
                                style={{ width: `${Math.max(sub.pct, sub.value > 0 ? 6 : 0)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </ExpandableCard>
            )}

            {/* Top móviles por entregas — fila 2, botón lazy */}
            {canSeeStatsMovil && (
            <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-stats-info">{CARD_ICONS.truck}</span>
                <h3 className="text-sm font-semibold text-stats-foreground dark:text-gray-200">Top móviles por entregas</h3>
              </div>
              <p className="text-xs text-stats-muted-fg dark:text-gray-400 mb-4">
                {movilesTop.length} móviles con actividad. El gráfico se carga al solicitarlo.
              </p>
              <button
                onClick={() => setShowMoviles((v) => !v)}
                aria-expanded={showMoviles}
                className="w-full py-2 px-4 rounded-lg border border-stats-info/40 text-stats-info text-sm font-medium hover:bg-stats-info/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
              >
                {showMoviles ? 'Ocultar gráficos por móvil' : 'Mostrar gráficos por móvil'}
              </button>
            </div>
            )}

            {/* Pedidos por zona — fila 2, botón lazy */}
            {canSeeStatsZona && (
            <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-stats-info">{CARD_ICONS.pin}</span>
                <h3 className="text-sm font-semibold text-stats-foreground dark:text-gray-200">Pedidos por zona</h3>
              </div>
              <p className="text-xs text-stats-muted-fg dark:text-gray-400 mb-4">
                {pedidosPorZona.length} zonas con actividad. El gráfico se carga al solicitarlo.
              </p>
              <button
                onClick={() => setShowZona((v) => !v)}
                aria-expanded={showZona}
                className="w-full py-2 px-4 rounded-lg border border-stats-info/40 text-stats-info text-sm font-medium hover:bg-stats-info/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
              >
                {showZona ? 'Ocultar gráficos por zona' : 'Mostrar gráficos por zona'}
              </button>
            </div>
            )}

            {/* Pedidos por empresa — fila 2, botón lazy */}
            {canSeeStatsEmpresa && (
            <div className="rounded-xl p-4 border transition-all duration-200 bg-stats-surface border-stats-border hover:border-stats-info/40 dark:bg-white/5 dark:border-white/10 dark:hover:border-stats-info/40">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-stats-info">{CARD_ICONS.building}</span>
                <h3 className="text-sm font-semibold text-stats-foreground dark:text-gray-200">Pedidos por empresa</h3>
              </div>
              <p className="text-xs text-stats-muted-fg dark:text-gray-400 mb-4">
                {pedidosPorEmpresa.length} empresas con actividad. El gráfico se carga al solicitarlo.
              </p>
              <button
                onClick={() => setShowEmpresa((v) => !v)}
                aria-expanded={showEmpresa}
                className="w-full py-2 px-4 rounded-lg border border-stats-info/40 text-stats-info text-sm font-medium hover:bg-stats-info/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stats-info"
              >
                {showEmpresa ? 'Ocultar gráficos por empresa' : 'Mostrar gráficos por empresa'}
              </button>
            </div>
            )}

            {/* Reveals — siempre debajo de los 3 botones para mantenerlos apilados */}
            {canSeeStatsMovil && showMoviles && (
              <RevealChartBlock
                title="Top móviles por entregas"
                icon="truck"
                labelCol="Móvil"
                stackedData={movilesTop}
                pendientesData={pendientesPorMovil}
                finalizadosData={finalizadosPorMovil}
                fechaLabel={`Datos del ${formatDate(date)}`}
              />
            )}
            {canSeeStatsZona && showZona && (
              <RevealChartBlock
                title="Pedidos por zona"
                icon="pin"
                labelCol="Zona"
                stackedData={pedidosPorZona}
                pendientesData={pendientesPorZona}
                finalizadosData={finalizadosPorZona}
                fechaLabel={`Datos del ${formatDate(date)}`}
              />
            )}
            {canSeeStatsEmpresa && showEmpresa && (
              <RevealChartBlock
                title="Pedidos por empresa"
                icon="building"
                labelCol="Empresa"
                stackedData={pedidosPorEmpresa}
                pendientesData={pendientesPorEmpresa}
                finalizadosData={finalizadosPorEmpresa}
                fechaLabel={`Datos del ${formatDate(date)}`}
              />
            )}

          </div>

          {/* Footer */}
          <p className="text-center text-xs pb-4 text-stats-muted-fg/60 dark:text-gray-600">
            Datos del {formatDate(date)} · RiogasTracking
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Export con ProtectedRoute + Suspense (requerido por useSearchParams) ─────
export default function StatsPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-stats-background dark:bg-gray-900">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stats-info" />
        </div>
      }>
        <StatsContent />
      </Suspense>
    </ProtectedRoute>
  );
}
