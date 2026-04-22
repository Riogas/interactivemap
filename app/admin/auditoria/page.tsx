'use client';

import { useEffect, useState, useCallback } from 'react';

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

export default function AuditoriaPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    username: '',
    event_type: '',
    endpoint: '',
    since: '',
    until: '',
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const limit = 100;

  const load = useCallback(async () => {
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
      }
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-bold text-slate-800">Auditoría de actividad</h1>
          <p className="text-sm text-slate-500 mt-1">
            Registro completo de lo que hacen los usuarios en la app.
          </p>
        </header>

        {/* Filtros */}
        <div className="bg-white rounded-xl shadow p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            placeholder="Usuario"
            value={filters.username}
            onChange={(e) => { setPage(0); setFilters({ ...filters, username: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <select
            value={filters.event_type}
            onChange={(e) => { setPage(0); setFilters({ ...filters, event_type: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">Todos los eventos</option>
            <option value="api_call">api_call</option>
            <option value="navigation">navigation</option>
            <option value="click">click</option>
            <option value="custom">custom</option>
          </select>
          <input
            placeholder="Endpoint contiene…"
            value={filters.endpoint}
            onChange={(e) => { setPage(0); setFilters({ ...filters, endpoint: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm md:col-span-2"
          />
          <input
            type="datetime-local"
            value={filters.since}
            onChange={(e) => { setPage(0); setFilters({ ...filters, since: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="datetime-local"
            value={filters.until}
            onChange={(e) => { setPage(0); setFilters({ ...filters, until: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {/* Paginación + total */}
        <div className="flex items-center justify-between text-sm text-slate-600">
          <div>{loading ? 'Cargando…' : `${total} eventos`}</div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border rounded-lg disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="px-3 py-1.5">Página {page + 1}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * limit >= total}
              className="px-3 py-1.5 border rounded-lg disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-xl shadow overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Timestamp</th>
                <th className="text-left px-3 py-2">Usuario</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Método</th>
                <th className="text-left px-3 py-2">Endpoint</th>
                <th className="text-right px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">ms</th>
                <th className="text-left px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t hover:bg-blue-50 cursor-pointer"
                  onClick={() => setSelected(r)}
                >
                  <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">
                    {new Date(r.ts).toLocaleString('es-UY')}
                  </td>
                  <td className="px-3 py-1.5">{r.username ?? '-'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.event_type === 'api_call' ? 'bg-blue-100 text-blue-700'
                      : r.event_type === 'navigation' ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-700'
                    }`}>
                      {r.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.method ?? '-'}</td>
                  <td className="px-3 py-1.5 font-mono text-xs truncate max-w-[300px]">
                    {r.endpoint ?? '-'}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${
                    r.response_status && r.response_status >= 400 ? 'text-red-600' : ''
                  }`}>
                    {r.response_status ?? '-'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {r.duration_ms ?? '-'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.ip ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    Sin eventos para los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Drawer de detalle */}
        {selected && (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Detalle del evento #{selected.id}</h2>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-800">
                  ✕
                </button>
              </div>
              <pre className="text-xs bg-slate-50 p-3 rounded-lg overflow-auto whitespace-pre-wrap">
                {JSON.stringify(selected, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
