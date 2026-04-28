'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ZonaItem {
  zona_id: number;
  nombre: string | null;
  minutos: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  escenarioIds: number[];
  /** Scope de zonas permitidas (null = root/despacho, sin restricción). */
  scopedZonaIds?: Set<number> | null;
  /** Empresas permitidas para pasar al server (?empresaIds=). null = sin scope. */
  scopedEmpresas?: number[] | null;
}

export default function ZonasNoActivasModal({ isOpen, onClose, escenarioIds, scopedZonaIds = null, scopedEmpresas = null }: Props) {
  const [loading, setLoading] = useState(false);
  const [zonas, setZonas] = useState<ZonaItem[]>([]);

  // Stable keys para useEffect deps
  const scopedEmpresasKey = scopedEmpresas ? scopedEmpresas.join(',') : '';
  const scopedZonasKey = scopedZonaIds ? Array.from(scopedZonaIds).sort((a, b) => a - b).join(',') : '';

  useEffect(() => {
    if (!isOpen || escenarioIds.length === 0) return;
    // Fail-closed: scope con set vacío → modal vacío sin fetch
    if (scopedZonaIds && scopedZonaIds.size === 0) {
      setZonas([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const empresaIdsParam = scopedEmpresas && scopedEmpresas.length > 0
          ? `?empresaIds=${scopedEmpresas.join(',')}`
          : '';
        const [zonasRes, demorasRes] = await Promise.all([
          fetch(`/api/zonas${empresaIdsParam}`),
          fetch(`/api/demoras${empresaIdsParam}`),
        ]);
        const [zonasResult, demorasResult] = await Promise.all([
          zonasRes.json(),
          demorasRes.json(),
        ]);
        if (cancelled) return;

        const allZonas = (zonasResult.data || []).filter(
          (z: any) =>
            escenarioIds.includes(z.escenario_id) &&
            z.geojson &&
            (scopedZonaIds == null || scopedZonaIds.has(z.zona_id))
        );

        // Mapa zona_id → demora con mayor minutos
        const dMap = new Map<number, { minutos: number; activa: boolean; nombre?: string }>();
        for (const d of (demorasResult.data || [])) {
          if (!escenarioIds.includes(d.escenario_id)) continue;
          if (scopedZonaIds != null && !scopedZonaIds.has(d.zona_id)) continue;
          const existing = dMap.get(d.zona_id);
          if (!existing || d.minutos > existing.minutos) {
            dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
          }
        }

        // Zonas no activas: activa === false y están en zonasAllData
        const zonaNames = new Map<number, string | null>(allZonas.map((z: any) => [z.zona_id, z.nombre]));
        const noActivas: ZonaItem[] = [];
        for (const z of allZonas) {
          const info = dMap.get(z.zona_id);
          if (info && info.activa === false) {
            noActivas.push({ zona_id: z.zona_id, nombre: z.nombre, minutos: info.minutos });
          }
        }

        noActivas.sort((a, b) => a.zona_id - b.zona_id);
        setZonas(noActivas);
      } catch (err) {
        console.error('Error cargando zonas no activas:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, escenarioIds, scopedEmpresasKey, scopedZonasKey]);

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
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-800 to-red-600 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-xl">
                🔴
              </div>
              <div>
                <h2 className="text-white font-bold text-lg leading-tight">Zonas No Activas</h2>
                <p className="text-red-200 text-xs">
                  {loading ? 'Cargando...' : `${zonas.length} zona${zonas.length !== 1 ? 's' : ''} sin actividad`}
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
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-400" />
                  <p className="text-gray-400 text-sm">Cargando zonas...</p>
                </div>
              </div>
            ) : zonas.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <span className="text-4xl">✅</span>
                <p className="text-gray-400 text-sm">Todas las zonas están activas</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800/90 backdrop-blur z-10">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">ID</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Nombre de Zona</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-semibold uppercase text-xs tracking-wider">Demora (min)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {zonas.map((z) => (
                    <tr key={z.zona_id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-red-400 font-semibold">#{z.zona_id}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {z.nombre || <span className="text-gray-500 italic">Sin nombre</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {z.minutos > 0 ? `${z.minutos} min` : '—'}
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
