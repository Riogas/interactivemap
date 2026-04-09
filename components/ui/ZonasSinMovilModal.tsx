'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EXCLUDED_ESTADOS = new Set([3, 5, 15]);

interface ZonaItem {
  zona_id: number;
  nombre: string | null;
  escenario_id: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  escenarioIds: number[];
  allMovilEstados?: Map<string, number>;
}

export default function ZonasSinMovilModal({ isOpen, onClose, escenarioIds, allMovilEstados }: Props) {
  const [loading, setLoading] = useState(false);
  const [zonas, setZonas] = useState<ZonaItem[]>([]);

  useEffect(() => {
    if (!isOpen || escenarioIds.length === 0) return;

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [zonasRes, mzRes] = await Promise.all([
          fetch('/api/zonas'),
          fetch('/api/moviles-zonas'),
        ]);
        const [zonasResult, mzResult] = await Promise.all([
          zonasRes.json(),
          mzRes.json(),
        ]);
        if (cancelled) return;

        const allZonas: ZonaItem[] = (zonasResult.data || []).filter(
          (z: any) => escenarioIds.includes(z.escenario_id) && z.geojson
        );

        let movilesZonas = (mzResult.data || []).filter(
          (mz: any) => (mz.tipo_de_servicio || '').toUpperCase() === 'URGENTE'
        );

        // Excluir móviles con estados inactivos
        if (allMovilEstados && allMovilEstados.size > 0) {
          movilesZonas = movilesZonas.filter((mz: any) => {
            const estado = allMovilEstados.get(String(mz.movil_id));
            return estado === undefined || !EXCLUDED_ESTADOS.has(estado);
          });
        }

        // Conteos por zona
        const zonaCounts = new Map<number, { prioridad: number; transito: number }>();
        for (const mz of movilesZonas) {
          const existing = zonaCounts.get(mz.zona_id) || { prioridad: 0, transito: 0 };
          if (mz.prioridad_o_transito === 1) existing.prioridad++;
          else existing.transito++;
          zonaCounts.set(mz.zona_id, existing);
        }

        // Zonas sin móvil
        const sinMovil = allZonas.filter((z) => {
          const counts = zonaCounts.get(z.zona_id);
          return !counts || (counts.prioridad === 0 && counts.transito === 0);
        });

        sinMovil.sort((a, b) => a.zona_id - b.zona_id);
        setZonas(sinMovil);
      } catch (err) {
        console.error('Error cargando zonas sin móvil:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [isOpen, escenarioIds, allMovilEstados]);

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
          className="relative w-full max-w-md bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-orange-600 to-amber-600 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-xl">
                🗺️
              </div>
              <div>
                <h2 className="text-white font-bold text-lg leading-tight">Zonas sin Móvil</h2>
                <p className="text-orange-200 text-xs">
                  {loading ? 'Cargando...' : `${zonas.length} zona${zonas.length !== 1 ? 's' : ''} sin cobertura`}
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
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-400" />
                  <p className="text-gray-400 text-sm">Cargando zonas...</p>
                </div>
              </div>
            ) : zonas.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <span className="text-4xl">✅</span>
                <p className="text-gray-400 text-sm">Todas las zonas tienen móvil asignado</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/90 backdrop-blur z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">ID</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Nombre de Zona</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Escenario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {zonas.map((z) => (
                    <tr key={z.zona_id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-orange-400 font-semibold">#{z.zona_id}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {z.nombre || <span className="text-gray-500 italic">Sin nombre</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{z.escenario_id}</td>
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
