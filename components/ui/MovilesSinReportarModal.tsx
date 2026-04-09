'use client';

import { useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MovilData } from '@/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  moviles: MovilData[];
}

export default function MovilesSinReportarModal({ isOpen, onClose, moviles }: Props) {
  const [choferes, setChoferes] = useState<Map<number, string>>(new Map());
  const [loadingChoferes, setLoadingChoferes] = useState(false);

  const sinReportar = useMemo(() => {
    return moviles
      .filter(m => {
        if (!m.isInactive) return false;
        const estadoNro = m.estadoNro;
        return estadoNro === undefined || estadoNro === null || [0, 1, 2].includes(estadoNro);
      })
      .sort((a, b) => a.id - b.id);
  }, [moviles]);

  // Fetch choferes en paralelo al abrir
  useEffect(() => {
    if (!isOpen || sinReportar.length === 0) return;

    let cancelled = false;
    const fetchChoferes = async () => {
      setLoadingChoferes(true);
      const today = new Date().toISOString().split('T')[0];
      const results = await Promise.allSettled(
        sinReportar.map(m =>
          fetch(`/api/movil-session/${m.id}?fecha=${today}`).then(r => r.ok ? r.json() : null)
        )
      );
      if (cancelled) return;
      const map = new Map<number, string>();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.chofer) {
          map.set(sinReportar[i].id, r.value.chofer);
        }
      });
      setChoferes(map);
      setLoadingChoferes(false);
    };

    fetchChoferes();
    return () => { cancelled = true; };
  }, [isOpen, sinReportar]);

  const formatFecha = (fechaStr?: string) => {
    if (!fechaStr) return '—';
    const d = new Date(fechaStr);
    return d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

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
          className="relative w-full max-w-lg bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-700 to-rose-700 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-xl">
                📡
              </div>
              <div>
                <h2 className="text-white font-bold text-lg leading-tight">Móviles sin Reportar</h2>
                <p className="text-red-200 text-xs">
                  {sinReportar.length} móvil{sinReportar.length !== 1 ? 'es' : ''} sin GPS reciente
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/25 text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto">
            {sinReportar.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <span className="text-4xl">✅</span>
                <p className="text-gray-400 text-sm">Todos los móviles están reportando</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/90 backdrop-blur z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Móvil</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Chofer</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Último reporte GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {sinReportar.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-red-400 font-semibold">#{m.id}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-200 text-xs">
                        {loadingChoferes
                          ? <span className="text-gray-500 italic">...</span>
                          : choferes.get(m.id) || <span className="text-gray-500 italic">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                        {formatFecha(m.currentPosition?.fechaInsLog)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
