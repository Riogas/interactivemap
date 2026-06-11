'use client';

import React, { useState } from 'react';
import type { ZonaCapSnapshot, MovilDetalleZona, PedidoSinAsignarMini } from '@/types/zona-capacidad';
import { formatCapEntregaLabel } from '@/lib/cap-entrega-color';

// ── inline icon components ────────────────────────────────────────────────
const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IconTruckPrio = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
);
const IconTruckTransit = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><circle cx="12" cy="21" r="1"/><circle cx="20" cy="21" r="1"/></svg>
);
const IconPackage = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
);
const IconAlert = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);
const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
);
const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
);

// ──────────────────────── tipos ──────────────────────────────────────────

interface ZonaInfo {
  zona_id: number;
  nombre?: string | null;
}

interface SaturacionZonaModalProps {
  zonaId: number;
  zonas: ZonaInfo[];
  /** Snapshot completo para esta zona (del hook useZonaCapacidadSnapshot). */
  snapshot: ZonaCapSnapshot | undefined;
  /** true si el usuario tiene "Ped s/asignar x zona" (o unitarios): muestra el TOTAL de SA. */
  canVerSinAsigPorZona: boolean;
  /** true si tiene "Ped s/asignar unitarios": muestra el DETALLE por pedido. */
  canVerSinAsignarUnitario: boolean;
  /** Peso de las zonas de tránsito en el prorrateo (escenario_settings.peso_transito_alpha). */
  pesoTransitoAlpha: number;
  /** Capacidad mostrada (ya con cap 0/-9999 aplicado por la feature flag). */
  capacidadMostrada: number;
  onClose: () => void;
  /** Defensa en profundidad: si la zona no está en el set permitido, no se renderiza. */
  scopedZonaIds?: Set<number> | null;
}

// ──────────────────────── helpers ────────────────────────────────────────

/** Color Tailwind para la métrica Cap. Entrega (entero). Coincide con la
 * escala absoluta de `lib/cap-entrega-color.ts` para que la capa del mapa y
 * este modal usen los mismos umbrales (>=4 holgura alta, 1-3 baja, 0 exacta,
 * -3..-1 sobrecupo leve, <=-4 sobrecupo alto). */
function capEntregaColorClass(cap: number): string {
  if (cap <= -4) return 'text-red-600';
  if (cap < 0)   return 'text-orange-500';
  if (cap === 0) return 'text-yellow-600';
  if (cap <= 3)  return 'text-lime-600';
  return 'text-green-700';
}

// ──────────────────────── sub-componente: card de móvil detalle ──────────

function MovilDetalleCard({ detalle }: { detalle: MovilDetalleZona }) {
  const libre = Math.max(0, detalle.lote_asignado - detalle.capacidad_actual);
  const pct = detalle.lote_asignado > 0
    ? Math.round((detalle.capacidad_actual / detalle.lote_asignado) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🚛</span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-gray-900">Móvil #{detalle.movil_id}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[50px]">
                <div
                  className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : 'bg-green-400'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className="text-xs text-gray-600">
                {detalle.capacidad_actual}/{detalle.lote_asignado} ({pct}%)
              </span>
              {libre > 0 && (
                <span className="text-xs text-green-700 font-medium">+{libre} libre{libre !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">
          Aporte: <b>{detalle.aporte_a_zona.toFixed(1)}</b>
        </span>
      </div>
    </div>
  );
}

// ──────────────────────── sub-componente: card de pedido sin asignar ─────

function PedidoSinAsignarCard({ pedido }: { pedido: PedidoSinAsignarMini }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs">
      <span className="text-orange-400 mt-0.5 flex-shrink-0"><IconAlert /></span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-gray-800">#{pedido.id}</span>
          {pedido.fecha && (
            <span className="text-gray-500">{pedido.fecha}</span>
          )}
        </div>
        {pedido.tipo_servicio && (
          <div className="text-gray-600 truncate font-medium uppercase">{pedido.tipo_servicio}</div>
        )}
        {pedido.direccion_corta && (
          <div className="text-gray-500 truncate">{pedido.direccion_corta}</div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────── modal principal ────────────────────────────────

export default function SaturacionZonaModal({
  zonaId,
  zonas,
  snapshot,
  canVerSinAsigPorZona,
  canVerSinAsignarUnitario,
  pesoTransitoAlpha,
  capacidadMostrada,
  onClose,
  scopedZonaIds = null,
}: SaturacionZonaModalProps) {
  const [transitoExpanded, setTransitoExpanded] = useState(false);

  const zonaInfo = zonas.find(z => z.zona_id === zonaId);
  const zonaNombre = zonaInfo?.nombre ?? `Zona ${zonaId}`;

  // Defensa en profundidad: si el caller pasó scope y la zona no está, no renderizar.
  if (scopedZonaIds && !scopedZonaIds.has(zonaId)) return null;

  const capacidadTotal = snapshot?.capacidad_total ?? 0;
  const movilesPrioridad = snapshot?.moviles_prioridad ?? 0;
  const movilesTransito = snapshot?.moviles_transito ?? 0;
  const pedidosSinAsignar = snapshot?.pedidos_sin_asignar ?? 0;

  // Separar moviles_detalle en prioridad y transito
  const detallesPrioridad = (snapshot?.moviles_detalle ?? []).filter(m => !m.en_transito);
  const detallesTransito = (snapshot?.moviles_detalle ?? []).filter(m => m.en_transito);
  const pedidosDetalle = snapshot?.pedidos_sin_asignar_detalle ?? [];

  const colorClass = capEntregaColorClass(capacidadMostrada);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 rounded-t-2xl flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">📦</span>
              <h2 className="text-lg font-bold text-gray-900">{zonaNombre}</h2>
              <span className="text-sm text-gray-400">#{zonaId}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
              <span>Cap. de Entrega:</span>
              <span className={`font-bold text-base ${colorClass}`}>
                {formatCapEntregaLabel(capacidadMostrada)}
              </span>
              <span className="text-gray-400">de</span>
              <span className="font-semibold">{capacidadTotal} total</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── Sección: Móviles en prioridad ── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-500"><IconTruckPrio /></span>
              <h3 className="text-sm font-semibold text-gray-800">
                MÓVILES EN PRIORIDAD
                <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {movilesPrioridad}
                </span>
              </h3>
            </div>

            {detallesPrioridad.length === 0 ? (
              <p className="text-sm text-gray-400 italic pl-1">Sin móviles de prioridad en esta zona.</p>
            ) : (
              <div className="space-y-2">
                {detallesPrioridad.map(m => (
                  <MovilDetalleCard key={m.movil_id} detalle={m} />
                ))}
              </div>
            )}
          </section>

          {/* ── Sección: Móviles en tránsito (toggle, colapsado por defecto) ── */}
          <section>
            <button
              className="flex items-center gap-2 w-full text-left mb-1 group"
              onClick={() => setTransitoExpanded(e => !e)}
              aria-expanded={transitoExpanded}
            >
              <span className="text-indigo-400"><IconTruckTransit /></span>
              <h3 className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
                MÓVILES EN TRÁNSITO
                <span className="ml-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {movilesTransito}
                </span>
                <span className="ml-1 text-gray-400 text-[10px]">(peso {Math.round(pesoTransitoAlpha * 100)}%)</span>
              </h3>
              <span className="ml-auto text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0">
                {transitoExpanded ? <IconChevronDown /> : <IconChevronRight />}
              </span>
            </button>

            {transitoExpanded && (
              <div className="pl-1">
                {detallesTransito.length === 0 ? (
                  <p className="text-sm text-gray-400 italic pl-1">Sin móviles en tránsito.</p>
                ) : (
                  <div className="space-y-2">
                    {detallesTransito.map(m => (
                      <MovilDetalleCard key={m.movil_id} detalle={m} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Sección: Pedidos sin asignar — solo si tiene feature ── */}
          {canVerSinAsigPorZona && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-500"><IconPackage /></span>
                <h3 className="text-sm font-semibold text-gray-800">
                  PEDIDOS SIN ASIGNAR
                  <span className="ml-2 bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {pedidosSinAsignar}
                  </span>
                </h3>
              </div>

              {pedidosSinAsignar === 0 ? (
                <p className="text-sm text-gray-400 italic pl-1">Sin pedidos pendientes en esta zona.</p>
              ) : canVerSinAsignarUnitario && pedidosDetalle.length > 0 ? (
                // Detalle por pedido: SOLO con "Ped s/asignar unitarios".
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {pedidosDetalle.map(p => (
                    <PedidoSinAsignarCard key={p.id} pedido={p} />
                  ))}
                </div>
              ) : (
                // "Ped s/asignar x zona" (sin unitarios): solo el total (ya en el badge del título).
                <p className="text-sm text-gray-500 italic pl-1">{pedidosSinAsignar} pedido{pedidosSinAsignar !== 1 ? 's' : ''} sin asignar.</p>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-2xl flex-shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-900 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
