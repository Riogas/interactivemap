'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { authStorage } from '@/lib/auth-storage';
import { isRoot } from '@/lib/auth-scope';
import { getEmpresasParamForUpstream, type EmpresaEntry } from '@/lib/empresas-del-usuario';

// ==============================================================================
// TIPOS
// ==============================================================================

type UsuarioEmpresa = {
  username: string;
  nombre?: string;
  email?: string;
  empresa?: string;
  empresa_fletera?: string;
  habilitado?: boolean;
  enabled?: boolean;
  ultima_actividad?: string | null;
  last_activity?: string | null;
  // El upstream puede devolver más campos; los extras se ignoran en la UI.
  [key: string]: unknown;
};

type ToastState = { ok: boolean; msg: string } | null;
type FiltroEstado = 'todos' | 'habilitados' | 'deshabilitados';

// ==============================================================================
// HELPERS DE FETCH CON AUTH HEADERS
// ==============================================================================

function getAuthHeaders(roles?: string[]): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = authStorage.getItem('trackmovil_token') ?? '';
  let isRootVal = 'N';
  let username = '';
  try {
    const raw = authStorage.getItem('trackmovil_user');
    if (raw) {
      const u = JSON.parse(raw) as { isRoot?: string; username?: string };
      isRootVal = u.isRoot ?? 'N';
      username = u.username ?? '';
    }
  } catch { /* silencioso */ }

  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + token,
    'x-track-isroot': isRootVal,
    'x-track-user': username,
    'Content-Type': 'application/json',
  };

  if (roles && roles.length > 0) {
    headers['x-track-roles'] = JSON.stringify(roles);
  }

  return headers;
}

// Parsea la preferencia EmpFletera del user guardado en localStorage
function parseEmpresasFromStorage(): EmpresaEntry[] {
  try {
    const raw = authStorage.getItem('trackmovil_user');
    if (!raw) return [];
    const u = JSON.parse(raw) as {
      preferencias?: Array<{ atributo: string; valor: string }>;
    };
    const pref = (u.preferencias ?? []).find((p) => p.atributo === 'EmpFletera');
    if (!pref?.valor) return [];
    const parsed = JSON.parse(pref.valor);
    if (Array.isArray(parsed)) {
      return parsed
        .map((x: { Nombre?: string; Valor?: number | string; nombre?: string; valor?: number | string }) => ({
          nombre: String(x.Nombre ?? x.nombre ?? '').trim(),
          valor: Number(x.Valor ?? x.valor),
        }))
        .filter((e) => e.nombre && Number.isFinite(e.valor));
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).map(([nombre, valor]) => ({
        nombre,
        valor: Number(valor),
      })).filter((e) => e.nombre && Number.isFinite(e.valor));
    }
    return [];
  } catch {
    return [];
  }
}

function parseAllowedEmpresasFromStorage(): number[] {
  try {
    const raw = authStorage.getItem('trackmovil_allowed_empresas');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Normaliza el estado habilitado/enabled del usuario (el upstream puede usar distintos campos)
function isUsuarioHabilitado(u: UsuarioEmpresa): boolean {
  if (typeof u.habilitado === 'boolean') return u.habilitado;
  if (typeof u.enabled === 'boolean') return u.enabled;
  // Si no hay campo explícito, asumir habilitado
  return true;
}

function getUltimaActividad(u: UsuarioEmpresa): string {
  const raw = u.ultima_actividad ?? u.last_activity ?? null;
  if (!raw) return '-';
  try {
    return new Date(raw as string).toLocaleString('es-UY');
  } catch {
    return String(raw);
  }
}

function getEmpresaNombre(u: UsuarioEmpresa): string {
  return String(u.empresa_fletera ?? u.empresa ?? '-');
}

// ==============================================================================
// COMPONENTE TOGGLE SWITCH
// ==============================================================================

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2
        ${checked ? 'bg-teal-600' : 'bg-gray-200'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
          transition duration-200 ease-in-out
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  );
}

// ==============================================================================
// PÁGINA PRINCIPAL
// ==============================================================================

export default function UsuariosEmpresaPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [usuarios, setUsuarios] = useState<UsuarioEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchText, setSearchText] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('todas');
  const [estadoFiltro, setEstadoFiltro] = useState<FiltroEstado>('todos');

  // Toggling
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Mock banner: visible mientras el toggle devuelva mock:true
  const [isMockMode, setIsMockMode] = useState(true);

  // Roles del usuario para headers
  const userRoles = user?.roles?.map((r) => r.RolNombre) ?? [];
  const userIsRoot = isRoot(user);

  // ─── Gate de acceso ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }
    const isDistribuidor = user.roles?.some(
      (r) => String(r.RolNombre).trim() === 'Distribuidor',
    );
    if (!userIsRoot && !isDistribuidor) {
      // 403 visual — no redirect, mostrar mensaje
    }
  }, [user, userIsRoot, router]);

  // ─── Carga de usuarios ────────────────────────────────────────────────────────
  const fetchUsuarios = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Construir parámetro empresas
      const empresasFromStorage = parseEmpresasFromStorage();
      const allowedIds = parseAllowedEmpresasFromStorage();
      const empresasParam = getEmpresasParamForUpstream(empresasFromStorage, allowedIds);

      if (!empresasParam && !userIsRoot) {
        setError('No hay empresas fleteras configuradas para este usuario.');
        setLoading(false);
        return;
      }

      const params = new URLSearchParams();
      if (empresasParam) params.set('empresas', empresasParam);

      const res = await fetch(`/api/admin/usuarios-empresa?${params}`, {
        headers: getAuthHeaders(userRoles),
      });

      const json = await res.json();

      if (!res.ok) {
        console.error('[usuarios-empresa] fetchUsuarios error:', json);
        setError(json.error ?? `Error ${res.status} al obtener usuarios`);
        return;
      }

      // El upstream puede devolver un array directamente o { data: [...] }
      const lista: UsuarioEmpresa[] = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.usuarios)
            ? json.usuarios
            : [];

      setUsuarios(lista);
    } catch (err) {
      console.error('[usuarios-empresa] fetchUsuarios network error:', err);
      setError('Error de red al obtener usuarios.');
    } finally {
      setLoading(false);
    }
  }, [user, userIsRoot, userRoles]);

  useEffect(() => {
    if (!user) return;
    fetchUsuarios();
  }, [user, fetchUsuarios]);

  // ─── Toggle habilitado/deshabilitado ─────────────────────────────────────────
  const handleToggle = async (username: string, nuevoEstado: boolean) => {
    if (toggling.has(username)) return;

    // Optimistic UI: actualizar estado visualmente de inmediato
    setUsuarios((prev) =>
      prev.map((u) => {
        if (u.username !== username) return u;
        return { ...u, habilitado: nuevoEstado, enabled: nuevoEstado };
      }),
    );
    setToggling((prev) => new Set(prev).add(username));

    try {
      const res = await fetch('/api/admin/usuarios-empresa/toggle', {
        method: 'POST',
        headers: getAuthHeaders(userRoles),
        body: JSON.stringify({ username, enabled: nuevoEstado }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        // Revertir si falló
        setUsuarios((prev) =>
          prev.map((u) => {
            if (u.username !== username) return u;
            return { ...u, habilitado: !nuevoEstado, enabled: !nuevoEstado };
          }),
        );
        showToast(false, json.error ?? 'Error al cambiar el estado del usuario.');
        return;
      }

      // Si el endpoint ya no devuelve mock:true, ocultamos el banner
      if (!json.mock) {
        setIsMockMode(false);
      }

      showToast(true, `Usuario "${username}" ${nuevoEstado ? 'habilitado' : 'deshabilitado'} correctamente${json.mock ? ' (MOCK)' : ''}.`);
    } catch {
      // Revertir en caso de error de red
      setUsuarios((prev) =>
        prev.map((u) => {
          if (u.username !== username) return u;
          return { ...u, habilitado: !nuevoEstado, enabled: !nuevoEstado };
        }),
      );
      showToast(false, 'Error de red al cambiar el estado del usuario.');
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(username);
        return next;
      });
    }
  };

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ─── Filtrado client-side ─────────────────────────────────────────────────────
  const empresasDisponibles = Array.from(
    new Set(usuarios.map((u) => getEmpresaNombre(u)).filter((e) => e !== '-')),
  ).sort();

  const usuariosFiltrados = usuarios.filter((u) => {
    if (searchText) {
      const term = searchText.toLowerCase();
      const matchesSearch =
        u.username.toLowerCase().includes(term) ||
        String(u.nombre ?? '').toLowerCase().includes(term) ||
        String(u.email ?? '').toLowerCase().includes(term);
      if (!matchesSearch) return false;
    }
    if (empresaFiltro !== 'todas' && getEmpresaNombre(u) !== empresaFiltro) return false;
    if (estadoFiltro === 'habilitados' && !isUsuarioHabilitado(u)) return false;
    if (estadoFiltro === 'deshabilitados' && isUsuarioHabilitado(u)) return false;
    return true;
  });

  // ─── Gate visual ─────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Verificando acceso...</div>
      </div>
    );
  }

  const isDistribuidor = user.roles?.some(
    (r) => String(r.RolNombre).trim() === 'Distribuidor',
  );
  if (!userIsRoot && !isDistribuidor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h1>
          <p className="text-gray-500 text-sm">Esta sección es solo para usuarios con rol Distribuidor o administradores root.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">

      {/* ─── Header ────────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Gestión de usuarios</h1>
              <p className="text-xs text-teal-100">Solo Distribuidor / Root</p>
            </div>
          </div>
          <button
            onClick={() => fetchUsuarios()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">

        {/* ─── Banner MOCK ─────────────────────────────────────────────────────── */}
        {isMockMode && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-yellow-800">El toggle está en modo mock</p>
              <p className="text-xs text-yellow-700 mt-0.5">
                El cambio no persiste todavía hasta que se conecte el endpoint real. Los cambios son solo visuales en esta sesión.
              </p>
            </div>
          </div>
        )}

        {/* ─── Toast ───────────────────────────────────────────────────────────── */}
        {toast && (
          <div className={`px-4 py-3 rounded-xl text-sm border font-medium ${toast.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {toast.msg}
          </div>
        )}

        {/* ─── Panel de tabla ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-md p-6">

          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-3 mb-5">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Username, nombre, email..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            {empresasDisponibles.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Empresa fletera</label>
                <select
                  value={empresaFiltro}
                  onChange={(e) => setEmpresaFiltro(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="todas">Todas</option>
                  {empresasDisponibles.map((emp) => (
                    <option key={emp} value={emp}>{emp}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <select
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value as FiltroEstado)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="todos">Todos</option>
                <option value="habilitados">Habilitados</option>
                <option value="deshabilitados">Deshabilitados</option>
              </select>
            </div>

            <div className="text-xs text-gray-400 self-end pb-2">
              {!loading && `${usuariosFiltrados.length} de ${usuarios.length} usuarios`}
            </div>
          </div>

          {/* Estado de carga */}
          {loading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
              <div className="animate-spin w-5 h-5 rounded-full border-2 border-gray-300 border-t-teal-600" />
              Cargando usuarios...
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm font-medium">{error}</p>
              <button
                onClick={() => fetchUsuarios()}
                className="mt-3 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Sin resultados */}
          {!loading && !error && usuariosFiltrados.length === 0 && (
            <p className="text-gray-400 text-sm py-8 text-center">
              {usuarios.length === 0
                ? 'No se encontraron usuarios para las empresas de este distribuidor.'
                : 'No hay usuarios que coincidan con los filtros aplicados.'}
            </p>
          )}

          {/* Tabla */}
          {!loading && !error && usuariosFiltrados.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Empresa</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Última actividad</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {usuariosFiltrados.map((u) => {
                    const habilitado = isUsuarioHabilitado(u);
                    const isToggling = toggling.has(u.username);
                    return (
                      <tr key={u.username} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono font-semibold text-gray-900">
                          {u.username}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {u.nombre ?? '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {u.email ?? '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs font-medium rounded bg-teal-50 text-teal-700 border border-teal-200">
                            {getEmpresaNombre(u)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <ToggleSwitch
                              checked={habilitado}
                              onChange={(v) => handleToggle(u.username, v)}
                              disabled={isToggling}
                            />
                            <span className={`text-xs font-medium ${habilitado ? 'text-teal-700' : 'text-gray-400'}`}>
                              {isToggling ? '...' : habilitado ? 'Habilitado' : 'Deshabilitado'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">
                          {getUltimaActividad(u)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
