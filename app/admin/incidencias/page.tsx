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
  const [filters, setFilters] = useState({ username: '', status: '' });
  const [selected, setSelected] = useState<Incident | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState<Incident['status']>('open');
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.username) params.set('username', filters.username);
      if (filters.status) params.set('status', filters.status);
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
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

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
      load();
    }
  }

  async function deleteItem(id: number) {
    if (!confirm('¿Eliminar la incidencia y su video?')) return;
    const r = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
    if (r.ok) {
      setSelected(null);
      load();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-rose-50/30">
      <header className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-700 shadow-xl">
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
            onClick={() => load()}
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

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex gap-3 flex-wrap items-center">
          <input
            placeholder="Usuario…"
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition w-48"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition cursor-pointer"
          >
            <option value="">Todos los estados</option>
            <option value="open">Abierta</option>
            <option value="in_review">En revisión</option>
            <option value="closed">Cerrada</option>
          </select>
          {(filters.username || filters.status) && (
            <button
              onClick={() => setFilters({ username: '', status: '' })}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Limpiar filtros
            </button>
          )}
          <div className="ml-auto text-sm text-slate-500">
            {total} {total === 1 ? 'incidencia' : 'incidencias'}
          </div>
        </div>

        {/* Grid de cards */}
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
          {items.length === 0 && !loading && (
            <div className="col-span-full flex flex-col items-center gap-3 text-slate-400 py-20">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <p className="text-sm font-medium">Sin incidencias reportadas</p>
              <p className="text-xs">Los usuarios pueden reportar desde el botón flotante en cualquier página.</p>
            </div>
          )}
        </div>

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
                    <video src={selected.video_url} controls className="w-full h-full" autoPlay />
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
      </main>
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
