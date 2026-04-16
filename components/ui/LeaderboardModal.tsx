'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, PedidoSupabase, ServiceSupabase } from '@/types';
import { computeDelayMinutes } from '@/utils/pedidoDelay';
import { isSubEstadoEntregado } from '@/utils/estadoPedido';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  moviles: MovilData[];
  pedidos: PedidoSupabase[];
  services: ServiceSupabase[];
  onMovilClick?: (movilId: number) => void;
  onStatClick?: (movilId: number, viewMode: 'pedidos' | 'services', stat: 'atrasados' | 'pendientes' | 'noEntregados') => void;
}

type SortKey = 'atrasados' | 'pendientes' | 'noEntregados' | 'entregados' | 'cumplimiento' | 'cumplimientoEnHora';
type ViewMode = 'pedidos' | 'services';



export default function LeaderboardModal({ isOpen, onClose, moviles, pedidos, services, onMovilClick, onStatClick }: LeaderboardModalProps) {
  const [sortBy, setSortBy] = useState<SortKey>('entregados');
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('pedidos');

  const leaderboard = useMemo(() => {
    const movilStats = moviles
      .filter(m => {
        if (showOnlyActive && (m.estadoNro === 3 || m.estadoNro === 4)) return false;
        return true;
      })
      .map(movil => {
        const movilId = Number(movil.id);
        const items = viewMode === 'pedidos'
          ? pedidos.filter(p => Number(p.movil) === movilId)
          : services.filter(s => Number(s.movil) === movilId);

        // Pendientes: estado_nro = 1
        const pendientesList = items.filter(i => Number(i.estado_nro) === 1);
        const pendientesCount = pendientesList.length;

        // Atrasados: estado_nro = 1 && delay < 0
        const atrasadosCount = pendientesList.filter(i => {
          const delay = computeDelayMinutes(i.fch_hora_max_ent_comp);
          return delay !== null && delay < 0;
        }).length;

        // No Entregados: estado_nro = 2 && sub_estado_desc != 3, 17 ni 19
        const noEntregadosCount = items.filter(i =>
          Number(i.estado_nro) === 2 && !isSubEstadoEntregado(i)
        ).length;

        // Entregados: estado_nro = 2 && sub_estado_desc = 3, 17 o 19
        const entregadosCount = items.filter(i =>
          Number(i.estado_nro) === 2 && isSubEstadoEntregado(i)
        ).length;

        // % Cumplimiento
        const relevantes = entregadosCount + pendientesCount;
        const cumplimiento = relevantes > 0 ? Math.round((entregadosCount / relevantes) * 100) : 0;

        // % Cumplimiento en hora
        const entregadosEnHora = items.filter(i => {
          if (Number(i.estado_nro) !== 2 || !isSubEstadoEntregado(i)) return false;
          if (!i.fch_hora_mov || !i.fch_hora_max_ent_comp) return false;
          return new Date(i.fch_hora_mov) <= new Date(i.fch_hora_max_ent_comp);
        }).length;
        const cumplimientoEnHora = entregadosCount > 0 ? Math.round((entregadosEnHora / entregadosCount) * 100) : 0;

        return {
          id: movilId,
          name: movil.name || String(movilId),
          color: movil.color,
          estadoNro: movil.estadoNro ?? 0,
          atrasados: atrasadosCount,
          pendientes: pendientesCount,
          noEntregados: noEntregadosCount,
          entregados: entregadosCount,
          cumplimiento,
          cumplimientoEnHora,
        };
      });

    // Solo mostrar móviles que tienen al menos un item del tipo seleccionado
    const movilsConDatos = movilStats.filter(m =>
      m.entregados > 0 || m.pendientes > 0 || m.noEntregados > 0 || m.atrasados > 0
    );

    return [...movilsConDatos].sort((a, b) => {
      switch (sortBy) {
        case 'atrasados': return b.atrasados - a.atrasados;
        case 'pendientes': return b.pendientes - a.pendientes;
        case 'noEntregados': return b.noEntregados - a.noEntregados;
        case 'entregados': return b.entregados - a.entregados;
        case 'cumplimiento': return b.cumplimiento - a.cumplimiento;
        case 'cumplimientoEnHora': return b.cumplimientoEnHora - a.cumplimientoEnHora;
        default: return 0;
      }
    });
  }, [moviles, pedidos, services, sortBy, showOnlyActive, viewMode]);

  // Summary stats
  const summary = useMemo(() => {
    const totalEntregados = leaderboard.reduce((s, m) => s + m.entregados, 0);
    const totalPendientes = leaderboard.reduce((s, m) => s + m.pendientes, 0);
    const totalRelevantes = totalEntregados + totalPendientes;
    const avgCumplimiento = totalRelevantes > 0 ? Math.round((totalEntregados / totalRelevantes) * 100) : 0;
    return { totalEntregados, avgCumplimiento, movilesCount: leaderboard.length };
  }, [leaderboard]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="leaderboard-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          id="tour-modal-ranking"
          key="leaderboard-modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-yellow-500/30"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-r from-yellow-600 via-amber-500 to-yellow-600 p-4">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9InAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMTAgTDEwIDAgTDIwIDEwIEwxMCAyMCBaIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI3ApIi8+PC9zdmc+')] opacity-30" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🏆</span>
                <div>
                  <h2 className="text-xl font-black text-white tracking-wide drop-shadow-lg">RANKING DE MÓVILES</h2>
                  <p className="text-xs text-yellow-100/80 font-medium">Tabla de clasificación del día</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* View Mode Selector + Summary Cards */}
          <div className="px-4 pt-3 pb-1 relative z-10 -mt-3">
            <div className="flex items-center gap-2 mb-2">
              <select
                value={viewMode}
                onChange={e => setViewMode(e.target.value as ViewMode)}
                className="bg-slate-700/80 text-white text-xs font-semibold rounded-lg border border-white/10 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/50 cursor-pointer"
              >
                <option value="pedidos">📦 Pedidos</option>
                <option value="services">🔧 Services</option>
              </select>
              <span className="text-[10px] text-gray-500">
                {viewMode === 'pedidos' ? 'Estadísticas de pedidos' : 'Estadísticas de services'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 px-4 relative z-10">
            <SummaryCard icon="🚗" label="Móviles" value={summary.movilesCount} color="blue" />
            <SummaryCard icon="✅" label="Entregados" value={summary.totalEntregados} color="green" />
            <SummaryCard icon="📊" label="Cumplimiento" value={`${summary.avgCumplimiento}%`} color="purple" />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <SortButton active={sortBy === 'entregados'} onClick={() => setSortBy('entregados')}>✅ Entreg.</SortButton>
              <SortButton active={sortBy === 'cumplimiento'} onClick={() => setSortBy('cumplimiento')}>📊 Cumpl.</SortButton>
              <SortButton active={sortBy === 'cumplimientoEnHora'} onClick={() => setSortBy('cumplimientoEnHora')}>⏱️ En Hora</SortButton>
              <SortButton active={sortBy === 'atrasados'} onClick={() => setSortBy('atrasados')}>🔴 Atras.</SortButton>
              <SortButton active={sortBy === 'pendientes'} onClick={() => setSortBy('pendientes')}>⏳ Pend.</SortButton>
              <SortButton active={sortBy === 'noEntregados'} onClick={() => setSortBy('noEntregados')}>❌ No Ent.</SortButton>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showOnlyActive}
                onChange={e => setShowOnlyActive(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5"
              />
              Solo activos
            </label>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin scrollbar-thumb-gray-600">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-gray-400 text-[10px] uppercase tracking-wider bg-slate-800/95 backdrop-blur-sm">
                  <th className="text-left py-2 px-2">Móvil</th>
                  <th className="text-center py-2 px-1">
                    <span title="Pendientes con atraso (delay < 0 y estado 1)">🔴 Atras.</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Pendientes (estado 1)">⏳ Pend.</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="No Entregados (estado 2, sub_estado != 3)">❌ No Ent.</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Entregados (estado 2, sub_estado = 3)">✅ Entreg.</span>
                  </th>
                  <th className="text-center py-2 px-1 w-24">
                    <span title="% Cumplimiento = entregados/(entregados+pendientes)">📊 Cumpl.</span>
                  </th>
                  <th className="text-center py-2 px-1 w-24">
                    <span title="% en hora = entregados en hora/entregados">⏱️ En Hora</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((m, idx) => {
                  const rank = idx + 1;
                  const isTop3 = rank <= 3;
                  const isFirst = rank === 1;

                  return (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className={`
                        border-b border-white/5 transition-colors
                        ${isFirst ? 'bg-yellow-500/10' : isTop3 ? 'bg-white/5' : 'hover:bg-white/5'}
                      `}
                    >
                      {/* Movil name with rank */}
                      <td className="py-2 px-2">
                        <div
                          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => onMovilClick?.(m.id)}
                          title="Ver detalle del móvil"
                        >
                          <span className={`font-mono text-[10px] font-bold w-5 ${isFirst ? 'text-yellow-400' : isTop3 ? 'text-white' : 'text-gray-500'}`}>{rank}</span>
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
                            style={{ backgroundColor: m.color || '#22c55e' }}
                          />
                          <span className={`font-bold text-xs underline decoration-dotted underline-offset-2 ${isFirst ? 'text-yellow-400' : isTop3 ? 'text-white' : 'text-gray-300'}`}>
                            {m.name}
                          </span>
                        </div>
                      </td>

                      {/* Atrasados */}
                      <td className="text-center py-2 px-1">
                        <span
                          className={`font-bold ${m.atrasados > 0 ? 'text-red-400 cursor-pointer hover:underline' : 'text-gray-600'}`}
                          onClick={() => m.atrasados > 0 && onStatClick?.(m.id, viewMode, 'atrasados')}
                        >
                          {m.atrasados}
                        </span>
                      </td>

                      {/* Pendientes */}
                      <td className="text-center py-2 px-1">
                        <span
                          className={`font-medium ${m.pendientes > 0 ? 'text-orange-400 cursor-pointer hover:underline' : 'text-gray-600'}`}
                          onClick={() => m.pendientes > 0 && onStatClick?.(m.id, viewMode, 'pendientes')}
                        >
                          {m.pendientes}
                        </span>
                      </td>

                      {/* No Entregados */}
                      <td className="text-center py-2 px-1">
                        <span
                          className={`font-medium ${m.noEntregados > 0 ? 'text-rose-400 cursor-pointer hover:underline' : 'text-gray-600'}`}
                          onClick={() => m.noEntregados > 0 && onStatClick?.(m.id, viewMode, 'noEntregados')}
                        >
                          {m.noEntregados}
                        </span>
                      </td>

                      {/* Entregados */}
                      <td className="text-center py-2 px-1">
                        <span className={`font-black text-base ${isFirst ? 'text-yellow-400' : isTop3 ? 'text-white' : 'text-green-400'}`}>
                          {m.entregados}
                        </span>
                      </td>

                      {/* % Cumplimiento */}
                      <td className="py-2 px-1">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${m.cumplimiento}%` }}
                              transition={{ delay: idx * 0.03 + 0.2, duration: 0.5 }}
                              className={`h-full rounded-full ${
                                m.cumplimiento >= 80 ? 'bg-green-500' :
                                m.cumplimiento >= 50 ? 'bg-yellow-500' :
                                m.cumplimiento > 0 ? 'bg-orange-500' : 'bg-gray-600'
                              }`}
                            />
                          </div>
                          <span className={`text-xs font-bold min-w-[32px] text-right ${
                            m.cumplimiento >= 80 ? 'text-green-400' :
                            m.cumplimiento >= 50 ? 'text-yellow-400' :
                            m.cumplimiento > 0 ? 'text-orange-400' : 'text-gray-600'
                          }`}>
                            {m.cumplimiento}%
                          </span>
                        </div>
                      </td>

                      {/* % Cumplimiento en Hora */}
                      <td className="py-2 px-1">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${m.cumplimientoEnHora}%` }}
                              transition={{ delay: idx * 0.03 + 0.3, duration: 0.5 }}
                              className={`h-full rounded-full ${
                                m.cumplimientoEnHora >= 80 ? 'bg-cyan-500' :
                                m.cumplimientoEnHora >= 50 ? 'bg-amber-500' :
                                m.cumplimientoEnHora > 0 ? 'bg-rose-500' : 'bg-gray-600'
                              }`}
                            />
                          </div>
                          <span className={`text-xs font-bold min-w-[32px] text-right ${
                            m.cumplimientoEnHora >= 80 ? 'text-cyan-400' :
                            m.cumplimientoEnHora >= 50 ? 'text-amber-400' :
                            m.cumplimientoEnHora > 0 ? 'text-rose-400' : 'text-gray-600'
                          }`}>
                            {m.cumplimientoEnHora}%
                          </span>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}

                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      No hay móviles con datos para mostrar
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-slate-900/80 border-t border-white/5 text-center">
            <p className="text-[10px] text-gray-500">
              📊 Datos del día en tiempo real • Ordenar por columna para cambiar el ranking
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============= Sub-components =============

function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-600/80 to-blue-700/80 border-blue-500/30',
    green: 'from-green-600/80 to-green-700/80 border-green-500/30',
    amber: 'from-amber-600/80 to-amber-700/80 border-amber-500/30',
    purple: 'from-purple-600/80 to-purple-700/80 border-purple-500/30',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} rounded-xl p-2.5 border shadow-lg`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <div>
          <div className="text-[9px] text-white/70 font-medium">{label}</div>
          <div className="text-lg font-black text-white leading-tight">{value}</div>
        </div>
      </div>
    </div>
  );
}

function SortButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`
        px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all
        ${active
          ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
          : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
        }
      `}
    >
      {children}
    </button>
  );
}
