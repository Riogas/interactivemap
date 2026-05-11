'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface EscenarioSettingRow {
  escenarioId: number;
  nombre: string | null;
  pedidosSaMinutosAntes: number | null;
  aplicaServNocturno: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface RowState {
  value: string; // '' significa null (sin filtro de minutos)
  saveState: SaveState;
  dirty: boolean;
  aplicaServNocturno: boolean;
  nocturnaSaveState: SaveState;
}

function minutesToStr(v: number | null): string {
  if (v === null || v === 0) return '';
  return String(v);
}

function strToMinutes(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

export default function ConfiguracionPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<EscenarioSettingRow[]>([]);
  const [rowStates, setRowStates] = useState<Map<number, RowState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // Gate: redirigir si no es root
  useEffect(() => {
    if (user !== null && user?.isRoot !== 'S') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/escenario-settings', {
        headers: {
          'x-track-isroot': user?.isRoot ?? '',
          'x-track-user': user?.username ?? '',
        },
      });
      const json = await res.json();
      if (!json.success) {
        setLoadError(json.error ?? 'Error al cargar');
        return;
      }
      const data: EscenarioSettingRow[] = json.data;
      setRows(data);
      const states = new Map<number, RowState>();
      for (const row of data) {
        states.set(row.escenarioId, {
          value: minutesToStr(row.pedidosSaMinutosAntes),
          saveState: 'idle',
          dirty: false,
          aplicaServNocturno: row.aplicaServNocturno,
          nocturnaSaveState: 'idle',
        });
      }
      setRowStates(states);
    } catch {
      setLoadError('Error de red al cargar configuracion');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (user?.isRoot === 'S') {
      load();
    }
  }, [load, user]);

  function handleChange(escenarioId: number, value: string) {
    setRowStates(prev => {
      const next = new Map(prev);
      const cur = next.get(escenarioId) ?? { value: '', saveState: 'idle' as SaveState, dirty: false, aplicaServNocturno: true, nocturnaSaveState: 'idle' as SaveState };
      next.set(escenarioId, { ...cur, value, dirty: true, saveState: 'idle' });
      return next;
    });
  }

  async function handleSave(escenarioId: number) {
    const state = rowStates.get(escenarioId);
    if (!state || !state.dirty) return;

    const pedidosSaMinutosAntes = strToMinutes(state.value);

    setRowStates(prev => {
      const next = new Map(prev);
      next.set(escenarioId, { ...state, saveState: 'saving' });
      return next;
    });

    try {
      const res = await fetch('/api/admin/escenario-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-track-isroot': user?.isRoot ?? '',
          'x-track-user': user?.username ?? '',
        },
        body: JSON.stringify({ escenarioId, pedidosSaMinutosAntes }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Error al guardar');

      setRowStates(prev => {
        const next = new Map(prev);
        next.set(escenarioId, { ...state, saveState: 'saved', dirty: false });
        return next;
      });

      // Limpiar indicador "guardado" despues de 2s
      setTimeout(() => {
        setRowStates(prev => {
          const next = new Map(prev);
          const cur = next.get(escenarioId);
          if (cur && cur.saveState === 'saved') {
            next.set(escenarioId, { ...cur, saveState: 'idle' });
          }
          return next;
        });
      }, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setRowStates(prev => {
        const next = new Map(prev);
        next.set(escenarioId, { ...state, saveState: 'error', dirty: true });
        return next;
      });
      console.error('[configuracion] save error:', msg);
    }
  }

  async function handleToggleNocturno(escenarioId: number, newValue: boolean) {
    const state = rowStates.get(escenarioId);
    if (!state) return;

    // Optimistic update + saving state
    setRowStates(prev => {
      const next = new Map(prev);
      next.set(escenarioId, { ...state, aplicaServNocturno: newValue, nocturnaSaveState: 'saving' });
      return next;
    });

    try {
      const res = await fetch('/api/admin/escenario-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-track-isroot': user?.isRoot ?? '',
          'x-track-user': user?.username ?? '',
        },
        body: JSON.stringify({ escenarioId, aplica_serv_nocturno: newValue }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Error al guardar');

      setRowStates(prev => {
        const next = new Map(prev);
        const cur = next.get(escenarioId);
        if (cur) next.set(escenarioId, { ...cur, nocturnaSaveState: 'saved' });
        return next;
      });

      // Limpiar indicador "guardado" despues de 2s
      setTimeout(() => {
        setRowStates(prev => {
          const next = new Map(prev);
          const cur = next.get(escenarioId);
          if (cur && cur.nocturnaSaveState === 'saved') {
            next.set(escenarioId, { ...cur, nocturnaSaveState: 'idle' });
          }
          return next;
        });
      }, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      // Revertir el toggle en caso de error
      setRowStates(prev => {
        const next = new Map(prev);
        const cur = next.get(escenarioId);
        if (cur) next.set(escenarioId, { ...cur, aplicaServNocturno: !newValue, nocturnaSaveState: 'error' });
        return next;
      });
      console.error('[configuracion] toggle nocturno error:', msg);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (user.isRoot !== 'S') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-500">Acceso denegado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Configuracion por escenario</h1>
          <p className="text-sm text-gray-600 mt-1">
            Ajustes operacionales por escenario. Los cambios se guardan automaticamente.
          </p>
        </div>

        {loading && (
          <div className="text-center py-10 text-gray-500">Cargando...</div>
        )}

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700 mb-4">
            {loadError}
          </div>
        )}

        {!loading && !loadError && rows.length === 0 && (
          <div className="text-center py-10 text-gray-400">No se encontraron escenarios.</div>
        )}

        {!loading && rows.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Escenario</th>
                  <th className="px-4 py-3 text-left font-semibold">Nombre</th>
                  <th className="px-4 py-3 text-left font-semibold">Minutos antes</th>
                  <th className="px-4 py-3 text-left font-semibold">Cubre nocturno</th>
                  <th className="px-4 py-3 text-left font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => {
                  const state = rowStates.get(row.escenarioId) ?? { value: '', saveState: 'idle' as SaveState, dirty: false, aplicaServNocturno: true, nocturnaSaveState: 'idle' as SaveState };
                  return (
                    <tr key={row.escenarioId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-700">{row.escenarioId}</td>
                      <td className="px-4 py-3 text-gray-700">{row.nombre ?? '—'}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Sin filtro"
                          value={state.value}
                          onChange={e => handleChange(row.escenarioId, e.target.value)}
                          onBlur={() => handleSave(row.escenarioId)}
                          className="w-28 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          disabled={state.saveState === 'saving'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={state.aplicaServNocturno}
                            onClick={() => handleToggleNocturno(row.escenarioId, !state.aplicaServNocturno)}
                            disabled={state.nocturnaSaveState === 'saving'}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${
                              state.aplicaServNocturno ? 'bg-blue-600' : 'bg-gray-200'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                state.aplicaServNocturno ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                          <span className={`text-xs ${state.aplicaServNocturno ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                            {state.aplicaServNocturno ? 'Si' : 'No'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(state.saveState === 'saving' || state.nocturnaSaveState === 'saving') && (
                          <span className="text-blue-500 text-xs">Guardando...</span>
                        )}
                        {state.saveState === 'saved' && state.nocturnaSaveState !== 'saving' && (
                          <span className="text-green-600 text-xs font-medium">Guardado</span>
                        )}
                        {state.nocturnaSaveState === 'saved' && state.saveState !== 'saving' && (
                          <span className="text-green-600 text-xs font-medium">Guardado</span>
                        )}
                        {(state.saveState === 'error' || state.nocturnaSaveState === 'error') && (
                          <span className="text-red-500 text-xs">Error — intenta de nuevo</span>
                        )}
                        {state.saveState === 'idle' && state.dirty && state.nocturnaSaveState === 'idle' && (
                          <span className="text-orange-400 text-xs">Sin guardar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 px-4 py-3 border-t border-gray-100">
              Minutos antes: se guarda al salir del campo (on blur).
              Cubre nocturno: se guarda al cambiar el toggle.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
