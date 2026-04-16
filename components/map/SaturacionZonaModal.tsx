'use client';

import React, { useMemo, useState } from 'react';
import type { SaturacionZonaStats } from './SaturacionZonasLayer';

// ── inline icon components ────────────────────────────────────────────────
const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IconPackage = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
);
const IconTruck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
);
const IconAlert = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);
const IconDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
);
const IconUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
);
const IconMap = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);

// ──────────────────────── tipos ──────────────────────────────────────────

interface ZonaInfo {
  zona_id: number;
  nombre?: string | null;
}

interface MovilZonaRecord {
  movil_id: string;
  zona_id: number;
  prioridad_o_transito: number;
  activa: boolean;
  tipo_de_servicio?: string;
}

interface MovilInfo {
  id: number;
  name: string;
  tamanoLote?: number;
  pedidosAsignados?: number;
  matricula?: string;
  estadoDesc?: string;
  estadoNro?: number;
}

interface PedidoResumen {
  id: number;
  cliente_nombre?: string | null;
  cliente_direccion?: string | null;
  servicio_nombre?: string | null;
  fch_hora_para?: string | null;
  demora_informada?: number | null;
  zona_nro?: number | null;
}

interface SaturacionZonaModalProps {
  zonaId: number;
  zonas: ZonaInfo[];
  satStats: SaturacionZonaStats | undefined;
  tipoServicio?: string;
  pedidosSinAsignar: PedidoResumen[];
  movilesZonasData: MovilZonaRecord[];
  moviles: MovilInfo[];
  onClose: () => void;
}

// ──────────────────────── helpers ────────────────────────────────────────

const EXCLUDED_ESTADOS = new Set([3, 5, 15]);

function pctColor(pct: number): string {
  if (pct === 999 || pct === 998) return 'text-red-700';
  if (pct >= 100) return 'text-red-600';
  if (pct >= 75)  return 'text-red-500';
  if (pct >= 50)  return 'text-orange-500';
  if (pct >= 25)  return 'text-yellow-600';
  if (pct > 0)    return 'text-green-600';
  return 'text-green-700';
}

function estadoBadge(estadoNro?: number): { label: string; cls: string } {
  switch (estadoNro) {
    case 3:  return { label: 'NO ACTIVO',       cls: 'bg-gray-200 text-gray-700' };
    case 4:  return { label: 'BAJA MOMENTÁNEA', cls: 'bg-purple-100 text-purple-700' };
    case 5:  return { label: 'INACTIVO',         cls: 'bg-gray-200 text-gray-700' };
    case 15: return { label: 'BLOQUEADO',        cls: 'bg-red-100 text-red-700' };
    default: return { label: 'ACTIVO',           cls: 'bg-green-100 text-green-700' };
  }
}

// ──────────────────────── sub-componente: card de móvil ──────────────────

function MovilCard({
  movil,
  nZones,
  otherZones,
}: {
  movil: MovilInfo;
  nZones: number;
  otherZones: ZonaInfo[];
}) {
  const [expanded, setExpanded] = useState<boolean>(false);

  const tamano = movil.tamanoLote ?? 0;
  const asignados = movil.pedidosAsignados ?? 0;
  const libres = Math.max(0, tamano - asignados);
  const prorateado = nZones > 1;
  const pct = tamano > 0 ? Math.round((asignados / tamano) * 100) : 0;

  const badge = estadoBadge(movil.estadoNro);
  const excluded = movil.estadoNro !== undefined && EXCLUDED_ESTADOS.has(movil.estadoNro);

  return (
    <div className={`rounded-lg border p-3 ${excluded ? 'opacity-60 border-gray-200' : 'border-blue-200 bg-blue-50'}`}>
      {/* Cabecera móvil */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🚛</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-gray-900">{movil.name}</span>
              {movil.matricula && (
                <span className="text-xs text-gray-500 font-mono">{movil.matricula}</span>
              )}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            {/* Barra de ocupación */}
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden min-w-[60px]">
                <div
                  className={`h-2 rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-green-400'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className={`text-xs font-semibold ${pctColor(pct)}`}>
                {asignados}/{tamano} ({pct}%)
              </span>
              {libres > 0 && (
                <span className="text-xs text-green-700 font-medium">
                  +{libres} libre{libres !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {prorateado && (
              <div className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
                <span>⚠️</span>
                <span>
                  Cubre {nZones} zonas — libres disponibles aquí: ~{(libres / nZones).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Botón expandir otras zonas */}
        {prorateado && otherZones.length > 0 && (
          <button
            onClick={() => setExpanded((e: boolean) => !e)}
            className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded-md hover:bg-blue-100 transition-colors"
          >
            <IconMap />
            {nZones} zonas
            {expanded ? <IconUp /> : <IconDown />}
          </button>
        )}
      </div>

      {/* Lista de otras zonas */}
      {expanded && otherZones.length > 0 && (
        <div className="mt-2 pl-2 border-l-2 border-blue-300 space-y-1">
          <div className="text-xs font-semibold text-blue-700 mb-1">Otras zonas de este móvil:</div>
          {otherZones.map(z => (
            <div key={z.zona_id} className="flex items-center gap-1.5 text-xs text-gray-700">
              <span className="inline-block w-5 h-5 rounded bg-blue-200 text-blue-800 text-center font-bold leading-5">
                {z.zona_id}
              </span>
              <span>{z.nombre ?? `Zona ${z.zona_id}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────── modal principal ────────────────────────────────

export default function SaturacionZonaModal({
  zonaId,
  zonas,
  satStats,
  tipoServicio = 'URGENTE',
  pedidosSinAsignar,
  movilesZonasData,
  moviles,
  onClose,
}: SaturacionZonaModalProps) {
  const zonaInfo = zonas.find(z => z.zona_id === zonaId);
  const zonaNombre = zonaInfo?.nombre ?? `Zona ${zonaId}`;

  // Construir mapa zona_id → zonaInfo para lookup
  const zonaMap = useMemo(() => new Map(zonas.map(z => [z.zona_id, z])), [zonas]);

  // Móviles con prioridad en esta zona filtrados por tipo de servicio
  const movilIdsEnZona = useMemo(
    () =>
      new Set(
        movilesZonasData
          .filter(r =>
            r.zona_id === zonaId &&
            r.prioridad_o_transito === 1 &&
            (r.tipo_de_servicio || '').toUpperCase() === tipoServicio.toUpperCase(),
          )
          .map(r => String(r.movil_id)),
      ),
    [movilesZonasData, zonaId, tipoServicio],
  );

  // Para cada móvil: cuántas zonas de prioridad del mismo tipo cubre
  const movilZoneMap = useMemo(() => {
    const map = new Map<string, number[]>(); // movil_id → [zona_ids]
    movilesZonasData
      .filter(r =>
        r.prioridad_o_transito === 1 &&
        (r.tipo_de_servicio || '').toUpperCase() === tipoServicio.toUpperCase(),
      )
      .forEach(r => {
        const arr = map.get(String(r.movil_id)) ?? [];
        arr.push(r.zona_id);
        map.set(String(r.movil_id), arr);
      });
    return map;
  }, [movilesZonasData, tipoServicio]);

  // Datos de cada móvil con prioridad en la zona
  const movilCards = useMemo(() => {
    return moviles
      .filter(m => movilIdsEnZona.has(String(m.id)))
      .map(m => {
        const allZoneIds = movilZoneMap.get(String(m.id)) ?? [zonaId];
        const otherZoneIds = allZoneIds.filter(id => id !== zonaId);
        const otherZones = otherZoneIds
          .map(id => zonaMap.get(id) ?? { zona_id: id, nombre: null })
          .filter(Boolean) as ZonaInfo[];
        return { movil: m, nZones: allZoneIds.length, otherZones };
      })
      .sort((a, b) => {
        // Ordenar: primero activos, luego por libres descendente
        const excA = a.movil.estadoNro !== undefined && EXCLUDED_ESTADOS.has(a.movil.estadoNro);
        const excB = b.movil.estadoNro !== undefined && EXCLUDED_ESTADOS.has(b.movil.estadoNro);
        if (excA !== excB) return excA ? 1 : -1;
        const libresA = Math.max(0, (a.movil.tamanoLote ?? 0) - (a.movil.pedidosAsignados ?? 0));
        const libresB = Math.max(0, (b.movil.tamanoLote ?? 0) - (b.movil.pedidosAsignados ?? 0));
        return libresB - libresA;
      });
  }, [moviles, movilIdsEnZona, movilZoneMap, zonaId, zonaMap]);

  // Resumen de capacidad
  const capTotal = satStats?.capacidadTotal ?? 0;
  const capLibre = satStats?.capacidadDisponible ?? 0;
  const isServiceMode = tipoServicio.toUpperCase() === 'SERVICE';
  const sinAsignarTitle = isServiceMode ? 'Services sin asignar' : `Pedidos sin asignar (${tipoServicio})`;
  const sinAsignar = pedidosSinAsignar.length;
  // 998 = Sin C.E. (móviles existen pero cap. disponible = 0), 999 = sin cobertura (sin móviles)
  const satPct = capLibre > 0
    ? Math.round((sinAsignar / capLibre) * 100)
    : sinAsignar > 0
      ? (capTotal > 0 ? 998 : 999)
      : 0;

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
              <span className="text-2xl">🟥</span>
              <h2 className="text-lg font-bold text-gray-900">{zonaNombre}</h2>
              <span className="text-sm text-gray-400">#{zonaId}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
              <span>Saturación:</span>
              <span className={`font-bold ${pctColor(satPct)}`}>
                {satPct === 999 ? '∞% (sin cobertura)' : satPct === 998 ? 'Sin C.E.' : `${satPct}%`}
              </span>
              <span className="text-gray-400">·</span>
              <span>Cap. libre: <b>{capLibre.toFixed(1)}</b></span>
              <span className="text-gray-400">·</span>
              <span>Cap. total: <b>{capTotal.toFixed(1)}</b></span>
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Sección: Pedidos sin asignar ── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-orange-500"><IconPackage /></span>
              <h3 className="text-sm font-semibold text-gray-800">
                {sinAsignarTitle}
                <span className="ml-2 bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {sinAsignar}
                </span>
              </h3>
            </div>

            {sinAsignar === 0 ? (
              <p className="text-sm text-gray-400 italic pl-1">Sin pedidos pendientes en esta zona.</p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {pedidosSinAsignar.map(p => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs"
                  >
                    <span className="text-orange-400 mt-0.5 flex-shrink-0"><IconAlert /></span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-gray-800">#{p.id}</span>
                        {p.servicio_nombre && (
                          <span className="bg-gray-200 text-gray-600 px-1.5 py-px rounded text-[11px]">
                            {p.servicio_nombre}
                          </span>
                        )}
                        {p.demora_informada != null && p.demora_informada > 0 && (
                          <span className="text-orange-600 font-semibold">+{p.demora_informada}min</span>
                        )}
                      </div>
                      {p.cliente_nombre && (
                        <div className="text-gray-600 truncate">{p.cliente_nombre}</div>
                      )}
                      {p.cliente_direccion && (
                        <div className="text-gray-500 truncate">{p.cliente_direccion}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Sección: Móviles con prioridad ── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-500"><IconTruck /></span>
              <h3 className="text-sm font-semibold text-gray-800">
                Móviles con prioridad
                <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {movilCards.length}
                </span>
              </h3>
            </div>

            {movilCards.length === 0 ? (
              <p className="text-sm text-gray-400 italic pl-1">Sin móviles asignados a esta zona.</p>
            ) : (
              <div className="space-y-2">
                {movilCards.map(({ movil, nZones, otherZones }) => (
                  <MovilCard
                    key={movil.id}
                    movil={movil}
                    nZones={nZones}
                    otherZones={otherZones}
                  />
                ))}
              </div>
            )}
          </section>
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
