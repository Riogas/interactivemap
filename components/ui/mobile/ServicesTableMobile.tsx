'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MobileSheet from './MobileSheet';
import ServiceCardMobile from './ServiceCardMobile';
import { FilterGroup, Chip, FilterSelect, segClass } from './filterControls';
import { ServiceSupabase } from '@/types';
import { DelayInfo } from '@/utils/pedidoDelay';

type SortDir = 'asc' | 'desc';

export interface ServicesMobileCtx {
  isOpen: boolean;
  onClose: () => void;
  isFinalizados: boolean;
  isFilterDisabled: boolean;
  canVerSinAsignarUnitario: boolean;
  sorted: { service: ServiceSupabase; delayMins: number | null; delayInfo: DelayInfo }[];
  totalBase: number;
  stats: Record<string, number>;
  page: number;
  setPage: (u: number | ((p: number) => number)) => void;
  pageSize: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFilters: (u: any) => void;
  vista: 'pendientes' | 'finalizados';
  onVistaChange?: (v: 'pendientes' | 'finalizados') => void;
  sortKey: string;
  sortDir: SortDir;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSort: (k: any) => void;
  sortOptions: { key: string; label: string }[];
  atrasoOptions: { key: string; label: string }[];
  uniqueZonas: number[];
  uniqueDefectos: string[];
  movilCombo: {
    ids: number[];
    selected: number[];
    onToggle: (id: number, checked: boolean) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    getMovilName: (id: number | null) => string;
  };
  onServiceClick?: (id: number) => void;
  onMovilClick?: (id: number) => void;
  getMovilName: (id: number | null) => string;
  getMovilColor: (id: number | null) => string;
  formatTime: (s: string | null) => string;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  activeFilterCount: number;
}

export default function ServicesTableMobile({ ctx }: { ctx: ServicesMobileCtx }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const visibleCount = (ctx.page + 1) * ctx.pageSize;
  const visible = ctx.sorted.slice(0, visibleCount);
  const hasMore = visibleCount < ctx.sorted.length;

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) ctx.setPage((p) => p + 1);
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, ctx]);

  return (
    <AnimatePresence>
      {ctx.isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] bg-gray-900 flex flex-col"
        >
          {/* Header */}
          <div className="flex-shrink-0 border-b border-gray-700/50 px-4 pt-3 pb-2 bg-gray-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Vista Extendida · Services</h2>
                <p className="text-[11px] text-gray-400">
                  {ctx.sorted.length} {ctx.isFinalizados ? 'finalizado' : 'pendiente'}{ctx.sorted.length !== 1 ? 's' : ''}
                  {ctx.hasActiveFilters ? ` · de ${ctx.totalBase}` : ''}
                </p>
              </div>
              <button onClick={ctx.onClose} className="p-2 -mr-2 text-gray-400 hover:text-white" aria-label="Cerrar">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="mt-2 flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
              <button
                disabled={ctx.isFilterDisabled}
                onClick={() => { if (!ctx.isFilterDisabled) { ctx.onVistaChange?.('pendientes'); ctx.setFilters((f: Record<string, unknown>) => ({ ...f, entrega: 'todos', atraso: [] })); } }}
                className={`${segClass(ctx.vista === 'pendientes')} ${ctx.isFilterDisabled ? 'opacity-50' : ''}`}
              >
                Pendientes
              </button>
              <button
                disabled={ctx.isFilterDisabled}
                onClick={() => { if (!ctx.isFilterDisabled) { ctx.onVistaChange?.('finalizados'); ctx.setFilters((f: Record<string, unknown>) => ({ ...f, asignacion: 'todos', atraso: [] })); } }}
                className={`${segClass(ctx.isFinalizados)} ${ctx.isFilterDisabled ? 'opacity-50' : ''}`}
              >
                Finalizados
              </button>
            </div>

            <div className="mt-2 relative">
              <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                value={ctx.filters.search}
                onChange={(e) => { ctx.setFilters((f: Record<string, unknown>) => ({ ...f, search: e.target.value })); ctx.setPage(0); }}
                placeholder="Buscar…"
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-600/50 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-teal-500/50"
              />
            </div>

            <div className="mt-2 flex gap-2">
              <button onClick={() => setFiltersOpen(true)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-gray-800 border border-gray-600/50 text-gray-200">
                Filtros{ctx.activeFilterCount > 0 && <span className="bg-teal-500 text-white text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center">{ctx.activeFilterCount}</span>}
              </button>
              <button onClick={() => setSortOpen(true)} className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-gray-800 border border-gray-600/50 text-gray-200">Ordenar</button>
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {visible.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-sm">
                {ctx.hasActiveFilters ? 'Sin resultados con esos filtros' : (ctx.isFinalizados ? 'No hay finalizados' : 'No hay pendientes')}
              </div>
            ) : (
              <>
                {visible.map(({ service, delayInfo }) => (
                  <ServiceCardMobile
                    key={service.id}
                    service={service}
                    delayInfo={delayInfo}
                    isFinalizados={ctx.isFinalizados}
                    onClick={ctx.onServiceClick}
                    onMovilClick={ctx.onMovilClick}
                    getMovilName={ctx.getMovilName}
                    getMovilColor={ctx.getMovilColor}
                    formatTime={ctx.formatTime}
                  />
                ))}
                <div ref={sentinelRef} />
                {hasMore && (
                  <button onClick={() => ctx.setPage((p) => p + 1)} className="w-full py-3 text-xs text-teal-300 bg-gray-800/60 rounded-lg">
                    Cargar más ({ctx.sorted.length - visible.length} restantes)
                  </button>
                )}
                <div className="text-center text-[10px] text-gray-600 pt-1">Mostrando {visible.length} de {ctx.sorted.length}</div>
              </>
            )}
          </div>

          {/* Hoja de Ordenar */}
          <MobileSheet isOpen={sortOpen} onClose={() => setSortOpen(false)} title="Ordenar por">
            <div className="space-y-1">
              {ctx.sortOptions.map((o) => {
                const active = ctx.sortKey === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => ctx.onSort(o.key)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ${active ? 'bg-teal-500/20 text-teal-300' : 'text-gray-300 bg-gray-800/40'}`}
                  >
                    <span>{o.label}</span>
                    {active && <span>{ctx.sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                );
              })}
            </div>
          </MobileSheet>

          {/* Hoja de Filtros */}
          <MobileSheet
            isOpen={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            title="Filtros"
            footer={
              <div className="flex gap-2">
                {ctx.hasActiveFilters && <button onClick={ctx.clearFilters} className="flex-1 py-2.5 text-sm text-red-300 bg-red-500/10 rounded-lg">Limpiar</button>}
                <button onClick={() => setFiltersOpen(false)} className="flex-1 py-2.5 text-sm text-white bg-teal-600 rounded-lg">Aplicar</button>
              </div>
            }
          >
            {ctx.isFinalizados ? (
              <FilterGroup label="Entrega">
                {(['todos', 'entregados', 'no_entregados'] as const).map((v) => (
                  <Chip key={v} active={ctx.filters.entrega === v} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: Record<string, unknown>) => ({ ...f, entrega: v }))}>
                    {v === 'todos' ? 'Todos' : v === 'entregados' ? 'Entregados' : 'No Entregados'}
                  </Chip>
                ))}
              </FilterGroup>
            ) : (
              <FilterGroup label="Asignación">
                <Chip active={ctx.filters.asignacion === 'todos'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: Record<string, unknown>) => ({ ...f, asignacion: 'todos' }))}>Todos</Chip>
                <Chip active={ctx.filters.asignacion === 'con_movil'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: Record<string, unknown>) => ({ ...f, asignacion: 'con_movil' }))}>Con Móvil</Chip>
                {ctx.canVerSinAsignarUnitario && (
                  <Chip active={ctx.filters.asignacion === 'sin_movil'} disabled={ctx.isFilterDisabled} onClick={() => ctx.setFilters((f: Record<string, unknown>) => ({ ...f, asignacion: 'sin_movil' }))}>Sin Móvil</Chip>
                )}
              </FilterGroup>
            )}

            <FilterGroup label="Atraso">
              {ctx.atrasoOptions.map((o) => {
                const active = ctx.filters.atraso.includes(o.key);
                return (
                  <Chip
                    key={o.key}
                    active={active}
                    disabled={ctx.isFilterDisabled}
                    onClick={() => { ctx.setFilters((f: { atraso: string[] }) => ({ ...f, atraso: f.atraso.includes(o.key) ? f.atraso.filter((k) => k !== o.key) : [...f.atraso, o.key] })); ctx.setPage(0); }}
                  >
                    {o.label} ({ctx.stats[o.key] || 0})
                  </Chip>
                );
              })}
            </FilterGroup>

            <FilterSelect
              label="Zona"
              value={ctx.filters.zona ?? ''}
              disabled={ctx.isFilterDisabled}
              onChange={(v) => { ctx.setFilters((f: Record<string, unknown>) => ({ ...f, zona: v ? Number(v) : null })); ctx.setPage(0); }}
              options={[{ value: '', label: 'Todas' }, ...ctx.uniqueZonas.map((z) => ({ value: String(z), label: `Zona ${z}` }))]}
            />

            {ctx.uniqueDefectos.length > 0 && (
              <FilterSelect
                label="Defecto"
                value={ctx.filters.defecto ?? ''}
                disabled={ctx.isFilterDisabled}
                onChange={(v) => { ctx.setFilters((f: Record<string, unknown>) => ({ ...f, defecto: v || null })); ctx.setPage(0); }}
                options={[{ value: '', label: 'Todos' }, ...ctx.uniqueDefectos.map((d) => ({ value: d, label: d }))]}
              />
            )}

            <FilterGroup label="Móvil">
              <Chip active={false} disabled={ctx.isFilterDisabled} onClick={ctx.movilCombo.onSelectAll}>Todos</Chip>
              <Chip active={false} disabled={ctx.isFilterDisabled} onClick={ctx.movilCombo.onSelectNone}>Ninguno</Chip>
              {ctx.movilCombo.ids.map((id) => (
                <Chip
                  key={id}
                  active={ctx.movilCombo.selected.includes(id)}
                  disabled={ctx.isFilterDisabled}
                  onClick={() => ctx.movilCombo.onToggle(id, !ctx.movilCombo.selected.includes(id))}
                >
                  {ctx.movilCombo.getMovilName(id)}
                </Chip>
              ))}
            </FilterGroup>
          </MobileSheet>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
