'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface OsmCategory {
  key: string;
  label: string;
  icono: string;
}

interface ImportResult {
  categoria: string;
  importados: number;
  existentes: number;
  errores: number;
}

interface OsmImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void; // Callback para recargar POIs en el mapa
  usuarioEmail: string;
}

export default function OsmImportModal({ isOpen, onClose, onImportComplete, usuarioEmail }: OsmImportModalProps) {
  const [categorias, setCategorias] = useState<OsmCategory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingCats, setIsLoadingCats] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cargar categorías disponibles
  useEffect(() => {
    if (!isOpen) return;
    setIsLoadingCats(true);
    setResults(null);
    setError(null);

    fetch('/api/puntos-interes/import-osm')
      .then(res => res.json())
      .then(data => {
        if (data.categorias) {
          setCategorias(data.categorias);
          // Preseleccionar riogas y gobierno
          setSelected(new Set(['riogas', 'gobierno']));
        }
      })
      .catch(e => setError('No se pudieron cargar las categorías'))
      .finally(() => setIsLoadingCats(false));
  }, [isOpen]);

  const toggleCategory = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(categorias.map(c => c.key)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch('/api/puntos-interes/import-osm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categorias: Array.from(selected),
          usuario_email: usuarioEmail,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResults(data.resultados);
        onImportComplete();
      } else {
        setError(data.error || 'Error al importar');
      }
    } catch (e: any) {
      setError(e.message || 'Error de conexión');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteOsm = async () => {
    if (!confirm('¿Eliminar TODOS los puntos importados de OpenStreetMap?')) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/puntos-interes/import-osm?usuario_email=${encodeURIComponent(usuarioEmail)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (data.success) {
        setResults(null);
        onImportComplete();
        setError(null);
        alert(`✅ ${data.eliminados} puntos OSM eliminados`);
      } else {
        setError(data.error || 'Error al eliminar');
      }
    } catch (e: any) {
      setError(e.message || 'Error de conexión');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalImportados = results?.reduce((sum, r) => sum + r.importados, 0) || 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🗺️</span>
              <div>
                <h2 className="text-lg font-bold text-white">Importar desde OpenStreetMap</h2>
                <p className="text-xs text-gray-400">Puntos de interés de Uruguay</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Resultados de importación */}
            {results && (
              <div className="bg-green-900/30 border border-green-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-400 font-semibold">
                  <span>✅</span>
                  <span>Importación completada — {totalImportados} POIs importados</span>
                </div>
                <div className="space-y-1">
                  {results.map(r => (
                    <div key={r.categoria} className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">
                        {categorias.find(c => c.key === r.categoria)?.icono}{' '}
                        {categorias.find(c => c.key === r.categoria)?.label || r.categoria}
                      </span>
                      <span className={r.importados > 0 ? 'text-green-400' : 'text-gray-500'}>
                        {r.importados} nuevos
                        {r.existentes > 0 && <span className="text-gray-500"> · {r.existentes} existentes</span>}
                        {r.errores > 0 && <span className="text-red-400"> · {r.errores} errores</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-400 text-sm">
                ❌ {error}
              </div>
            )}

            {/* Selector de categorías */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-300">Categorías a importar</h3>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-xs text-blue-400 hover:text-blue-300 transition"
                  >
                    Todas
                  </button>
                  <span className="text-gray-600">|</span>
                  <button
                    onClick={selectNone}
                    className="text-xs text-gray-400 hover:text-gray-300 transition"
                  >
                    Ninguna
                  </button>
                </div>
              </div>

              {isLoadingCats ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {categorias.map(cat => (
                    <button
                      key={cat.key}
                      onClick={() => toggleCategory(cat.key)}
                      disabled={isLoading}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                        selected.has(cat.key)
                          ? 'bg-blue-900/40 border-blue-500 text-white'
                          : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-500'
                      } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="text-lg">{cat.icono}</span>
                      <span className="truncate">{cat.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-400 space-y-1">
              <p>📡 Los datos se obtienen de <strong className="text-gray-300">OpenStreetMap</strong> (Overpass API, gratis).</p>
              <p>🔄 Si un punto ya existe (mismo nombre), no se duplica.</p>
              <p>🇺🇾 Se importan únicamente POIs dentro de Uruguay.</p>
              <p>⏱️ La importación puede tardar 10-30 segundos dependiendo de las categorías.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
            <button
              onClick={handleDeleteOsm}
              disabled={isLoading}
              className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
            >
              🗑️ Limpiar OSM
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isLoading}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
              >
                Cerrar
              </button>
              <button
                onClick={handleImport}
                disabled={isLoading || selected.size === 0}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Importando...
                  </>
                ) : (
                  <>
                    🗺️ Importar ({selected.size})
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
