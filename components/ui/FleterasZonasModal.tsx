'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Zona {
  zona_id: number;
  escenario_id?: number;
  nombre?: string;
  [key: string]: any;
}

interface Empresa {
  empresa_fletera_id: number;
  nombre: string;
  estado?: number;
}

interface FleteraZona {
  escenario_id: number;
  empresa_fletera_id: number;
  tipo_de_zona: string;
  tipo_de_servicio: string;
  zonas: number[];
  created_at?: string | null;
  updated_at?: string | null;
  empresa?: Empresa | null;
}

interface FormState {
  escenario_id: number;
  empresa_fletera_id: number | '';
  tipo_de_zona: string;
  tipo_de_servicio: string;
  zonas: number[];
}

const DEFAULT_ESCENARIO = 1000;

const TIPOS_DE_ZONA_SUGERIDOS = ['Distribucion', 'Servicio', 'Nocturno', 'Urgente'];
const TIPOS_DE_SERVICIO_SUGERIDOS = ['DISTRIBUCION', 'URGENTE', 'NOCTURNO', 'SERVICIO'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badgeColors(tipoServicio: string): string {
  switch (tipoServicio.toUpperCase()) {
    case 'URGENTE':    return 'bg-red-500/20 text-red-300 border border-red-500/30';
    case 'NOCTURNO':   return 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30';
    case 'DISTRIBUCION': return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    case 'SERVICIO':   return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
    default:           return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function FleterasZonasModal({ isOpen, onClose }: Props) {
  // ── Data ────────────────────────────────────────────────────────────────
  const [records, setRecords] = useState<FleteraZona[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Form ─────────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null); // null = create
  const [formData, setFormData] = useState<FormState>({
    escenario_id: DEFAULT_ESCENARIO,
    empresa_fletera_id: '',
    tipo_de_zona: '',
    tipo_de_servicio: '',
    zonas: [],
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [filterEmpresa, setFilterEmpresa] = useState<number | ''>('');
  const [filterTipoZona, setFilterTipoZona] = useState('');
  const [filterTipoServicio, setFilterTipoServicio] = useState('');
  const [searchZona, setSearchZona] = useState(''); // búsqueda en selector de zonas del form

  // ── Confirmación de borrado ───────────────────────────────────────────────
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [recRes, empRes, zonRes] = await Promise.all([
        fetch('/api/fleteras-zonas'),
        fetch('/api/empresas'),
        fetch('/api/zonas'),
      ]);
      const [recJson, empJson, zonJson] = await Promise.all([
        recRes.json(), empRes.json(), zonRes.json(),
      ]);
      setRecords(Array.isArray(recJson.data) ? recJson.data : []);
      setEmpresas(Array.isArray(empJson.data) ? empJson.data : []);
      setZonas(Array.isArray(zonJson.data) ? zonJson.data : []);
    } catch {
      setError('Error al cargar datos. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  // ── Filtered records ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterEmpresa !== '' && r.empresa_fletera_id !== filterEmpresa) return false;
      if (filterTipoZona && !r.tipo_de_zona.toLowerCase().includes(filterTipoZona.toLowerCase())) return false;
      if (filterTipoServicio && !r.tipo_de_servicio.toLowerCase().includes(filterTipoServicio.toLowerCase())) return false;
      return true;
    });
  }, [records, filterEmpresa, filterTipoZona, filterTipoServicio]);

  // ── Record key ────────────────────────────────────────────────────────────
  const recordKey = (r: FleteraZona) =>
    `${r.escenario_id}|${r.empresa_fletera_id}|${r.tipo_de_zona}|${r.tipo_de_servicio}`;

  // ── Open form ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingKey(null);
    setFormData({
      escenario_id: DEFAULT_ESCENARIO,
      empresa_fletera_id: '',
      tipo_de_zona: '',
      tipo_de_servicio: '',
      zonas: [],
    });
    setFormError(null);
    setSearchZona('');
    setFormOpen(true);
  };

  const openEdit = (r: FleteraZona) => {
    setEditingKey(recordKey(r));
    setFormData({
      escenario_id: r.escenario_id,
      empresa_fletera_id: r.empresa_fletera_id,
      tipo_de_zona: r.tipo_de_zona,
      tipo_de_servicio: r.tipo_de_servicio,
      zonas: Array.isArray(r.zonas) ? [...r.zonas] : [],
    });
    setFormError(null);
    setSearchZona('');
    setFormOpen(true);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!formData.empresa_fletera_id || !formData.tipo_de_zona.trim() || !formData.tipo_de_servicio.trim()) {
      setFormError('Completá empresa, tipo de zona y tipo de servicio.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const method = editingKey ? 'PUT' : 'POST';
      const res = await fetch('/api/fleteras-zonas', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          tipo_de_servicio: formData.tipo_de_servicio.trim().toUpperCase(),
          tipo_de_zona: formData.tipo_de_zona.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? 'Error al guardar');
        return;
      }
      setFormOpen(false);
      await loadData();
    } catch {
      setFormError('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (r: FleteraZona) => {
    setDeleting(true);
    try {
      const params = new URLSearchParams({
        escenario_id: String(r.escenario_id),
        empresa_fletera_id: String(r.empresa_fletera_id),
        tipo_de_zona: r.tipo_de_zona,
        tipo_de_servicio: r.tipo_de_servicio,
      });
      const res = await fetch(`/api/fleteras-zonas?${params}`, { method: 'DELETE' });
      if (res.ok) {
        setDeletingKey(null);
        await loadData();
      }
    } finally {
      setDeleting(false);
    }
  };

  // ── Zone search/select helpers ────────────────────────────────────────────
  const filteredZonas = useMemo(() => {
    if (!searchZona) return zonas;
    const q = searchZona.toLowerCase();
    return zonas.filter(z =>
      String(z.zona_id).includes(q) ||
      (z.nombre ?? '').toLowerCase().includes(q)
    );
  }, [zonas, searchZona]);

  const toggleZona = (zonaId: number) => {
    setFormData(prev => ({
      ...prev,
      zonas: prev.zonas.includes(zonaId)
        ? prev.zonas.filter(z => z !== zonaId)
        : [...prev.zonas, zonaId].sort((a, b) => a - b),
    }));
  };

  const getZonaName = (zonaId: number) => {
    const z = zonas.find(z => z.zona_id === zonaId);
    return z?.nombre ? `Z${zonaId} - ${z.nombre}` : `Zona ${zonaId}`;
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/60 backdrop-blur-sm p-2 pt-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="relative w-full max-w-6xl bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-teal-700 to-emerald-700 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h2 className="text-white font-bold text-lg leading-tight">Zonas por Empresa Fletera</h2>
                <p className="text-teal-200 text-xs">{filtered.length} asignación{filtered.length !== 1 ? 'es' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Nueva asignación
              </button>
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/25 text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Filtros ── */}
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-gray-800/60 border-b border-gray-700/50 shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-[180px]">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              <select
                value={filterEmpresa}
                onChange={e => setFilterEmpresa(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="flex-1 bg-gray-700/60 border border-gray-600/50 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-teal-500"
              >
                <option value="">Todas las empresas</option>
                {empresas.map(e => (
                  <option key={e.empresa_fletera_id} value={e.empresa_fletera_id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="Tipo de zona..."
              value={filterTipoZona}
              onChange={e => setFilterTipoZona(e.target.value)}
              className="bg-gray-700/60 border border-gray-600/50 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-teal-500 w-40"
            />
            <input
              type="text"
              placeholder="Tipo de servicio..."
              value={filterTipoServicio}
              onChange={e => setFilterTipoServicio(e.target.value)}
              className="bg-gray-700/60 border border-gray-600/50 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-teal-500 w-44"
            />
            {(filterEmpresa !== '' || filterTipoZona || filterTipoServicio) && (
              <button
                onClick={() => { setFilterEmpresa(''); setFilterTipoZona(''); setFilterTipoServicio(''); }}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                Limpiar filtros
              </button>
            )}
            <button
              onClick={loadData}
              className="ml-auto flex items-center gap-1.5 text-xs text-gray-400 hover:text-teal-300 transition-colors"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Actualizar
            </button>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-auto">
            {error && (
              <div className="m-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-400" />
                  <p className="text-gray-400 text-sm">Cargando asignaciones...</p>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-gray-500 text-sm">No hay asignaciones que coincidan con los filtros</p>
                <button onClick={openCreate} className="text-teal-400 hover:text-teal-300 text-sm underline transition-colors">
                  Crear primera asignación
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/90 backdrop-blur z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Empresa Fletera</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Tipo de Zona</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Tipo de Servicio</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Zonas asignadas</th>
                    <th className="text-right px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {filtered.map(r => {
                    const key = recordKey(r);
                    const isDeleting = deletingKey === key;
                    const empresaNombre = r.empresa?.nombre ?? `Empresa ${r.empresa_fletera_id}`;
                    const zonasList = Array.isArray(r.zonas) ? r.zonas : [];

                    return (
                      <tr key={key} className="hover:bg-gray-700/30 transition-colors group">
                        {/* Empresa */}
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-100">{empresaNombre}</div>
                          <div className="text-xs text-gray-500">ID {r.empresa_fletera_id} · Esc. {r.escenario_id}</div>
                        </td>

                        {/* Tipo de zona */}
                        <td className="px-4 py-3">
                          <span className="px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/25 text-xs font-medium">
                            {r.tipo_de_zona}
                          </span>
                        </td>

                        {/* Tipo de servicio */}
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${badgeColors(r.tipo_de_servicio)}`}>
                            {r.tipo_de_servicio}
                          </span>
                        </td>

                        {/* Zonas */}
                        <td className="px-4 py-3">
                          {zonasList.length === 0 ? (
                            <span className="text-gray-600 text-xs italic">Sin zonas</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-md">
                              {zonasList.slice(0, 12).map(zId => (
                                <span key={zId} className="px-2 py-0.5 rounded-md bg-gray-700/70 text-gray-300 text-xs border border-gray-600/50">
                                  {zId}
                                </span>
                              ))}
                              {zonasList.length > 12 && (
                                <span className="px-2 py-0.5 rounded-md bg-teal-500/15 text-teal-300 text-xs border border-teal-500/25">
                                  +{zonasList.length - 12} más
                                </span>
                              )}
                            </div>
                          )}
                          <div className="text-xs text-gray-600 mt-1">{zonasList.length} zona{zonasList.length !== 1 ? 's' : ''}</div>
                        </td>

                        {/* Acciones */}
                        <td className="px-4 py-3 text-right">
                          {isDeleting ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-gray-400">¿Eliminar?</span>
                              <button
                                onClick={() => handleDelete(r)}
                                disabled={deleting}
                                className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/35 text-red-300 text-xs font-semibold border border-red-500/30 transition-colors disabled:opacity-50"
                              >
                                {deleting ? '...' : 'Sí'}
                              </button>
                              <button
                                onClick={() => setDeletingKey(null)}
                                className="px-3 py-1.5 rounded-lg bg-gray-600/30 hover:bg-gray-600/50 text-gray-300 text-xs font-semibold transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => openEdit(r)}
                                className="p-2 rounded-lg bg-blue-500/15 hover:bg-blue-500/30 text-blue-400 hover:text-blue-300 transition-colors"
                                title="Editar"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeletingKey(key)}
                                className="p-2 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors"
                                title="Eliminar"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* ── Form Modal (slide-in panel) ── */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            className="fixed inset-0 z-[10001] flex items-start justify-center bg-black/40 backdrop-blur-sm p-2 pt-12"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget && !saving) setFormOpen(false); }}
          >
            <motion.div
              className="relative w-full max-w-2xl bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-700/60"
              style={{ maxHeight: 'calc(100vh - 80px)' }}
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Form Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-teal-800 to-emerald-800 shrink-0">
                <h3 className="text-white font-bold text-base">
                  {editingKey ? 'Editar asignación' : 'Nueva asignación'}
                </h3>
                <button
                  onClick={() => !saving && setFormOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {formError && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-sm">
                    {formError}
                  </div>
                )}

                {/* Escenario */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Escenario ID</label>
                  <input
                    type="number"
                    value={formData.escenario_id}
                    onChange={e => setFormData(p => ({ ...p, escenario_id: parseInt(e.target.value) || DEFAULT_ESCENARIO }))}
                    disabled={!!editingKey}
                    className="w-full bg-gray-800 border border-gray-600/50 text-gray-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                </div>

                {/* Empresa */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Empresa Fletera <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={formData.empresa_fletera_id}
                    onChange={e => setFormData(p => ({ ...p, empresa_fletera_id: parseInt(e.target.value) }))}
                    disabled={!!editingKey}
                    className="w-full bg-gray-800 border border-gray-600/50 text-gray-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    <option value="">— Seleccionar empresa —</option>
                    {empresas.map(e => (
                      <option key={e.empresa_fletera_id} value={e.empresa_fletera_id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tipo de zona */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Tipo de Zona <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.tipo_de_zona}
                    onChange={e => setFormData(p => ({ ...p, tipo_de_zona: e.target.value }))}
                    disabled={!!editingKey}
                    placeholder="ej: Distribucion"
                    list="tipos-zona-list"
                    className="w-full bg-gray-800 border border-gray-600/50 text-gray-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                  <datalist id="tipos-zona-list">
                    {TIPOS_DE_ZONA_SUGERIDOS.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                {/* Tipo de servicio */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Tipo de Servicio <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.tipo_de_servicio}
                    onChange={e => setFormData(p => ({ ...p, tipo_de_servicio: e.target.value.toUpperCase() }))}
                    disabled={!!editingKey}
                    placeholder="ej: DISTRIBUCION"
                    list="tipos-servicio-list"
                    className="w-full bg-gray-800 border border-gray-600/50 text-gray-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                  <datalist id="tipos-servicio-list">
                    {TIPOS_DE_SERVICIO_SUGERIDOS.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>

                {/* Selector de zonas */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Zonas asignadas
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-xs font-normal">
                        {formData.zonas.length} seleccionadas
                      </span>
                    </label>
                    {formData.zonas.length > 0 && (
                      <button
                        onClick={() => setFormData(p => ({ ...p, zonas: [] }))}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                      >
                        Limpiar todas
                      </button>
                    )}
                  </div>

                  {/* Chips de seleccionadas */}
                  {formData.zonas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
                      {formData.zonas.map(zId => (
                        <button
                          key={zId}
                          onClick={() => toggleZona(zId)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-500/20 text-teal-300 text-xs border border-teal-500/30 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-colors"
                        >
                          {zId}
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Búsqueda + lista de zonas */}
                  <div className="rounded-xl border border-gray-700/50 overflow-hidden bg-gray-800/40">
                    <div className="p-2 border-b border-gray-700/50">
                      <input
                        type="text"
                        placeholder="Buscar zona por ID o nombre..."
                        value={searchZona}
                        onChange={e => setSearchZona(e.target.value)}
                        className="w-full bg-gray-700/50 border border-gray-600/40 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-teal-500 placeholder-gray-500"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-700/30">
                      {filteredZonas.length === 0 ? (
                        <div className="px-4 py-3 text-gray-500 text-sm text-center">No hay zonas disponibles</div>
                      ) : (
                        filteredZonas.map(z => {
                          const selected = formData.zonas.includes(z.zona_id);
                          return (
                            <button
                              key={z.zona_id}
                              onClick={() => toggleZona(z.zona_id)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors text-sm ${
                                selected
                                  ? 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'
                                  : 'text-gray-300 hover:bg-gray-700/50'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                selected
                                  ? 'bg-teal-500 border-teal-400'
                                  : 'border-gray-500'
                              }`}>
                                {selected && (
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <span className="font-mono text-xs text-gray-400 w-8 shrink-0">#{z.zona_id}</span>
                              <span className="truncate">{z.nombre ?? `Zona ${z.zona_id}`}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-800/50 border-t border-gray-700/50 shrink-0">
                <button
                  onClick={() => !saving && setFormOpen(false)}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-semibold shadow-lg transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {editingKey ? 'Guardar cambios' : 'Crear asignación'}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
