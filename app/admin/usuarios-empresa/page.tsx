'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { authStorage } from '@/lib/auth-storage';
import { isRoot } from '@/lib/auth-scope';
import { hasFuncionalidad } from '@/lib/role-funcionalidades';
import { getEmpresasParamForUpstream, type EmpresaEntry } from '@/lib/empresas-del-usuario';

// ==============================================================================
// TIPOS
// ==============================================================================

type EmpFletera = { Nombre?: string; Valor?: number; nombre?: string; valor?: number };

type UsuarioEmpresa = {
  id?: number; // id numérico del usuario en el SecuritySuite (necesario para toggle)
  username: string;
  nombre?: string;
  apellido?: string | null;
  email?: string;
  empresa?: string;
  empresa_fletera?: string;
  // Array de empresas fleteras del usuario (shape real del SecuritySuite).
  empFletera?: EmpFletera[];
  // Estado del usuario en la plataforma: "A" = activo, "I" = inactivo, etc.
  estado?: string;
  // habilitado: boolean explícito del SecuritySuite (toggle de acceso a la app).
  habilitado?: boolean;
  enabled?: boolean;
  fechaUltimoLogin?: string | null;
  ultima_actividad?: string | null;
  last_activity?: string | null;
  [key: string]: unknown;
};

type ToastState = { ok: boolean; msg: string } | null;
type FiltroEstado = 'todos' | 'habilitados' | 'deshabilitados';

// ==============================================================================
// HELPERS DE FETCH CON AUTH HEADERS
// ==============================================================================

function getAuthHeaders(roles?: string[], funcionalidades?: string[]): Record<string, string> {
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
  // El gate del server lee x-track-funcs como CSV (lib/api-auth-gates.ts).
  // El header viejo x-track-funcionalidades (JSON) ya no se procesa; mantenerlo
  // hacía que requireFuncionalidad('Gestion de Usuarios') siempre devolviera 403
  // aunque el cliente tuviera la funcionalidad asignada.
  if (funcionalidades && funcionalidades.length > 0) {
    headers['x-track-funcs'] = funcionalidades
      .map((f) => String(f).trim())
      .filter(Boolean)
      .join(',');
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

// Normaliza el estado habilitado del usuario.
// El upstream del SecuritySuite usa `habilitado: boolean` como toggle de acceso.
// `estado: "A"/"I"` es otra cosa (estado del usuario en la plataforma) y NO debe
// confundirse con habilitado/deshabilitado.
function isUsuarioHabilitado(u: UsuarioEmpresa): boolean {
  if (typeof u.habilitado === 'boolean') return u.habilitado;
  if (typeof u.enabled === 'boolean') return u.enabled;
  if (typeof u.estado === 'string') return u.estado.toUpperCase() === 'A';
  return true;
}

function getUltimaActividad(u: UsuarioEmpresa): string {
  const raw = u.fechaUltimoLogin ?? u.ultima_actividad ?? u.last_activity ?? null;
  if (!raw) return '-';
  try {
    return new Date(raw as string).toLocaleString('es-UY');
  } catch {
    return String(raw);
  }
}

function getEmpresasNombres(u: UsuarioEmpresa): string[] {
  // Shape real del SecuritySuite: empFletera es array de { Nombre, Valor }.
  if (Array.isArray(u.empFletera) && u.empFletera.length > 0) {
    return u.empFletera
      .map((e) => String(e?.Nombre ?? e?.nombre ?? '').trim())
      .filter(Boolean);
  }
  // Fallback compat con shapes anteriores.
  const single = (u.empresa_fletera ?? u.empresa) as string | undefined;
  if (typeof single === 'string' && single.trim()) return [single.trim()];
  return [];
}

function getEmpresaNombreDisplay(u: UsuarioEmpresa): string {
  const nombres = getEmpresasNombres(u);
  if (nombres.length === 0) return '-';
  if (nombres.length === 1) return nombres[0];
  return `${nombres[0]} +${nombres.length - 1}`;
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

  // Modal de confirmación de toggle
  const [confirmModal, setConfirmModal] = useState<{
    userId: number;
    username: string;
    nombre: string;
    empresas: string[];
    currentlyEnabled: boolean;
    newValue: boolean;
  } | null>(null);

  // Roles del usuario para headers — memoizado para no invalidar useCallback en cada render
  const userRoles = useMemo(
    () => user?.roles?.map((r) => r.RolNombre) ?? [],
    [user],
  );
  // Funcionalidades acumuladas de todos los roles (nombres canónicos).
  const userFuncionalidades = useMemo(
    () =>
      Array.from(
        new Set(
          (user?.roles ?? []).flatMap((r) =>
            (r.funcionalidades ?? []).map((f) => String(f?.nombre ?? '').trim()),
          ).filter(Boolean),
        ),
      ),
    [user],
  );
  const userIsRoot = isRoot(user);
  const canGestionarUsuarios = userIsRoot || hasFuncionalidad(user?.roles, 'Gestion de Usuarios');

  // ─── Gate de acceso ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }
    if (!canGestionarUsuarios) {
      // 403 visual — no redirect, mostrar mensaje (manejado abajo en el JSX)
    }
  }, [user, canGestionarUsuarios, router]);

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
        headers: getAuthHeaders(userRoles, userFuncionalidades),
      });

      const json = await res.json();

      if (!res.ok) {
        console.error('[usuarios-empresa] fetchUsuarios error:', json);
        setError(json.error ?? `Error ${res.status} al obtener usuarios`);
        return;
      }

      // El upstream del SecuritySuite responde con shape `{ success, items, total, empresasFiltradas }`.
      // Mantenemos compat con shapes alternativos (array directo / data / usuarios) por seguridad.
      const lista: UsuarioEmpresa[] = Array.isArray(json)
        ? json
        : Array.isArray(json.items)
          ? json.items
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
  }, [user, userIsRoot, userRoles, userFuncionalidades]);

  useEffect(() => {
    if (!user) return;
    fetchUsuarios();
  }, [user, fetchUsuarios]);

  // ─── Apertura del modal de confirmación al clickear el toggle ───────────────
  const requestToggle = (u: UsuarioEmpresa, nuevoEstado: boolean) => {
    if (toggling.has(u.username)) return;
    if (typeof u.id !== 'number' || !Number.isFinite(u.id)) {
      showToast(false, 'No se puede modificar este usuario: falta el id en la respuesta del servidor.');
      return;
    }
    const currentlyEnabled = isUsuarioHabilitado(u);
    setConfirmModal({
      userId: u.id,
      username: u.username,
      nombre: String(u.nombre ?? u.username),
      empresas: getEmpresasNombres(u),
      currentlyEnabled,
      newValue: nuevoEstado,
    });
  };

  // ─── Toggle habilitado/deshabilitado (ejecuta tras confirmación del modal) ──
  // Llama al endpoint real del SecuritySuite vía proxy:
  //   POST /api/admin/usuarios-empresa/toggle  body: { userId, enabled }
  // → upstream POST /api/db/usuarios/{userId}/permite-login  body: { accion: grant|revoke }
  // El upstream responde con `habilitado: boolean` (estado final real, no asumido).
  const handleToggle = async (userId: number, username: string, nuevoEstado: boolean) => {
    if (toggling.has(username)) return;

    // Optimistic UI
    setUsuarios((prev) =>
      prev.map((u) => {
        if (u.username !== username) return u;
        return { ...u, habilitado: nuevoEstado };
      }),
    );
    setToggling((prev) => new Set(prev).add(username));

    try {
      const res = await fetch('/api/admin/usuarios-empresa/toggle', {
        method: 'POST',
        headers: getAuthHeaders(userRoles, userFuncionalidades),
        body: JSON.stringify({ userId, username, enabled: nuevoEstado }),
      });

      const json = await res.json();

      if (!res.ok || json.success === false) {
        // Revertir si falló
        setUsuarios((prev) =>
          prev.map((u) => {
            if (u.username !== username) return u;
            return { ...u, habilitado: !nuevoEstado };
          }),
        );
        const detail = json?.detail?.error ?? json?.error ?? 'Error al cambiar el estado del usuario.';
        showToast(false, String(detail));
        return;
      }

      // El upstream devuelve `habilitado` con el estado final real — usar eso, no el asumido.
      const habilitadoFinal: boolean =
        typeof json.habilitado === 'boolean' ? json.habilitado : nuevoEstado;
      setUsuarios((prev) =>
        prev.map((u) => {
          if (u.username !== username) return u;
          return { ...u, habilitado: habilitadoFinal };
        }),
      );

      showToast(
        true,
        `Usuario "${username}" ${habilitadoFinal ? 'habilitado' : 'deshabilitado'} correctamente.`,
      );
    } catch {
      // Revertir en caso de error de red
      setUsuarios((prev) =>
        prev.map((u) => {
          if (u.username !== username) return u;
          return { ...u, habilitado: !nuevoEstado };
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
  // Para "empresas disponibles" usamos el listado completo de empresas de cada usuario
  // (un user puede pertenecer a varias), para que el filtro contemple todas.
  const empresasDisponibles = Array.from(
    new Set(usuarios.flatMap((u) => getEmpresasNombres(u))),
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
    if (empresaFiltro !== 'todas' && !getEmpresasNombres(u).includes(empresaFiltro)) return false;
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

  if (!canGestionarUsuarios) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h1>
          <p className="text-gray-500 text-sm">Esta sección requiere la funcionalidad &quot;Gestión de Usuarios&quot;. Pedile al administrador que te asigne esa funcionalidad en alguno de tus roles.</p>
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
              <p className="text-xs text-teal-100">Funcionalidad &quot;Gestión de Usuarios&quot; / Root</p>
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
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {getEmpresasNombres(u).length === 0 ? (
                              <span className="text-xs text-gray-400">-</span>
                            ) : (
                              getEmpresasNombres(u).map((e) => (
                                <span
                                  key={e}
                                  className="px-2 py-1 text-xs font-medium rounded bg-teal-50 text-teal-700 border border-teal-200"
                                >
                                  {e}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <ToggleSwitch
                              checked={habilitado}
                              onChange={(v) => requestToggle(u, v)}
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

      {/* ─── Modal de confirmación de habilitar/deshabilitar ──────────────────── */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header con icono */}
            <div className={`px-6 py-5 ${confirmModal.newValue ? 'bg-gradient-to-r from-teal-600 to-cyan-700' : 'bg-gradient-to-r from-orange-500 to-red-600'}`}>
              <div className="flex items-start gap-3">
                <div className="bg-white/20 rounded-full p-2 flex-shrink-0">
                  {confirmModal.newValue ? (
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {confirmModal.newValue ? '¿Habilitar usuario?' : '¿Deshabilitar usuario?'}
                  </h2>
                  <p className="text-xs text-white/85 mt-0.5">
                    Esta acción modifica el acceso del usuario a la plataforma.
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Usuario</div>
                <div className="font-mono text-sm font-semibold text-gray-900">{confirmModal.username}</div>
                <div className="text-sm text-gray-700 mt-0.5">{confirmModal.nombre}</div>
              </div>

              {confirmModal.empresas.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                    {confirmModal.empresas.length === 1 ? 'Empresa fletera' : 'Empresas fleteras'}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {confirmModal.empresas.map((e) => (
                      <span
                        key={e}
                        className="px-2 py-1 text-xs font-medium rounded bg-teal-50 text-teal-700 border border-teal-200"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className={`rounded-lg p-3 border ${confirmModal.newValue ? 'bg-teal-50 border-teal-200' : 'bg-orange-50 border-orange-200'}`}>
                <p className={`text-sm font-medium ${confirmModal.newValue ? 'text-teal-800' : 'text-orange-800'}`}>
                  {confirmModal.newValue
                    ? 'El usuario podrá iniciar sesión y operar en la plataforma.'
                    : 'El usuario perderá acceso a la plataforma hasta que sea habilitado nuevamente.'}
                </p>
              </div>
            </div>

            {/* Footer con acciones */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const { userId, username, newValue } = confirmModal;
                  setConfirmModal(null);
                  void handleToggle(userId, username, newValue);
                }}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors ${
                  confirmModal.newValue
                    ? 'bg-teal-600 hover:bg-teal-700'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {confirmModal.newValue ? 'Sí, habilitar' : 'Sí, deshabilitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
