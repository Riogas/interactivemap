'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface AuditRow {
  id: number;
  ts: string;
  user_id: string | null;
  username: string | null;
  event_type: string;
  method: string | null;
  endpoint: string | null;
  request_query: Record<string, unknown> | null;
  response_status: number | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  source: string;
  error: string | null;
}

interface ListResponse {
  success: boolean;
  data: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  error?: string;
}

const POLL_OPTIONS = [
  { value: 0, label: 'Manual' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 20, label: '20s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
];

export default function AuditoriaPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filters, setFilters] = useState({
    username: '',
    event_type: '',
    endpoint: '',
    since: '',
    until: '',
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [pollSeconds, setPollSeconds] = useState(10);
  const [secsUntilNext, setSecsUntilNext] = useState(10);
  const limit = 100;

  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (filters.username) params.set('username', filters.username);
      if (filters.event_type) params.set('event_type', filters.event_type);
      if (filters.endpoint) params.set('endpoint', filters.endpoint);
      if (filters.since) params.set('since', new Date(filters.since).toISOString());
      if (filters.until) params.set('until', new Date(filters.until).toISOString());

      const r = await fetch(`/api/audit/list?${params}`);
      const j: ListResponse = await r.json();
      if (j.success) {
        setRows(j.data);
        setTotal(j.total);
        setLastUpdate(new Date());
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling
  useEffect(() => {
    if (pollSeconds === 0) {
      setSecsUntilNext(0);
      return;
    }
    setSecsUntilNext(pollSeconds);
    const tick = setInterval(() => {
      setSecsUntilNext((s) => {
        if (s <= 1) {
          void load();
          return pollSeconds;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [pollSeconds, load]);

  // Stats
  const errorCount = rows.filter(
    (r) => r.response_status !== null && r.response_status >= 400,
  ).length;
  const uniqueUsers = new Set(
    rows.filter((r) => r.username).map((r) => r.username),
  ).size;
  const avgDuration = rows.filter((r) => r.duration_ms !== null).length > 0
    ? Math.round(
        rows.filter((r) => r.duration_ms !== null).reduce((a, r) => a + (r.duration_ms ?? 0), 0) /
          rows.filter((r) => r.duration_ms !== null).length,
      )
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-blue-50/30">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-700 shadow-xl">
        <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Auditoría de actividad</h1>
              <p className="text-xs text-slate-400 mt-0.5">Trazabilidad completa de acciones de usuario</p>
            </div>
          </div>

          {/* Refresh controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl px-3 py-1.5">
              <span className="text-xs text-slate-400 hidden sm:block">Auto-refresh:</span>
              <select
                value={pollSeconds}
                onChange={(e) => setPollSeconds(Number(e.target.value))}
                className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer"
              >
                {POLL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-slate-800">
                    {o.label}
                  </option>
                ))}
              </select>
              {pollSeconds > 0 && (
                <span className="text-xs font-mono text-emerald-400 tabular-nums min-w-[2.5ch] text-right">
                  {secsUntilNext}s
                </span>
              )}
            </div>
            <button
              onClick={() => load()}
              disabled={loading}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-lg shadow-blue-500/20 transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? 'animate-spin' : ''}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total eventos"
            value={total.toLocaleString('es-UY')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
            accent="blue"
          />
          <StatCard
            label="En esta página"
            value={rows.length.toString()}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
            accent="indigo"
          />
          <StatCard
            label="Usuarios únicos"
            value={uniqueUsers.toString()}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            accent="emerald"
          />
          <StatCard
            label="Errores (4xx/5xx)"
            value={errorCount.toString()}
            subtitle={avgDuration > 0 ? `${avgDuration}ms promedio` : undefined}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            }
            accent={errorCount > 0 ? 'rose' : 'slate'}
          />
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <h2 className="text-sm font-semibold text-slate-700">Filtros</h2>
            {(filters.username || filters.event_type || filters.endpoint || filters.since || filters.until) && (
              <button
                onClick={() => { setPage(0); setFilters({ username: '', event_type: '', endpoint: '', since: '', until: '' }); }}
                className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Limpiar
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <input
              placeholder="Usuario…"
              value={filters.username}
              onChange={(e) => { setPage(0); setFilters({ ...filters, username: e.target.value }); }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
            <select
              value={filters.event_type}
              onChange={(e) => { setPage(0); setFilters({ ...filters, event_type: e.target.value }); }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition cursor-pointer"
            >
              <option value="">Todos los eventos</option>
              <option value="api_call">API call</option>
              <option value="navigation">Navegación</option>
              <option value="click">Click</option>
              <option value="custom">Custom</option>
            </select>
            <input
              placeholder="Endpoint contiene…"
              value={filters.endpoint}
              onChange={(e) => { setPage(0); setFilters({ ...filters, endpoint: e.target.value }); }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition md:col-span-2 font-mono"
            />
            <div className="relative">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-500 uppercase tracking-wide">
                Desde
              </label>
              <input
                type="datetime-local"
                value={filters.since}
                onChange={(e) => { setPage(0); setFilters({ ...filters, since: e.target.value }); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>
            <div className="relative">
              <label className="absolute -top-2 left-2 bg-white px-1 text-[10px] text-slate-500 uppercase tracking-wide">
                Hasta
              </label>
              <input
                type="datetime-local"
                value={filters.until}
                onChange={(e) => { setPage(0); setFilters({ ...filters, until: e.target.value }); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>
          </div>
        </div>

        {/* Paginación + info */}
        <div className="flex items-center justify-between text-sm">
          <div className="text-slate-600">
            {loading && rows.length === 0 ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                Cargando…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {lastUpdate && (
                  <>
                    <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                    <span className="text-slate-500">
                      Última actualización: {lastUpdate.toLocaleTimeString('es-UY')}
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              ← Anterior
            </button>
            <span className="px-3 py-1.5 text-xs font-mono text-slate-600 bg-slate-50 rounded-lg min-w-[100px] text-center">
              {page + 1} / {Math.max(1, Math.ceil(total / limit))}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * limit >= total}
              className="px-3 py-1.5 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Siguiente →
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-380px)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr className="text-xs uppercase tracking-wider text-slate-500">
                  <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
                  <th className="text-left px-4 py-3 font-semibold">Usuario</th>
                  <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                  <th className="text-left px-4 py-3 font-semibold">Método</th>
                  <th className="text-left px-4 py-3 font-semibold">Endpoint</th>
                  <th className="text-right px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Duración</th>
                  <th className="text-left px-4 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-slate-100 hover:bg-blue-50/50 cursor-pointer transition"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {new Date(r.ts).toLocaleString('es-UY', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.username ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-white flex items-center justify-center text-[10px] font-bold">
                            {r.username.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="text-slate-700 font-medium">{r.username}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-xs">anónimo</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <EventBadge type={r.event_type} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {r.method ? <MethodBadge method={r.method} /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 truncate max-w-[320px]">
                      {r.endpoint ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.response_status !== null ? <StatusBadge status={r.response_status} /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {r.duration_ms !== null ? `${r.duration_ms}ms` : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {r.ip ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-20">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="12" /><line x1="11" y1="14" x2="11.01" y2="14" />
                        </svg>
                        <p className="text-sm font-medium">Sin eventos</p>
                        <p className="text-xs">Ajustá los filtros o esperá a que lleguen eventos nuevos.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drawer de detalle */}
        {selected && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-800">Detalle del evento</h2>
                    <p className="text-xs text-slate-500 font-mono">#{selected.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="overflow-auto flex-1 p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <DetailField label="Timestamp" value={new Date(selected.ts).toLocaleString('es-UY')} />
                  <DetailField label="Usuario" value={selected.username ?? 'anónimo'} />
                  <DetailField label="Evento" value={selected.event_type} />
                  <DetailField label="Fuente" value={selected.source} />
                  {selected.method && <DetailField label="Método" value={selected.method} />}
                  {selected.response_status !== null && (
                    <DetailField label="Status" value={String(selected.response_status)} />
                  )}
                  {selected.duration_ms !== null && (
                    <DetailField label="Duración" value={`${selected.duration_ms}ms`} />
                  )}
                  {selected.ip && <DetailField label="IP" value={selected.ip} />}
                </div>
                {selected.endpoint && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Endpoint</div>
                    <div className="bg-slate-900 text-emerald-300 font-mono text-xs px-4 py-3 rounded-lg overflow-x-auto">
                      {selected.endpoint}
                    </div>
                  </div>
                )}
                {selected.error && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-rose-500 font-semibold mb-1.5">Error</div>
                    <div className="bg-rose-50 border border-rose-200 text-rose-800 font-mono text-xs px-4 py-3 rounded-lg">
                      {selected.error}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Payload completo</div>
                  <pre className="text-xs bg-slate-50 border border-slate-200 p-3 rounded-lg overflow-auto whitespace-pre-wrap max-h-60">
                    {JSON.stringify(selected, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Componentes auxiliares
// ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtitle,
  icon,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent: 'blue' | 'indigo' | 'emerald' | 'rose' | 'slate';
}) {
  const styles = {
    blue:    { bg: 'from-blue-500 to-cyan-500',       text: 'text-blue-600'    },
    indigo:  { bg: 'from-indigo-500 to-purple-500',   text: 'text-indigo-600'  },
    emerald: { bg: 'from-emerald-500 to-teal-500',    text: 'text-emerald-600' },
    rose:    { bg: 'from-rose-500 to-pink-500',       text: 'text-rose-600'    },
    slate:   { bg: 'from-slate-400 to-slate-500',     text: 'text-slate-600'   },
  }[accent];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition">
      <div className={`p-2.5 rounded-xl bg-gradient-to-br ${styles.bg} text-white shadow`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold ${styles.text} tabular-nums leading-tight`}>{value}</div>
        {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; dot: string; label: string }> = {
    api_call:   { bg: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-500',    label: 'API' },
    navigation: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: 'Nav' },
    click:      { bg: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-500',   label: 'Click' },
    custom:     { bg: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500',  label: 'Custom' },
  };
  const style = map[type] ?? { bg: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-500', label: type };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium ${style.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    'text-emerald-700 bg-emerald-50',
    POST:   'text-blue-700 bg-blue-50',
    PUT:    'text-amber-700 bg-amber-50',
    PATCH:  'text-amber-700 bg-amber-50',
    DELETE: 'text-rose-700 bg-rose-50',
  };
  const c = colors[method.toUpperCase()] ?? 'text-slate-700 bg-slate-50';
  return (
    <span className={`inline-block font-bold text-[10px] px-1.5 py-0.5 rounded ${c}`}>
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const color =
    status >= 500 ? 'bg-rose-100 text-rose-700'
    : status >= 400 ? 'bg-amber-100 text-amber-700'
    : status >= 300 ? 'bg-blue-100 text-blue-700'
    : status >= 200 ? 'bg-emerald-100 text-emerald-700'
    : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block font-mono text-[11px] font-bold px-2 py-0.5 rounded ${color}`}>
      {status}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-sm text-slate-800 font-medium mt-0.5 break-all">{value}</div>
    </div>
  );
}
