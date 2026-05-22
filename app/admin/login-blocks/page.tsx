'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { authStorage } from '@/lib/auth-storage';
import { supabase } from '@/lib/supabase';
import { todayMontevideo } from '@/lib/date-utils';
import { isValidIpPattern } from '@/lib/ip-whitelist';

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
  // Campos enriquecidos: poblados tras resolver usuario-detalle
  nombre_completo?: string | null;
  emp_fletera?: string[] | null;
  _resolving?: boolean; // true mientras se esta resolviendo el usuario
};

type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

type UsuarioDetalle = {
  id?: number | string;
  username?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  estado?: string;
  tipoUsuario?: string;
  esRoot?: boolean;
  esExterno?: boolean;
  fechaCreacion?: string;
  fechaUltimoLogin?: string;
  empFletera?: { Nombre?: string; Valor?: string } | { Nombre?: string; Valor?: string }[] | string | string[] | null;
  [key: string]: unknown;
};

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
// HELPER: extraer array de nombres de empresa fletera
// ==============================================================================

function extractEmpFletera(empFletera: UsuarioDetalle['empFletera']): string[] {
  if (!empFletera) return [];
  // Array de objetos {Nombre, Valor}
  if (Array.isArray(empFletera)) {
    return empFletera.map((e) => {
      if (typeof e === 'string') return e;
      if (typeof e === 'object' && e !== null) {
        const obj = e as { Nombre?: string; Valor?: string };
        return obj.Nombre || obj.Valor || JSON.stringify(e);
      }
      return String(e);
    }).filter(Boolean);
  }
  // Objeto unico {Nombre, Valor}
  if (typeof empFletera === 'object' && empFletera !== null) {
    const obj = empFletera as { Nombre?: string; Valor?: string };
    return [obj.Nombre || obj.Valor || ''].filter(Boolean);
  }
  // String
  if (typeof empFletera === 'string') return [empFletera].filter(Boolean);
  return [];
}

// ==============================================================================
// COMPONENTE: Editor de whitelist de IPs
// ==============================================================================

interface IpWhitelistEditorProps {
  patterns: string[];
  onPatternsChange: (patterns: string[]) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
}

function IpWhitelistEditor({ patterns, onPatternsChange, inputValue, onInputChange }: IpWhitelistEditorProps) {
  const trimmed = inputValue.trim();
  const isEmpty = trimmed.length === 0;
  const isValid = isEmpty || isValidIpPattern(trimmed);

  const handleAdd = () => {
    if (!trimmed || !isValid) return;
    if (!patterns.includes(trimmed)) {
      onPatternsChange([...patterns, trimmed]);
    }
    onInputChange('');
  };

  return (
    <div className="bg-blue-50 rounded-lg p-4 space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Whitelist de IPs (no se bloquean automáticamente)
      </label>
      <p className="text-xs text-gray-500">
        Usá <code className="bg-blue-100 px-1 rounded text-blue-700">*</code> como wildcard por octeto.
        Ej: <code className="bg-blue-100 px-1 rounded text-blue-700">192.168.*.*</code> cubre toda la LAN clase B.
        Las IPs que matcheen estos patrones NO se bloquean, pero los intentos se siguen logeando.
      </p>
      {/* Lista de patrones actuales */}
      {patterns.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Sin patrones configurados</p>
      ) : (
        <ul className="space-y-1">
          {patterns.map((pattern, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white border border-blue-200 rounded px-2 py-1 text-blue-800">{pattern}</code>
              <button
                type="button"
                onClick={() => onPatternsChange(patterns.filter((_, i) => i !== idx))}
                className="text-red-400 hover:text-red-600 transition-colors text-xs font-medium px-1.5 py-0.5 rounded hover:bg-red-50"
                title="Remover patrón"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Input para nuevo patron */}
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="192.168.*.*"
            className={`w-full px-3 py-1.5 text-sm font-mono border rounded-lg focus:ring-2 focus:outline-none ${
              !isEmpty && !isValid
                ? 'border-red-400 focus:ring-red-300 bg-red-50'
                : 'border-blue-200 focus:ring-blue-300 bg-white'
            }`}
          />
          {!isEmpty && !isValid && (
            <p className="text-xs text-red-500 mt-0.5">Patrón inválido. Usá 4 octetos con números 0-255 o *.</p>
          )}
        </div>
        <button
          type="button"
          disabled={isEmpty || !isValid}
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Agregar
        </button>
      </div>
    </div>
  );
}

// ==============================================================================
// PAGINA PRINCIPAL
// ==============================================================================

export default function LoginBlocksPage() {
  const { user } = useAuth();
  const router = useRouter();

  // ─── Estado: config global ──────────────────────────────────────────────────
  const [configUsuario, setConfigUsuario] = useState<number>(3);
  const [configIp, setConfigIp] = useState<number>(5);
  const [configTiempoBloqueoUsuario, setConfigTiempoBloqueoUsuario] = useState<number>(15);
  const [configTiempoBloqueoIp, setConfigTiempoBloqueoIp] = useState<number>(15);
  const [configIpWhitelist, setConfigIpWhitelist] = useState<string[]>([]);
  const [configIpWhitelistInput, setConfigIpWhitelistInput] = useState<string>('');
  const [configMensajeBloqueo, setConfigMensajeBloqueo] = useState<string>(
    'Tu acceso esta bloqueado temporalmente. Contacta al administrador.'
  );
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configToast, setConfigToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // ─── Estado: modal de settings ──────────────────────────────────────────────
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // ─── Estado: bloqueos ───────────────────────────────────────────────────────
  const [blocks, setBlocks] = useState<ActiveBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksFilter, setBlocksFilter] = useState('');
  const [blocksShowAll, setBlocksShowAll] = useState(false); // false=solo activos
  const [blocksCollapsed, setBlocksCollapsed] = useState(true); // colapsado por default

  // ─── Estado: intentos ───────────────────────────────────────────────────────
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);
  const [attemptsTotal, setAttemptsTotal] = useState(0);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  // Parte A: inicializar con fecha de hoy en timezone Montevideo
  const todayStr = todayMontevideo();
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [attemptsPageSize, setAttemptsPageSize] = useState<number>(50);
  const [attemptsPage, setAttemptsPage] = useState(1); // 1-based

  // ─── Estado: export Excel ───────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  // ─── Cache de usuario-detalle ────────────────────────────────────────────────
  // key: username, value: UsuarioDetalle o null (404)
  const userDetailCacheRef = useRef<Map<string, UsuarioDetalle | null>>(new Map());

  // ─── Estado: modal detalle de usuario ───────────────────────────────────────
  const [detalleModalOpen, setDetalleModalOpen] = useState(false);
  const [detalleUsername, setDetalleUsername] = useState<string | null>(null);
  const [detalleUsuario, setDetalleUsuario] = useState<UsuarioDetalle | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleError, setDetalleError] = useState<string | null>(null);

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
        if (typeof json.tiempoBloqueoUsuarioMinutos === 'number') {
          setConfigTiempoBloqueoUsuario(json.tiempoBloqueoUsuarioMinutos);
        }
        if (typeof json.tiempoBloqueoIpMinutos === 'number') {
          setConfigTiempoBloqueoIp(json.tiempoBloqueoIpMinutos);
        }
        if (Array.isArray(json.ipWhitelistPatterns)) {
          setConfigIpWhitelist(json.ipWhitelistPatterns as string[]);
        }
        if (typeof json.mensajeBloqueo === 'string') {
          setConfigMensajeBloqueo(json.mensajeBloqueo);
        }
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
      // FIX: pasar showAll al endpoint para que filtre server-side por is_active
      const params = new URLSearchParams();
      if (blocksShowAll) {
        params.append('showAll', 'true');
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

  // ─── Helper: resolver detalle de usuario (con cache) ─────────────────────
  const resolveUsuarioDetalle = useCallback(async (username: string): Promise<UsuarioDetalle | null> => {
    const cache = userDetailCacheRef.current;
    if (cache.has(username)) {
      return cache.get(username) ?? null;
    }
    try {
      const res = await fetch(
        `/api/admin/login-security/usuario-detalle?username=${encodeURIComponent(username)}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) {
        cache.set(username, null);
        return null;
      }
      const json = await res.json();
      if (json.success && json.usuario) {
        const detalle = json.usuario as UsuarioDetalle;
        cache.set(username, detalle);
        return detalle;
      }
      cache.set(username, null);
      return null;
    } catch {
      cache.set(username, null);
      return null;
    }
  }, []);

  // ─── Enriquecer intentos con nombre y empresa fletera (batched, concurrencia 5) ──
  const enrichAttempts = useCallback(async (rawAttempts: LoginAttempt[]) => {
    // Deduplicar usernames que no esten en cache
    const uniqueUsernames = [...new Set(rawAttempts.map(a => a.username))].filter(
      u => !userDetailCacheRef.current.has(u)
    );

    // Marcar como _resolving = true para mostrar spinner
    if (uniqueUsernames.length > 0) {
      setAttempts(prev => prev.map(a =>
        uniqueUsernames.includes(a.username) ? { ...a, _resolving: true } : a
      ));
    }

    // Fetch batched con concurrencia limitada a 5
    const CONCURRENCY = 5;
    for (let i = 0; i < uniqueUsernames.length; i += CONCURRENCY) {
      const batch = uniqueUsernames.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(u => resolveUsuarioDetalle(u)));
    }

    // Merge nombres y empresas en el state de attempts
    setAttempts(prev => prev.map(attempt => {
      const cached = userDetailCacheRef.current.get(attempt.username);
      if (cached === undefined) {
        // Todavia no resuelto (no deberia pasar, pero defensivo)
        return attempt;
      }
      if (cached === null) {
        // 404 — usuario no encontrado
        return { ...attempt, nombre_completo: null, emp_fletera: null, _resolving: false };
      }
      const nombre_completo = [cached.nombre, cached.apellido].filter(Boolean).join(' ') || null;
      const emp_fletera = extractEmpFletera(cached.empFletera);
      return {
        ...attempt,
        nombre_completo,
        emp_fletera: emp_fletera.length > 0 ? emp_fletera : null,
        _resolving: false,
      };
    }));
  }, [resolveUsuarioDetalle]);

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
      params.append('limit', String(attemptsPageSize));
      params.append('offset', String((attemptsPage - 1) * attemptsPageSize));

      const res = await fetch(`/api/admin/login-logs?${params}`, {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.attempts) {
        const raw = json.attempts as LoginAttempt[];
        setAttempts(raw);
        setAttemptsTotal(json.total ?? raw.length);
        // Disparar resolucion batched en background (no bloquea el render inicial)
        enrichAttempts(raw);
      }
    } catch (err) {
      console.error('[login-blocks] fetchAttempts error:', err);
    } finally {
      setAttemptsLoading(false);
    }
  }, [usernameFilter, ipFilter, estadoFilter, dateFrom, dateTo, attemptsPageSize, attemptsPage, enrichAttempts]);

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

  // ─── Reset a pagina 1 cuando cambian filtros que afectan resultados ────────
  useEffect(() => {
    setAttemptsPage(1);
  }, [usernameFilter, ipFilter, estadoFilter, dateFrom, dateTo, attemptsPageSize]);

  // ─── Re-fetch bloqueos al cambiar filtro show-all ─────────────────────────
  useEffect(() => {
    if (user?.isRoot !== 'S') return;
    fetchBlocks();
  }, [blocksShowAll, fetchBlocks, user]);

  // ─── Realtime: suscripcion a login_blocks + login_attempts ────────────────
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
      // Bloquear guardado si hay patterns invalidos pendientes
      if (configIpWhitelistInput.trim().length > 0) {
        setConfigToast({ ok: false, msg: 'Hay un patron sin agregar. Agregalo o borrá el campo antes de guardar.' });
        return;
      }

      const res = await fetch('/api/admin/login-security/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          maxIntentosUsuario: configUsuario,
          maxIntentosIp: configIp,
          tiempoBloqueoUsuarioMinutos: configTiempoBloqueoUsuario,
          tiempoBloqueoIpMinutos: configTiempoBloqueoIp,
          ipWhitelistPatterns: configIpWhitelist,
          mensajeBloqueo: configMensajeBloqueo,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setConfigToast({ ok: true, msg: 'Configuracion guardada correctamente.' });
        // Cerrar el modal tras guardado exitoso
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => {
          setSettingsModalOpen(false);
          setConfigToast(null);
          toastTimerRef.current = null;
        }, 1500);
      } else {
        setConfigToast({ ok: false, msg: json.error || 'Error al guardar' });
      }
    } catch {
      setConfigToast({ ok: false, msg: 'Error de red al guardar' });
    } finally {
      setConfigSaving(false);
    }
  };

  // ─── Desbloquear usuario o IP ──────────────────────────────────────────────
  const handleUnblock = async (type: 'user' | 'ip', value: string, displayName: string) => {
    if (!confirm(`Confirmar desbloqueo de ${type === 'user' ? 'usuario' : 'IP'} "${displayName}"?`)) return;

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

  // ─── Abrir modal de detalle del usuario ──────────────────────────────────
  const handleOpenDetalle = useCallback(async (username: string) => {
    setDetalleUsername(username);
    setDetalleUsuario(null);
    setDetalleError(null);
    setDetalleLoading(true);
    setDetalleModalOpen(true);

    try {
      const res = await fetch(
        `/api/admin/login-security/usuario-detalle?username=${encodeURIComponent(username)}`,
        { headers: getAuthHeaders() }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setDetalleUsuario(json.usuario as UsuarioDetalle);
      } else {
        setDetalleError(json.error || 'Error al obtener detalle del usuario');
      }
    } catch {
      setDetalleError('Error de red al obtener detalle del usuario');
    } finally {
      setDetalleLoading(false);
    }
  }, []);

  // ─── Exportar a Excel ─────────────────────────────────────────────────────
  const handleExportExcel = useCallback(async () => {
    if (exporting) return;
    setExporting(true);

    try {
      // Resolver usernames que aun no esten en cache
      const missing = [...new Set(attempts.map(a => a.username))].filter(
        u => !userDetailCacheRef.current.has(u)
      );
      if (missing.length > 0) {
        const CONCURRENCY = 5;
        for (let i = 0; i < missing.length; i += CONCURRENCY) {
          const batch = missing.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(u => resolveUsuarioDetalle(u)));
        }
      }

      // Construir filas del Excel
      const rows = attempts.map(a => {
        const detalle = userDetailCacheRef.current.get(a.username) ?? null;
        const nombre = detalle
          ? [detalle.nombre, detalle.apellido].filter(Boolean).join(' ')
          : '';
        const empFletera = detalle
          ? extractEmpFletera(detalle.empFletera).join(', ')
          : '';
        return {
          'ID': a.id,
          'Fecha/Hora': new Date(a.ts).toLocaleString('es-UY'),
          'Username': a.username,
          'Nombre Completo': nombre,
          'Email': detalle?.email ?? '',
          'Telefono': detalle?.telefono ?? '',
          'Estado Login': a.estado,
          'Estado Usuario': detalle?.estado ?? '',
          'Tipo Usuario': detalle?.tipoUsuario ?? '',
          'Es Root': detalle?.esRoot != null ? (detalle.esRoot ? 'Si' : 'No') : '',
          'IP': a.ip,
          'User Agent': a.user_agent ?? '',
          'Escenario': a.escenario_id ?? '',
          'Empresa Fletera': empFletera,
          'Whitelisted': a.whitelisted ? 'Si' : 'No',
          'Fecha Creacion Usuario': detalle?.fechaCreacion
            ? new Date(detalle.fechaCreacion).toLocaleString('es-UY')
            : '',
          'Ultimo Login Usuario': detalle?.fechaUltimoLogin
            ? new Date(detalle.fechaUltimoLogin).toLocaleString('es-UY')
            : '',
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Intentos de Login');

      // Nombre de archivo con fecha y hora actual
      const now = new Date();
      const fechaStr = todayMontevideo(now);
      const horaStr = now.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '');
      const filename = `intentos-login_${fechaStr}_${horaStr}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('[login-blocks] export error:', err);
      alert('Error al generar el Excel. Intenta de nuevo.');
    } finally {
      setExporting(false);
    }
  }, [attempts, exporting, resolveUsuarioDetalle]);

  // ─── Estado del intento: label legible + estilo ──────────────────────────
  // Mapping de los 5 estados que se loguean en login_attempts.estado a un texto
  // descriptivo en espanol. Los estados de la DB se mantienen como estan
  // (CHECK constraint), solo cambia la presentacion.
  const getEstadoLabel = (estado: string): string => {
    switch (estado) {
      case 'success': return 'Login exitoso';
      case 'fail': return 'Credenciales invalidas';
      case 'blocked_user': return 'Usuario bloqueado';
      case 'blocked_ip': return 'IP bloqueada';
      case 'user_eq_pass': return 'Usuario = contrasena';
      default: return estado;
    }
  };

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
    // El endpoint ya filtra server-side: activos cuando !showAll, todos cuando showAll.
    // Aqui solo filtramos client-side el texto de busqueda.
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
    // FIX (Issue 1 — scroll): body tiene overflow-hidden en layout.tsx (necesario para el mapa).
    // Para que esta pagina scrollee, el root div debe ser h-full overflow-y-auto,
    // creando su propio scroll context dentro del body con overflow-hidden.
    <div className="h-full overflow-y-auto bg-gray-50">
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
              <p className="text-xs text-red-100">Panel de administracion — Solo root</p>
            </div>
          </div>
          {/* Indicador de estado realtime + boton settings */}
          <div className="flex items-center gap-3">
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
            {/* Boton ruedita de settings */}
            <button
              onClick={() => setSettingsModalOpen(true)}
              title="Configuracion global de limites"
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Modal: Configuracion global de limites ───────────────────────────── */}
      {settingsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setSettingsModalOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <h2 className="text-base font-semibold text-white">Configuracion Global de Limites</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-800/50 text-red-100">ADMIN</span>
              </div>
              <button
                onClick={() => setSettingsModalOpen(false)}
                className="text-white/70 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Modal body */}
            <div className="p-6">
              <p className="text-sm text-gray-500 mb-5">
                Define los limites de intentos de login y el comportamiento del bloqueo. Los cambios aplican de inmediato al proximo intento.
              </p>
              {configLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                  <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600" />
                  Cargando configuracion...
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Intentos fallidos antes de bloquear usuario
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={configUsuario}
                      onChange={(e) => setConfigUsuario(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                    />
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Intentos totales desde una IP para bloqueo de IP
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={configIp}
                      onChange={(e) => setConfigIp(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                    />
                  </div>
                  {/* Tiempos de bloqueo independientes */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Tiempo de bloqueo de usuario (minutos)
                    </label>
                    <p className="text-xs text-gray-400 mb-1">
                      Cuanto dura el bloqueo de un usuario tras superar los intentos fallidos. Rango: 1-1440 min.
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={configTiempoBloqueoUsuario}
                      onChange={(e) => setConfigTiempoBloqueoUsuario(Math.max(1, Math.min(1440, parseInt(e.target.value) || 1)))}
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                    />
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Tiempo de bloqueo de IP (minutos)
                    </label>
                    <p className="text-xs text-gray-400 mb-1">
                      Cuanto dura el bloqueo de una IP tras superar los intentos fallidos. Rango: 1-1440 min.
                    </p>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={configTiempoBloqueoIp}
                      onChange={(e) => setConfigTiempoBloqueoIp(Math.max(1, Math.min(1440, parseInt(e.target.value) || 1)))}
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-center font-mono text-lg"
                    />
                  </div>
                  {/* Editor de whitelist de IPs */}
                  <IpWhitelistEditor
                    patterns={configIpWhitelist}
                    onPatternsChange={setConfigIpWhitelist}
                    inputValue={configIpWhitelistInput}
                    onInputChange={setConfigIpWhitelistInput}
                  />
                  {/* Parte E.3: mensaje de bloqueo */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Mensaje de bloqueo
                    </label>
                    <p className="text-xs text-gray-400 mb-1">
                      Texto que se muestra al usuario cuando intenta login y esta bloqueado. Max 500 caracteres.
                    </p>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={configMensajeBloqueo}
                      onChange={(e) => setConfigMensajeBloqueo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm resize-none"
                      placeholder="Mensaje que ve el usuario al intentar login bloqueado..."
                    />
                    <p className="text-xs text-gray-400 text-right">
                      {configMensajeBloqueo.length}/500
                    </p>
                  </div>
                </div>
              )}
              {configToast && (
                <div className={`mt-4 px-4 py-2 rounded-lg text-sm border ${configToast.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {configToast.msg}
                </div>
              )}
            </div>
            {/* Modal footer */}
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setSettingsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving || configLoading}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {configSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Detalle del usuario ───────────────────────────────────────── */}
      {detalleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) setDetalleModalOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="bg-gradient-to-r from-gray-700 to-gray-800 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <h2 className="text-base font-semibold text-white">
                  Detalle de usuario
                  {detalleUsername && <span className="ml-2 font-mono text-gray-300 text-sm">@{detalleUsername}</span>}
                </h2>
              </div>
              <button
                onClick={() => setDetalleModalOpen(false)}
                className="text-white/70 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Modal body */}
            <div className="p-6">
              {detalleLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400 text-sm py-8">
                  <div className="animate-spin w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-600" />
                  Cargando datos del usuario...
                </div>
              ) : detalleError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="font-medium">No disponible</p>
                      <p className="mt-0.5 text-amber-700">{detalleError}</p>
                    </div>
                  </div>
                </div>
              ) : detalleUsuario ? (
                (() => {
                  // Helpers de decodificacion de codigos del SecuritySuite
                  const rawEstado = String(detalleUsuario.estado ?? '').trim().toUpperCase();
                  const estadoLabel =
                    rawEstado === 'A' ? 'Activo' :
                    rawEstado === 'P' ? 'Pasivo' :
                    rawEstado === 'I' ? 'Inactivo' :
                    rawEstado || '-';
                  const estadoBadge =
                    rawEstado === 'A' ? 'bg-green-100 text-green-700 border-green-200' :
                    rawEstado === 'P' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                    rawEstado === 'I' ? 'bg-gray-100 text-gray-600 border-gray-200' :
                    'bg-gray-100 text-gray-600 border-gray-200';

                  const rawTipo = String(detalleUsuario.tipoUsuario ?? '').trim().toUpperCase();
                  const tipoLabel =
                    rawTipo === 'L' ? 'Local' :
                    rawTipo === 'A' ? 'AD/Externo' :
                    rawTipo || '-';

                  const empresas = extractEmpFletera(detalleUsuario.empFletera);

                  return (
                    <div className="space-y-1">
                      {[
                        { label: 'ID', value: String(detalleUsuario.id ?? '-') },
                        { label: 'Username', value: detalleUsuario.username as string ?? '-' },
                        { label: 'Nombre completo', value: [detalleUsuario.nombre, detalleUsuario.apellido].filter(Boolean).join(' ') || '-' },
                        { label: 'Email', value: detalleUsuario.email as string ?? '-' },
                        { label: 'Telefono', value: detalleUsuario.telefono as string ?? '-' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-start gap-3 py-1.5 border-b border-gray-100">
                          <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-500">{label}</span>
                          <span className="text-sm text-gray-900 font-mono">{value}</span>
                        </div>
                      ))}
                      {/* Estado (badge con color) */}
                      <div className="flex items-center gap-3 py-1.5 border-b border-gray-100">
                        <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-500">Estado</span>
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded border ${estadoBadge}`}
                          title={rawEstado || 'desconocido'}
                        >
                          {estadoLabel}
                        </span>
                      </div>
                      {/* Tipo de usuario (decoded) */}
                      <div className="flex items-center gap-3 py-1.5 border-b border-gray-100">
                        <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-500">Tipo</span>
                        <span className="text-sm text-gray-900" title={rawTipo || 'desconocido'}>
                          {tipoLabel}
                        </span>
                      </div>
                      {[
                        { label: 'Externo', value: detalleUsuario.esExterno != null ? (detalleUsuario.esExterno ? 'Si' : 'No') : '-' },
                        { label: 'Creacion', value: detalleUsuario.fechaCreacion ? new Date(detalleUsuario.fechaCreacion as string).toLocaleString('es-UY') : '-' },
                        { label: 'Ultimo login', value: detalleUsuario.fechaUltimoLogin ? new Date(detalleUsuario.fechaUltimoLogin as string).toLocaleString('es-UY') : '-' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-start gap-3 py-1.5 border-b border-gray-100">
                          <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-500">{label}</span>
                          <span className="text-sm text-gray-900 font-mono">{value}</span>
                        </div>
                      ))}
                      {/* Empresas fleteras (array de strings) */}
                      <div className="flex items-start gap-3 py-2">
                        <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-500 pt-0.5">
                          {empresas.length > 1 ? 'Emp. Fleteras' : 'Emp. Fletera'}
                        </span>
                        {empresas.length === 0 ? (
                          <span className="text-sm text-gray-400 italic">Sin empresas asignadas</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {empresas.map((e, i) => (
                              <span
                                key={`${String(e)}-${i}`}
                                className="px-2 py-1 text-xs font-medium rounded bg-teal-50 text-teal-700 border border-teal-200"
                              >
                                {String(e)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>
            {/* Modal footer */}
            <div className="px-6 pb-5 flex justify-end">
              <button
                onClick={() => setDetalleModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-4">

        {/* ─── Colapsable de Bloqueos (arriba de los filtros) ──────────────────── */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {/* Header del colapsable */}
          <button
            onClick={() => setBlocksCollapsed(c => !c)}
            className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors ${
              filteredBlocks.length > 0
                ? 'bg-red-50 hover:bg-red-100'
                : 'bg-gray-50 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 ${filteredBlocks.length > 0 ? 'text-red-500' : 'text-gray-400'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span className={`font-semibold text-sm ${filteredBlocks.length > 0 ? 'text-red-700' : 'text-gray-700'}`}>
                {blocksShowAll ? 'Todos los Bloqueos' : 'Bloqueos Activos'}
              </span>
              {!blocksLoading && filteredBlocks.length > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold rounded-full bg-red-500 text-white">
                  {filteredBlocks.length}
                </span>
              )}
              {!blocksLoading && filteredBlocks.length === 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 text-gray-500">
                  0
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className="text-xs text-gray-500"
                onClick={(e) => e.stopPropagation()}
              >
                {blocksCollapsed ? 'Click para ver' : ''}
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${blocksCollapsed ? '' : 'rotate-180'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Contenido colapsable */}
          {!blocksCollapsed && (
            <div className="p-5 border-t border-gray-100">
              {/* Controles internos */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blocksShowAll}
                    onChange={(e) => setBlocksShowAll(e.target.checked)}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  Ver historico
                </label>
                <input
                  type="text"
                  value={blocksFilter}
                  onChange={(e) => setBlocksFilter(e.target.value)}
                  placeholder="Filtrar por usuario o IP..."
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 w-52"
                />
              </div>

              {blocksLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                  <div className="animate-spin w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600" />
                  Cargando bloqueos...
                </div>
              ) : filteredBlocks.length === 0 ? (
                <p className="text-gray-400 text-sm py-4">
                  No hay bloqueos{blocksShowAll ? '' : ' activos'}{blocksFilter ? ' que coincidan con el filtro' : ''}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario / IP</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bloqueado hasta</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Creado</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Razon</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
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
                            {block.is_active === false ? (
                              <span className="px-2 py-1 text-xs font-medium rounded border bg-gray-100 text-gray-500 border-gray-200">
                                Desbloqueado
                                {block.unblocked_by ? ` por ${block.unblocked_by}` : ''}
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium rounded border bg-orange-100 text-orange-700 border-orange-200">
                                Activo
                              </span>
                            )}
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
          )}
        </div>

        {/* ─── Panel: Intentos de login (full-width) ────────────────────────────── */}
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
            {/* Parte D: Boton exportar Excel */}
            <button
              onClick={handleExportExcel}
              disabled={exporting || attemptsLoading || attempts.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={attempts.length === 0 ? 'No hay registros para exportar' : 'Exportar registros actuales a Excel'}
            >
              {exporting ? (
                <>
                  <div className="animate-spin w-4 h-4 rounded-full border-2 border-white/30 border-t-white" />
                  Generando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Exportar Excel
                </>
              )}
            </button>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-3 mb-5">
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
                <option value="success">Login exitoso</option>
                <option value="fail">Credenciales invalidas</option>
                <option value="blocked_user">Usuario bloqueado</option>
                <option value="blocked_ip">IP bloqueada</option>
                <option value="user_eq_pass">Usuario = contrasena</option>
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
                    {/* Parte B: columna Nombre */}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Escenario</th>
                    {/* Parte C: columnas empresa fletera */}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Empresa Fletera</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User-Agent</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {attempts.map((attempt) => {
                    // Empresa fletera: chips con "+N" si hay 4 o mas
                    const empresas = attempt.emp_fletera ?? [];
                    const MAX_CHIPS = 3;
                    const visibleEmpresas = empresas.slice(0, MAX_CHIPS);
                    const hiddenCount = empresas.length - MAX_CHIPS;

                    return (
                      <tr
                        key={attempt.id}
                        className="hover:bg-blue-50 transition-colors cursor-pointer"
                        onClick={(e) => {
                          // Evitar abrir detalle al clickear sobre el badge WL o el badge de estado
                          const target = e.target as HTMLElement;
                          if (target.tagName === 'SPAN' && (target.classList.contains('wl-chip') || target.classList.contains('estado-badge'))) return;
                          handleOpenDetalle(attempt.username);
                        }}
                        title={`Ver detalle de ${attempt.username}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {new Date(attempt.ts).toLocaleString('es-UY')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {attempt.username}
                          {attempt.whitelisted && (
                            <span className="wl-chip ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-green-100 text-green-700 rounded">WL</span>
                          )}
                        </td>
                        {/* Parte B: celda Nombre con spinner */}
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {attempt._resolving ? (
                            <div className="flex items-center gap-1 text-gray-400">
                              <div className="animate-spin w-3 h-3 rounded-full border border-gray-300 border-t-gray-500" />
                              <span className="text-xs">...</span>
                            </div>
                          ) : attempt.nombre_completo ? (
                            <span>{attempt.nombre_completo}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-700">{attempt.ip}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`estado-badge px-2 py-1 text-xs font-medium rounded border ${getEstadoBadgeClass(attempt.estado)}`}
                            title={attempt.estado}
                          >
                            {getEstadoLabel(attempt.estado)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {attempt.escenario_id || '-'}
                        </td>
                        {/* Parte C: empresa fletera con chips y "+N" */}
                        <td className="px-4 py-3">
                          {attempt._resolving ? (
                            <div className="flex items-center gap-1 text-gray-400">
                              <div className="animate-spin w-3 h-3 rounded-full border border-gray-300 border-t-gray-500" />
                            </div>
                          ) : empresas.length === 0 ? (
                            <span className="text-gray-400 text-sm">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {visibleEmpresas.map((emp, i) => (
                                <span
                                  key={`${emp}-${i}`}
                                  className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-teal-50 text-teal-700 border border-teal-200 whitespace-nowrap"
                                >
                                  {emp}
                                </span>
                              ))}
                              {hiddenCount > 0 && (
                                <span
                                  className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-600 border border-gray-200 cursor-help"
                                  title={empresas.slice(MAX_CHIPS).join(', ')}
                                >
                                  +{hiddenCount}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                          {attempt.user_agent || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Paginacion */}
              {attemptsTotal > 0 && (() => {
                const totalPages = Math.max(1, Math.ceil(attemptsTotal / attemptsPageSize));
                const startItem = (attemptsPage - 1) * attemptsPageSize + 1;
                const endItem = Math.min(attemptsPage * attemptsPageSize, attemptsTotal);
                const canPrev = attemptsPage > 1;
                const canNext = attemptsPage < totalPages;
                return (
                  <div className="mt-3 px-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <span className="text-gray-500 tabular-nums">
                      Mostrando {startItem}-{endItem} de {attemptsTotal}
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        value={attemptsPageSize}
                        onChange={(e) => setAttemptsPageSize(Number(e.target.value))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        title="Registros por pagina"
                      >
                        {[25, 50, 100, 200].map(n => (
                          <option key={n} value={n}>{n} / pag</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setAttemptsPage(1)}
                        disabled={!canPrev}
                        className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Primera pagina"
                      >«</button>
                      <button
                        onClick={() => setAttemptsPage(p => Math.max(1, p - 1))}
                        disabled={!canPrev}
                        className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >‹ Anterior</button>
                      <span className="px-2 text-gray-600 tabular-nums">
                        Pag {attemptsPage} de {totalPages}
                      </span>
                      <button
                        onClick={() => setAttemptsPage(p => Math.min(totalPages, p + 1))}
                        disabled={!canNext}
                        className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >Siguiente ›</button>
                      <button
                        onClick={() => setAttemptsPage(totalPages)}
                        disabled={!canNext}
                        className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Ultima pagina"
                      >»</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
