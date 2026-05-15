'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { authStorage } from '@/lib/auth-storage';
import type { Notificacion, NotificacionUserState, NotificacionWithStats } from '@/types/supabase';

// ==============================================================================
// CONSTANTES
// ==============================================================================

const ROLES_DISPONIBLES = ['Distribuidor', 'Dashboard', 'Despacho', 'Supervisor', 'Root'];

// ==============================================================================
// HELPERS DE FETCH CON AUTH HEADERS
// ==============================================================================

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = authStorage.getItem('trackmovil_token') ?? '';
  let isRoot = 'N';
  let username = '';
  try {
    const raw = authStorage.getItem('trackmovil_user');
    if (raw) {
      const u = JSON.parse(raw) as { isRoot?: string; username?: string };
      isRoot = u.isRoot ?? 'N';
      username = u.username ?? '';
    }
  } catch { /* silencioso */ }
  return {
    Authorization: 'Bearer ' + token,
    'x-track-isroot': isRoot,
    'x-track-user': username,
    'Content-Type': 'application/json',
  };
}

function getAuthHeadersNoContentType(): Record<string, string> {
  const headers = getAuthHeaders();
  const { 'Content-Type': _, ...rest } = headers;
  return rest;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-UY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ==============================================================================
// TIPOS LOCALES
// ==============================================================================

interface NotifFormState {
  titulo: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  activa: boolean;
  roles_target: string[];
  media_url: string | null;
  media_type: 'image' | 'video' | null;
}

const EMPTY_FORM: NotifFormState = {
  titulo: '',
  descripcion: '',
  fecha_inicio: '',
  fecha_fin: '',
  activa: true,
  roles_target: [],
  media_url: null,
  media_type: null,
};

// ==============================================================================
// COMPONENTE: MODAL DE CREACION/EDICION
// ==============================================================================

interface NotifModalProps {
  notif: Notificacion | null; // null = crear
  onClose: () => void;
  onSaved: () => void;
}

function NotifFormModal({ notif, onClose, onSaved }: NotifModalProps) {
  const isEdit = notif !== null;

  const toLocalDatetime = (iso: string) => {
    // Convierte ISO a formato datetime-local (YYYY-MM-DDTHH:mm)
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  };

  const [form, setForm] = useState<NotifFormState>(
    notif
      ? {
          titulo: notif.titulo,
          descripcion: notif.descripcion,
          fecha_inicio: toLocalDatetime(notif.fecha_inicio),
          fecha_fin: toLocalDatetime(notif.fecha_fin),
          activa: notif.activa,
          roles_target: notif.roles_target,
          media_url: notif.media_url,
          media_type: notif.media_type,
        }
      : { ...EMPTY_FORM }
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRolToggle = (rol: string) => {
    setForm((prev) => ({
      ...prev,
      roles_target: prev.roles_target.includes(rol)
        ? prev.roles_target.filter((r) => r !== rol)
        : [...prev.roles_target, rol],
    }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingMedia(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/admin/notificaciones/upload', {
        method: 'POST',
        headers: getAuthHeadersNoContentType(),
        body: fd,
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error || 'Error al subir archivo');
        return;
      }

      setForm((prev) => ({ ...prev, media_url: json.url, media_type: json.type }));
    } catch {
      setError('Error de red al subir archivo');
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleRemoveMedia = () => {
    setForm((prev) => ({ ...prev, media_url: null, media_type: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!form.titulo.trim()) { setError('El titulo es requerido'); return; }
    if (!form.descripcion.trim()) { setError('La descripcion es requerida'); return; }
    if (!form.fecha_inicio) { setError('La fecha de inicio es requerida'); return; }
    if (!form.fecha_fin) { setError('La fecha de fin es requerida'); return; }
    if (new Date(form.fecha_fin) <= new Date(form.fecha_inicio)) {
      setError('La fecha de fin debe ser mayor que la de inicio');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim(),
      fecha_inicio: new Date(form.fecha_inicio).toISOString(),
      fecha_fin: new Date(form.fecha_fin).toISOString(),
      activa: form.activa,
      roles_target: form.roles_target,
      media_url: form.media_url,
      media_type: form.media_type,
    };

    try {
      const url = isEdit ? `/api/admin/notificaciones/${notif.id}` : '/api/admin/notificaciones';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error || 'Error al guardar');
        return;
      }

      onSaved();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-t-2xl px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? 'Editar notificacion' : 'Nueva notificacion'}
          </h2>
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {/* Titulo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titulo *</label>
            <input
              type="text"
              value={form.titulo}
              onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="Titulo de la novedad..."
            />
          </div>

          {/* Descripcion */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripcion *</label>
            <textarea
              value={form.descripcion}
              onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="Descripcion de la novedad (acepta saltos de linea)..."
            />
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio *</label>
              <input
                type="datetime-local"
                value={form.fecha_inicio}
                onChange={(e) => setForm((p) => ({ ...p, fecha_inicio: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin *</label>
              <input
                type="datetime-local"
                value={form.fecha_fin}
                onChange={(e) => setForm((p) => ({ ...p, fecha_fin: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
          </div>

          {/* Activa */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, activa: !p.activa }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.activa ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.activa ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-gray-700 font-medium">
              {form.activa ? 'Activa' : 'Inactiva'}
            </span>
          </div>

          {/* Roles target */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Roles target</label>
            <div className="flex flex-wrap gap-2">
              {ROLES_DISPONIBLES.map((rol) => (
                <label
                  key={rol}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                    form.roles_target.includes(rol)
                      ? 'bg-indigo-100 border-indigo-400 text-indigo-800'
                      : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.roles_target.includes(rol)}
                    onChange={() => handleRolToggle(rol)}
                    className="sr-only"
                  />
                  {form.roles_target.includes(rol) && (
                    <svg className="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {rol}
                </label>
              ))}
            </div>
            {form.roles_target.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Sin roles seleccionados — la notificacion no sera visible para nadie.</p>
            )}
          </div>

          {/* Media upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Foto / Video (opcional)
            </label>

            {form.media_url ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-green-700 flex-1">
                    {form.media_type === 'image' ? 'Imagen subida' : 'Video subido'}
                  </span>
                  <button
                    onClick={handleRemoveMedia}
                    className="text-xs text-red-600 hover:text-red-700 font-medium"
                  >
                    Quitar
                  </button>
                </div>
                {form.media_type === 'image' && (
                  <img
                    src={form.media_url}
                    alt="Preview"
                    className="max-h-40 rounded-lg object-contain border border-gray-200"
                  />
                )}
                {form.media_type === 'video' && (
                  <video
                    src={form.media_url}
                    controls
                    className="max-h-40 rounded-lg border border-gray-200"
                  />
                )}
              </div>
            ) : (
              <div>
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                  {uploadingMedia ? (
                    <div className="flex items-center gap-2 text-gray-500 text-sm">
                      <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-600" />
                      Subiendo...
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 text-sm">
                      <svg className="w-6 h-6 mx-auto mb-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Imagen (≤5MB) o Video (≤30MB)
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={uploadingMedia}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || uploadingMedia}
            className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear notificacion'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==============================================================================
// COMPONENTE: MODAL DE LECTURAS
// ==============================================================================

interface LecturasModalProps {
  notifId: number;
  notifTitulo: string;
  onClose: () => void;
}

function LecturasModal({ notifId, notifTitulo, onClose }: LecturasModalProps) {
  const [lecturas, setLecturas] = useState<NotificacionUserState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLecturas = async () => {
      try {
        const res = await fetch(`/api/admin/notificaciones/${notifId}/lecturas`, {
          headers: getAuthHeaders(),
        });
        const json = await res.json();
        if (json.success) {
          setLecturas(json.lecturas || []);
        } else {
          setError(json.error || 'Error al obtener lecturas');
        }
      } catch {
        setError('Error de red');
      } finally {
        setLoading(false);
      }
    };
    fetchLecturas();
  }, [notifId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-t-2xl px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Lecturas</h2>
            <p className="text-xs text-indigo-200 mt-0.5 truncate max-w-md">{notifTitulo}</p>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-600" />
              Cargando lecturas...
            </div>
          ) : error ? (
            <p className="text-red-600 text-sm">{error}</p>
          ) : lecturas.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">Ningún usuario ha visto esta notificacion todavia.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dismissed</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {lecturas.map((l) => (
                  <tr key={l.username} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{l.username}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {l.visto_at ? formatDate(l.visto_at) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {l.dismissed_at ? (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded border border-gray-200">
                          {formatDate(l.dismissed_at)}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ==============================================================================
// PAGINA PRINCIPAL
// ==============================================================================

export default function NotificacionesAdminPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [notificaciones, setNotificaciones] = useState<NotificacionWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingNotif, setEditingNotif] = useState<Notificacion | null>(null);
  const [showLecturasModal, setShowLecturasModal] = useState(false);
  const [lecturasNotif, setLecturasNotif] = useState<{ id: number; titulo: string } | null>(null);

  // ─── Gate de root ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.isRoot !== 'S') {
      router.push('/dashboard');
    }
  }, [user, router]);

  // ─── Fetch notificaciones ──────────────────────────────────────────────────
  const fetchNotificaciones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/notificaciones', { headers: getAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setNotificaciones(json.notificaciones || []);
      }
    } catch (err) {
      console.error('[notificaciones-admin] fetchNotificaciones error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    fetchNotificaciones();
  }, [user, fetchNotificaciones]);

  // ─── Eliminar notificacion ─────────────────────────────────────────────────
  const handleDelete = async (notif: NotificacionWithStats) => {
    if (!confirm(`¿Eliminar la notificacion "${notif.titulo}"? Esta accion no se puede deshacer.`)) return;

    try {
      const res = await fetch(`/api/admin/notificaciones/${notif.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        await fetchNotificaciones();
      } else {
        alert(`Error al eliminar: ${json.error || 'Error desconocido'}`);
      }
    } catch {
      alert('Error de red al eliminar');
    }
  };

  const handleOpenCreate = () => {
    setEditingNotif(null);
    setShowFormModal(true);
  };

  const handleOpenEdit = (notif: NotificacionWithStats) => {
    setEditingNotif(notif);
    setShowFormModal(true);
  };

  const handleModalSaved = async () => {
    setShowFormModal(false);
    setEditingNotif(null);
    await fetchNotificaciones();
  };

  const handleOpenLecturas = (notif: NotificacionWithStats) => {
    setLecturasNotif({ id: notif.id, titulo: notif.titulo });
    setShowLecturasModal(true);
  };

  // ─── Render: loading o no autorizado ──────────────────────────────────────
  if (!user || user.isRoot !== 'S') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Verificando acceso...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Notificaciones de novedades</h1>
              <p className="text-xs text-indigo-100">Panel de administracion — Solo root</p>
            </div>
          </div>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nueva notificacion
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl shadow-md">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm p-6">
              <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-600" />
              Cargando notificaciones...
            </div>
          ) : notificaciones.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-5xl mb-4">📢</div>
              <p className="text-gray-500 mb-4">No hay notificaciones configuradas todavia.</p>
              <button
                onClick={handleOpenCreate}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Crear primera notificacion
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titulo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descripcion</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rango de fechas</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roles</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lecturas</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {notificaciones.map((notif) => (
                    <tr key={notif.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{notif.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs">
                        <div className="truncate">{notif.titulo}</div>
                        {notif.media_url && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 mt-0.5">
                            {notif.media_type === 'image' ? '🖼' : '🎬'}
                            {notif.media_type === 'image' ? 'Imagen' : 'Video'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-xs">
                        <div className="truncate">{notif.descripcion}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        <div>{formatDate(notif.fecha_inicio)}</div>
                        <div className="text-gray-400">hasta {formatDate(notif.fecha_fin)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {notif.roles_target.length === 0 ? (
                            <span className="text-xs text-gray-400">Sin roles</span>
                          ) : (
                            notif.roles_target.map((r) => (
                              <span
                                key={r}
                                className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700 rounded border border-indigo-200"
                              >
                                {r}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {notif.activa ? (
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 border border-green-200 rounded">
                            Activa
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200 rounded">
                            Inactiva
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs text-gray-700">
                          <span className="font-medium">{notif.vistos}</span>
                          <span className="text-gray-400"> visto</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">{notif.dismissed_count}</span>
                          <span className="text-gray-400"> dismissed</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(notif)}
                            className="px-2.5 py-1 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleOpenLecturas(notif)}
                            className="px-2.5 py-1 bg-slate-500 hover:bg-slate-600 text-white text-xs font-medium rounded transition-colors"
                          >
                            Lecturas
                          </button>
                          <button
                            onClick={() => handleDelete(notif)}
                            className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── Modales ─────────────────────────────────────────────────────────── */}
      {showFormModal && (
        <NotifFormModal
          notif={editingNotif}
          onClose={() => { setShowFormModal(false); setEditingNotif(null); }}
          onSaved={handleModalSaved}
        />
      )}

      {showLecturasModal && lecturasNotif && (
        <LecturasModal
          notifId={lecturasNotif.id}
          notifTitulo={lecturasNotif.titulo}
          onClose={() => { setShowLecturasModal(false); setLecturasNotif(null); }}
        />
      )}
    </div>
  );
}
