'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { authStorage } from '@/lib/auth-storage';
import { supabase } from '@/lib/supabase';

// ==============================================================================
// TIPOS
// ==============================================================================

type ActiveBlock = {
  id: number;
  block_type: 'user' | 'ip';
  key: string;
  blocked_until: string;
  created_at: string;
  reason: string | null;
  is_active: boolean;
  unblocked_at: string | null;
  unblocked_by: string | null;
};

type LoginAttempt = {
  id: number;
  ts: string;
  username: string;
  ip: string;
  user_agent: string | null;
  estado: 'success' | 'fail' | 'blocked_user' | 'blocked_ip' | 'user_eq_pass';
  whitelisted: boolean;
  escenario_id: number | null;
};

type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

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

// ==============================================================================
// PÁGINA PRINCIPAL
// ==============================================================================

export default function LoginBlocksPage() {
  const { user } = useAuth();
  const router = useRouter();

  // ─── Estado: config global ──────────────────────────────────────────────────
  const [configUsuario, setConfigUsuario] = useState<number>(3);
  const [configIp, setConfigIp] = useState<number>(5);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configToast, setConfigToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // ─── Estado: bloqueos ───────────────────────────────────────────────────────
  const [blocks, setBlocks] = useState<ActiveBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksFilter, setBlocksFilter] = useState('');
  const [blocksShowAll, setBlocksShowAll] = useState(false); // false=solo activos

  // ─── Estado: intentos ───────────────────────────────────────────────────────
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);
  const [attemptsTotal, setAttemptsTotal] = useState(0);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [attemptsLimit] = useState(200);

  // ─── Estado: realtime ───────────────────────────────────────────────────────
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const debounceRef = useRef<number | null>(null);
  const pollingRef = useRef<number | null>(null);

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

  // ─── Fetch: config global ──────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await fetch('/api/admin/login-security/config', {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setConfigUsuario(json.maxIntentosUsuario);
        setConfigIp(json.maxIntentosIp);
      }
    } catch (err) {
      console.error('[login-blocks] fetchConfig error:', err);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // ─── Fetch: bloqueos ───────────────────────────────────────────────────────
  const fetchBlocks = useCallback(async () => {
    setBlocksLoading(true);
    try {
      // El endpoint existente devuelve solo activos (blocked_until >= now).
      // Para el panel nuevo, extendemos con el campo is_active para ver histórico.
      const params = new URLSearchParams();
      if (!blocksShowAll) {
        // Solo activos — el endpoint ya filtra por blocked_until >= now
        // Además filtramos client-side por is_active=true para excluir soft-unblocked
      }
      const res = await fetch(`/api/admin/login-blocks?${params}`, {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.blocks) {
        setBlocks(json.blocks as ActiveBlock[]);
      }
    } catch (err) {
      console.error('[login-blocks] fetchBlocks error:', err);
    } finally {
      setBlocksLoading(false);
    }
  }, [blocksShowAll]);

  // ─── Fetch: intentos ───────────────────────────────────────────────────────
  const fetchAttempts = useCallback(async () => {
    setAttemptsLoading(true);
    try {
      const params = new URLSearchParams();
      if (usernameFilter) params.append('username', usernameFilter);
      if (ipFilter) params.append('ip', ipFilter);
      if (estadoFilter) params.append('estado', estadoFilter);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      params.append('limit', String(attemptsLimit));

      const res = await fetch(`/api/admin/login-logs?${params}`, {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.attempts) {
        setAttempts(json.attempts as LoginAttempt[]);
        setAttemptsTotal(json.total ?? json.attempts.length);
      }
    } catch (err) {
      console.error('[login-blocks] fetchAttempts error:', err);
    } finally {
      setAttemptsLoading(false);
    }
  }, [usernameFilter, ipFilter, estadoFilter, dateFrom, dateTo, attemptsLimit]);

  // ─── Fetch inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    fetchConfig();
    fetchBlocks();
    fetchAttempts();
  }, [user, fetchConfig, fetchBlocks, fetchAttempts]);

  // ─── Re-fetch intentos al cambiar filtros ──────────────────────────────────
  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    fetchAttempts();
  }, [usernameFilter, ipFilter, estadoFilter, dateFrom, dateTo, fetchAttempts, user]);

  // ─── Re-fetch bloqueos al cambiar filtro show-all ─────────────────────────
  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    fetchBlocks();
  }, [blocksShowAll, fetchBlocks, user]);

  // ─── Realtime: suscripción a login_blocks + login_attempts ────────────────
  useEffect(() => {
    if (user?.isRoot !== 'S') return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any;

    const triggerDebounceRefetch = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      debounceRef.current = window.setTimeout(() => {
        fetchBlocks();
        fetchAttempts();
        debounceRef.current = null;
      }, 400);
    };

    const startPollingFallback = () => {
      if (pollingRef.current) return; // ya activo
      pollingRef.current = window.setInterval(() => {
        fetchBlocks();
        fetchAttempts();
      }, 30_000);
    };

    const stopPollingFallback = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel = (supabase as any)
        .channel('login-blocks-panel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'login_blocks' }, () => {
          triggerDebounceRefetch();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'login_attempts' }, () => {
          triggerDebounceRefetch();
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            setRealtimeStatus('connected');
            stopPollingFallback();
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setRealtimeStatus('disconnected');
            startPollingFallback();
          } else {
            setRealtimeStatus('connecting');
          }
        });
    } catch (err) {
      console.error('[login-blocks] Realtime setup error:', err);
      setRealtimeStatus('disconnected');
      startPollingFallback();
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      stopPollingFallback();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (channel as any)?.unsubscribe?.();
      } catch { /* silencioso */ }
    };
  }, [user, fetchBlocks, fetchAttempts]);

  // ─── Cleanup de timers al desmontar ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ─── Guardar config global ─────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    if (configSaving) return;
    setConfigSaving(true);
    setConfigToast(null);

    try {
      const res = await fetch('/api/admin/login-security/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          maxIntentosUsuario: configUsuario,
          maxIntentosIp: configIp,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setConfigToast({ ok: true, msg: 'Configuración guardada correctamente.' });
      } else {
        setConfigToast({ ok: false, msg: json.error || 'Error al guardar' });
      }
    } catch {
      setConfigToast({ ok: false, msg: 'Error de red al guardar' });
    } finally {
      setConfigSaving(false);
      // Auto-ocultar toast después de 4s
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        setConfigToast(null);
        toastTimerRef.current = null;
      }, 4000);
    }
  };

  // ─── Desbloquear usuario o IP ──────────────────────────────────────────────
  const handleUnblock = async (type: 'user' | 'ip', value: string, displayName: string) => {
    if (!confirm(`¿Confirmar desbloqueo de ${type === 'user' ? 'usuario' : 'IP'} "${displayName}"?`)) return;

    try {
      const res = await fetch('/api/admin/login-security/unblock', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ type, value }),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        // Refetch inmediato de bloqueos
        await fetchBlocks();
      } else {
        alert(`Error al desbloquear: ${json.error || 'Error desconocido'}`);
      }
    } catch {
      alert('Error de red al desbloquear');
    }
  };

  // ─── Estilos para estado de intentos ──────────────────────────────────────
  const getEstadoBadgeClass = (estado: string) => {
    switch (estado) {
      case 'success': return 'bg-green-100 text-green-800 border-green-200';
      case 'fail': return 'bg-red-100 text-red-800 border-red-200';
      case 'blocked_user':
      case 'blocked_ip': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'user_eq_pass': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // ─── Filtrado client-side de bloqueos ─────────────────────────────────────
  const filteredBlocks = blocks.filter(b => {
    if (blocksFilter) {
      const term = blocksFilter.toLowerCase();
      if (!b.key.toLowerCase().includes(term)) return false;
    }
    // El endpoint ya devuelve solo activos (blocked_until >= now).
    // Si is_active está disponible, filtramos también por eso.
    if (!blocksShowAll && b.is_active === false) return false;
    return true;
  });

  // ─── Render: loading o no autorizado ──────────────────────────────────────
  if (!user || user.isRoot !== 'S') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Verificando acceso...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Bloqueos de Login</h1>
              <p className="text-xs text-red-100">Panel de administración — Solo root</p>
            </div>
          </div>
          {/* Indicador de estado realtime */}
          <div className="flex items-center gap-2">
            {realtimeStatus === 'connected' ? (
              <span className="flex items-center gap-1.5 text-xs text-green-200 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                En vivo
              </span>
            ) : realtimeStatus === 'connecting' ? (
              <span className="flex items-center gap-1.5 text-xs text-yellow-200 font-medium">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                Conectando...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-red-200 font-medium">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Reconectando (polling 30s)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ─── Panel: Configuración global ─────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">Configuración Global de Límites</h2>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Define cuántos intentos fallidos se permiten antes de bloquear. Los cambios aplican de inmediato al próximo intento de login.
          </p>

          {configLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600" />
              Cargando configuración...
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Intentos fallidos antes de bloquear usuario
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={configUsuario}
                  onChange={(e) => setConfigUsuario(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Intentos desde una IP (usuarios distintos) para bloquear IP
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={configIp}
                  onChange={(e) => setConfigIp(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                />
              </div>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {configSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          )}

          {configToast && (
            <div className={`mt-3 px-4 py-2 rounded-lg text-sm border ${configToast.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
              {configToast.msg}
            </div>
          )}
        </div>

        {/* ─── Panel: Bloqueos activos ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-900">Bloqueos Activos</h2>
              {!blocksLoading && (
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-orange-100 text-orange-700">
                  {filteredBlocks.length}
                </span>
              )}
            </div>
            {/* Filtro de texto para bloqueos */}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={blocksFilter}
                onChange={(e) => setBlocksFilter(e.target.value)}
                placeholder="Filtrar por usuario o IP..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 w-52"
              />
            </div>
          </div>

          {blocksLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600" />
              Cargando bloqueos...
            </div>
          ) : filteredBlocks.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No hay bloqueos activos{blocksFilter ? ' que coincidan con el filtro' : ''}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario / IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bloqueado hasta</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Creado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Razón</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBlocks.map((block) => (
                    <tr key={block.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${
                          block.block_type === 'user'
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-purple-100 text-purple-800 border-purple-200'
                        }`}>
                          {block.block_type === 'user' ? 'Usuario' : 'IP'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">{block.key}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {new Date(block.blocked_until).toLocaleString('es-UY')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {new Date(block.created_at).toLocaleString('es-UY')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {block.reason || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {block.block_type === 'user' && block.is_active !== false && (
                            <button
                              onClick={() => handleUnblock('user', block.key, block.key)}
                              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors"
                            >
                              Desbloquear usuario
                            </button>
                          )}
                          {block.block_type === 'ip' && block.is_active !== false && (
                            <button
                              onClick={() => handleUnblock('ip', block.key, block.key)}
                              className="px-2 py-1 bg-purple-500 hover:bg-purple-600 text-white text-xs font-medium rounded transition-colors"
                            >
                              Desbloquear IP
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── Panel: Intentos de login ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-900">Intentos de Login</h2>
              {!attemptsLoading && (
                <span className="text-xs text-gray-500">
                  {attempts.length} de {attemptsTotal} registros
                </span>
              )}
            </div>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Usuario</label>
              <input
                type="text"
                value={usernameFilter}
                onChange={(e) => setUsernameFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filtrar usuario..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IP</label>
              <input
                type="text"
                value={ipFilter}
                onChange={(e) => setIpFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filtrar IP..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <select
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todos</option>
                <option value="fail">Solo fallos</option>
                <option value="blocked_user">Bloqueado (usuario)</option>
                <option value="blocked_ip">Bloqueado (IP)</option>
                <option value="success">Solo éxitos</option>
                <option value="user_eq_pass">Usuario = Password</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Desde (fecha)</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hasta (fecha)</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {attemptsLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600" />
              Cargando intentos...
            </div>
          ) : attempts.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No hay intentos que coincidan con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha/Hora</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Escenario</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User-Agent</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {attempts.map((attempt) => (
                    <tr key={attempt.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {new Date(attempt.ts).toLocaleString('es-UY')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {attempt.username}
                        {attempt.whitelisted && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-green-100 text-green-700 rounded">WL</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-700">{attempt.ip}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${getEstadoBadgeClass(attempt.estado)}`}>
                          {attempt.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {attempt.escenario_id || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                        {attempt.user_agent || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attemptsTotal > attempts.length && (
                <p className="text-xs text-gray-400 mt-3 px-4">
                  Mostrando {attempts.length} de {attemptsTotal} registros. Usá los filtros para acotar la búsqueda.
                </p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
