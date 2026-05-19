'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface Incident {
  id: number;
  ts: string;
  user_id: string | null;
  username: string | null;
  description: string | null;
  video_path: string;
  video_url: string | null;
  duration_s: number | null;
  size_bytes: number | null;
  mime_type: string | null;
  ip: string | null;
  status: 'open' | 'in_review' | 'closed';
  notes: string | null;
}

interface ListResponse {
  success: boolean;
  data: Incident[];
  total: number;
}

const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const;
const DEFAULT_PAGE_SIZE = 24;

function formatDuration(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IncidenciasPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ username: '', status: 'not_closed' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState<Incident['status']>('open');
  const loadingRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  const load = useCallback(async (page: number, size: number, f: typeof filters) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.username) params.set('username', f.username);
      if (f.status) params.set('status', f.status);
      params.set('limit', String(size));
      params.set('offset', String((page - 1) * size));
      const r = await fetch(`/api/incidents/list?${params}`);
      const j: ListResponse = await r.json();
      if (j.success) {
        setItems(j.data);
        setTotal(j.total);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    load(currentPage, pageSize, filters);
  }, [load, currentPage, pageSize, filters]);

  // Reset to page 1 when filters change
  const handleFilterChange = useCallback((newFilters: typeof filters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    if (selected) {
      setDraftNotes(selected.notes ?? '');
      setDraftStatus(selected.status);
    }
  }, [selected]);

  async function saveChanges() {
    if (!selected) return;
    const r = await fetch(`/api/incidents/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: draftStatus, notes: draftNotes }),
    });
    if (r.ok) {
      setSelected(null);
      load(currentPage, pageSize, filters);
    }
  }

  async function deleteItem(id: number) {
    if (!confirm('¿Eliminar la incidencia y su video?')) return;
    const r = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
    if (r.ok) {
      setSelected(null);
      load(currentPage, pageSize, filters);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-rose-50/30 flex flex-col">
      {/* Header sticky */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-700 shadow-xl">
        <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Incidencias reportadas</h1>
              <p className="text-xs text-slate-400 mt-0.5">Grabaciones de pantalla subidas por los usuarios</p>
            </div>
          </div>
          <button
            onClick={() => load(currentPage, pageSize, filters)}
            disabled={loading}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-lg shadow-blue-500/20 transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={loading ? 'animate-spin' : ''}
            >
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5 flex-1 flex flex-col">
        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex gap-3 flex-wrap items-center">
          <input
            placeholder="Usuario…"
            value={filters.username}
            onChange={(e) => handleFilterChange({ ...filters, username: e.target.value })}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition w-48"
          />
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange({ ...filters, status: e.target.value })}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition cursor-pointer"
          >
            <option value="">Todas</option>
            <option value="not_closed">Solo activas (no cerradas)</option>
            <option value="open">Abierta</option>
            <option value="in_review">En revisión</option>
            <option value="closed">Cerrada</option>
          </select>
          {(filters.username || filters.status) && (
            <button
              onClick={() => handleFilterChange({ username: '', status: '' })}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Limpiar filtros
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {total} {total === 1 ? 'incidencia' : 'incidencias'}
            </span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
              title="Incidencias por página"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} por página</option>
              ))}
            </select>
          </div>
        </div>

        {/* Grid de cards — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: pageSize }, (_, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-pulse">
                  <div className="aspect-video bg-slate-200" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-slate-200 rounded w-1/2" />
                    <div className="h-3 bg-slate-200 rounded w-3/4" />
                    <div className="h-3 bg-slate-200 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 text-slate-400 py-20">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <p className="text-sm font-medium">
                {(filters.username || filters.status) ? 'Sin resultados para los filtros aplicados' : 'Sin incidencias reportadas'}
              </p>
              <p className="text-xs">
                {(filters.username || filters.status)
                  ? 'Intentá con otros filtros o limpiá la búsqueda.'
                  : 'Los usuarios pueden reportar desde el botón flotante en cualquier página.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-slate-900">
                    {item.video_url ? (
                      <video
                        src={item.video_url}
                        className="w-full h-full object-cover"
                        preload="metadata"
                        muted
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      </div>
                    )}
                    {/* Status badge */}
                    <div className="absolute top-2 right-2">
                      <StatusBadge status={item.status} />
                    </div>
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-slate-900 ml-0.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                    </div>
                    {/* Duration */}
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded">
                      {formatDuration(item.duration_s)}
                    </div>
                  </div>
                  {/* Info */}
                  <div className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-400">#{item.id}</span>
                      <span className="text-xs text-slate-500">
                        {new Date(item.ts).toLocaleString('es-UY', {
                          day: '2-digit', month: '2-digit', year: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.username ? (
                        <>
                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-white flex items-center justify-center text-[10px] font-bold">
                            {item.username.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-slate-700 truncate">{item.username}</span>
                        </>
                      ) : (
                        <span className="text-sm text-slate-400 italic">anónimo</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-slate-600 line-clamp-2 leading-snug">
                        {item.description}
                      </p>
                    )}
                    <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                      {formatSize(item.size_bytes)} · {item.mime_type ?? 'video'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Barra de paginación */}
        {total > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-slate-500 tabular-nums">
              Mostrando {startItem}–{endItem} de {total}
            </span>
            <div className="flex items-center gap-1.5">
              {/* Primera página */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1 || loading}
                title="Primera página"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
                </svg>
              </button>
              {/* Anterior */}
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1 || loading}
                title="Página anterior"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {/* Indicador de página */}
              <span className="text-sm text-slate-700 font-medium px-3 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              {/* Siguiente */}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || loading}
                title="Página siguiente"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              {/* Última página */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || loading}
                title="Última página"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Drawer de detalle */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Incidencia #{selected.id}</h2>
                  <p className="text-xs text-slate-500">
                    {selected.username ?? 'anónimo'} · {new Date(selected.ts).toLocaleString('es-UY')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => deleteItem(selected.id)}
                  className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg font-medium transition"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="w-8 h-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1 p-6 space-y-4">
              {/* Player */}
              <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
                {selected.video_url ? (
                  <video
                    key={selected.id}
                    src={selected.video_url}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    className="w-full h-full"
                  >
                    {selected.mime_type && (
                      <source src={selected.video_url} type={selected.mime_type} />
                    )}
                  </video>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                    Video no disponible
                  </div>
                )}
              </div>

              {/* Meta en grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetaField label="Duración" value={formatDuration(selected.duration_s)} />
                <MetaField label="Tamaño" value={formatSize(selected.size_bytes)} />
                <MetaField label="Formato" value={selected.mime_type ?? '—'} />
                <MetaField label="IP" value={selected.ip ?? '—'} />
              </div>

              {/* Descripción */}
              {selected.description && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
                    Descripción del usuario
                  </div>
                  <div className="bg-slate-50 border border-slate-200 text-sm text-slate-700 px-4 py-3 rounded-lg whitespace-pre-wrap">
                    {selected.description}
                  </div>
                </div>
              )}

              {/* Editor de estado y notas */}
              <div className="space-y-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="text-[11px] uppercase tracking-wide text-blue-700 font-semibold">
                  Gestión del admin
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-medium">Estado</label>
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value as Incident['status'])}
                    className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="open">Abierta</option>
                    <option value="in_review">En revisión</option>
                    <option value="closed">Cerrada</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 font-medium">Notas internas</label>
                  <textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    rows={3}
                    placeholder="Notas del admin (qué se hizo, resolución, etc.)"
                    className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={saveChanges}
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow transition"
                  >
                    Guardar cambios
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-sm text-slate-800 font-medium mt-0.5 truncate">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'open' | 'in_review' | 'closed' }) {
  const map = {
    open:      { bg: 'bg-rose-500 text-white',    label: 'Abierta' },
    in_review: { bg: 'bg-amber-500 text-white',   label: 'En revisión' },
    closed:    { bg: 'bg-emerald-600 text-white', label: 'Cerrada' },
  };
  const style = map[status];
  return (
    <span className={`inline-block font-bold text-[10px] px-2 py-0.5 rounded-md shadow ${style.bg}`}>
      {style.label}
    </span>
  );
}
