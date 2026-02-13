'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MovilData, PedidoSupabase, ServiceSupabase } from '@/types';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  moviles: MovilData[];
  pedidos: PedidoSupabase[];
  services: ServiceSupabase[];
}

type SortKey = 'entregados' | 'pendientes' | 'total' | 'enHora' | 'cumplimiento';

const MEDAL_ICONS = ['🥇', '🥈', '🥉'];

export default function LeaderboardModal({ isOpen, onClose, moviles, pedidos, services }: LeaderboardModalProps) {
  const [sortBy, setSortBy] = useState<SortKey>('entregados');
  const [showOnlyActive, setShowOnlyActive] = useState(true);

  const leaderboard = useMemo(() => {
    // Build stats per movil
    const movilStats = moviles
      .filter(m => {
        if (showOnlyActive && (m.estadoNro === 3 || m.estadoNro === 4)) return false;
        return true;
      })
      .map(movil => {
        const movilId = Number(movil.id);

        // Pedidos of this movil
        const movilPedidos = pedidos.filter(p => Number(p.movil) === movilId);
        const pedidosPendientes = movilPedidos.filter(p => Number(p.estado_nro) === 1).length;
        const pedidosEntregados = movilPedidos.filter(p => Number(p.estado_nro) === 2).length;
        const pedidosTotal = movilPedidos.length;

        // Services of this movil
        const movilServices = services.filter(s => Number(s.movil) === movilId);
        const servicesPendientes = movilServices.filter(s => Number(s.estado_nro) === 1).length;
        const servicesRealizados = movilServices.filter(s => Number(s.estado_nro) === 2).length;
        const servicesTotal = movilServices.length;

        // "En hora": entregados that had fch_hora_max_ent_comp and were delivered before it
        // We approximate: estado 2 pedidos where fch_hora_mov <= fch_hora_max_ent_comp
        const entregadosEnHora = movilPedidos.filter(p => {
          if (Number(p.estado_nro) !== 2) return false;
          if (!p.fch_hora_mov || !p.fch_hora_max_ent_comp) return false;
          return new Date(p.fch_hora_mov) <= new Date(p.fch_hora_max_ent_comp);
        }).length;

        const totalEntregas = pedidosEntregados + servicesRealizados;
        const totalPendientes = pedidosPendientes + servicesPendientes;
        const totalItems = pedidosTotal + servicesTotal;
        const cumplimiento = totalItems > 0 ? Math.round((totalEntregas / totalItems) * 100) : 0;

        return {
          id: movilId,
          name: movil.name || String(movilId),
          color: movil.color,
          estadoNro: movil.estadoNro,
          pedidosEntregados,
          pedidosPendientes,
          pedidosTotal,
          servicesRealizados,
          servicesPendientes,
          servicesTotal,
          entregadosEnHora,
          totalEntregas,
          totalPendientes,
          totalItems,
          cumplimiento,
          capacidad: movil.tamanoLote || 0,
        };
      });

    // Sort
    const sorted = [...movilStats].sort((a, b) => {
      switch (sortBy) {
        case 'entregados': return b.totalEntregas - a.totalEntregas;
        case 'pendientes': return b.totalPendientes - a.totalPendientes;
        case 'total': return b.totalItems - a.totalItems;
        case 'enHora': return b.entregadosEnHora - a.entregadosEnHora;
        case 'cumplimiento': return b.cumplimiento - a.cumplimiento;
        default: return 0;
      }
    });

    return sorted;
  }, [moviles, pedidos, services, sortBy, showOnlyActive]);

  // Summary stats
  const summary = useMemo(() => {
    const totalEntregas = leaderboard.reduce((s, m) => s + m.totalEntregas, 0);
    const totalPendientes = leaderboard.reduce((s, m) => s + m.totalPendientes, 0);
    const totalEnHora = leaderboard.reduce((s, m) => s + m.entregadosEnHora, 0);
    const totalItems = leaderboard.reduce((s, m) => s + m.totalItems, 0);
    const avgCumplimiento = totalItems > 0 ? Math.round((totalEntregas / totalItems) * 100) : 0;
    return { totalEntregas, totalPendientes, totalEnHora, avgCumplimiento, movilesCount: leaderboard.length };
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
          key="leaderboard-modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-yellow-500/30"
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

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-2 px-4 -mt-3 relative z-10">
            <SummaryCard icon="🚗" label="Móviles" value={summary.movilesCount} color="blue" />
            <SummaryCard icon="✅" label="Entregas" value={summary.totalEntregas} color="green" />
            <SummaryCard icon="⏱️" label="En Hora" value={summary.totalEnHora} color="amber" />
            <SummaryCard icon="📊" label="Cumplimiento" value={`${summary.avgCumplimiento}%`} color="purple" />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <SortButton active={sortBy === 'entregados'} onClick={() => setSortBy('entregados')}>✅ Entregas</SortButton>
              <SortButton active={sortBy === 'cumplimiento'} onClick={() => setSortBy('cumplimiento')}>📊 Cumplimiento</SortButton>
              <SortButton active={sortBy === 'enHora'} onClick={() => setSortBy('enHora')}>⏱️ En Hora</SortButton>
              <SortButton active={sortBy === 'pendientes'} onClick={() => setSortBy('pendientes')}>📦 Pendientes</SortButton>
              <SortButton active={sortBy === 'total'} onClick={() => setSortBy('total')}>🔢 Total</SortButton>
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
                  <th className="text-left py-2 px-2 w-12">#</th>
                  <th className="text-left py-2 px-2">Móvil</th>
                  <th className="text-center py-2 px-1">
                    <span title="Pedidos Entregados">📦 Entreg.</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Services Realizados">🔧 Svc OK</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Total entregas (Pedidos + Services)">✅ Total</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Pendientes">⏳ Pend.</span>
                  </th>
                  <th className="text-center py-2 px-1">
                    <span title="Entregas en hora">⏱️ En Hora</span>
                  </th>
                  <th className="text-center py-2 px-1 w-28">
                    <span title="Porcentaje de cumplimiento">📊 Cumpl.</span>
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
                      {/* Rank */}
                      <td className="py-2 px-2">
                        {isTop3 ? (
                          <span className="text-lg">{MEDAL_ICONS[rank - 1]}</span>
                        ) : (
                          <span className="text-gray-500 font-mono text-xs">{rank}</span>
                        )}
                      </td>

                      {/* Movil name */}
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
                            style={{ backgroundColor: m.color || '#22c55e' }}
                          />
                          <span className={`font-bold ${isFirst ? 'text-yellow-400' : isTop3 ? 'text-white' : 'text-gray-300'}`}>
                            {m.name}
                          </span>
                          {m.capacidad > 0 && (
                            <span className="text-[9px] text-gray-500 font-mono">Cap:{m.capacidad}</span>
                          )}
                        </div>
                      </td>

                      {/* Pedidos Entregados */}
                      <td className="text-center py-2 px-1">
                        <span className="text-green-400 font-bold">{m.pedidosEntregados}</span>
                      </td>

                      {/* Services Realizados */}
                      <td className="text-center py-2 px-1">
                        <span className="text-blue-400 font-bold">{m.servicesRealizados}</span>
                      </td>

                      {/* Total Entregas */}
                      <td className="text-center py-2 px-1">
                        <span className={`font-black text-base ${isFirst ? 'text-yellow-400' : isTop3 ? 'text-white' : 'text-gray-200'}`}>
                          {m.totalEntregas}
                        </span>
                      </td>

                      {/* Pendientes */}
                      <td className="text-center py-2 px-1">
                        <span className={`font-medium ${m.totalPendientes > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
                          {m.totalPendientes}
                        </span>
                      </td>

                      {/* En Hora */}
                      <td className="text-center py-2 px-1">
                        <span className="text-amber-400 font-bold">{m.entregadosEnHora}</span>
                      </td>

                      {/* Cumplimiento */}
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
                    </motion.tr>
                  );
                })}

                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
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
