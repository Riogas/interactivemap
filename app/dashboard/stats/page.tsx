'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { computeDelayMinutes } from '@/utils/pedidoDelay';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// ─── Tipos mínimos para este módulo ───────────────────────────────────────────
interface Pedido {
  pedido_id: number;
  estado_nro: number | string;
  sub_estado_nro?: number | string;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
  fch_para?: string;
  zona_nro?: number | string | null;
  fch_hora_max_ent_comp?: string | null;
}
interface Service {
  service_id: number;
  estado_nro?: number | string;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
}
interface Empresa {
  empresa_fletera_id: number;
  nombre: string;
}
interface Movil {
  nro: number;
  empresa_fletera_id: number;
  empresa_fletera_nom: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[parseInt(m) - 1]} ${y}`;
}

function BarChart({ data, colorClass = 'bg-blue-500' }: { data: { label: string; value: number; pct: number }[]; colorClass?: string }) {
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-xs text-gray-400 mb-0.5">
            <span className="truncate max-w-[70%]">{item.label}</span>
            <span className="font-semibold text-white">{item.value}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full ${colorClass} rounded-full transition-all duration-700`}
              style={{ width: `${Math.max(item.pct, item.value > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stacked bar (Entregados / No Entregados / Pendientes) ──────────────────
interface StackRow { label: string; entregados: number; noEntregados: number; pendientes: number; }
function StackedBarChart({ data }: { data: StackRow[] }) {
  const maxTotal = Math.max(...data.map(r => r.entregados + r.noEntregados + r.pendientes), 1);
  return (
    <div className="space-y-2.5">
      {/* Leyenda */}
      <div className="flex gap-3 text-[10px] text-gray-400 mb-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Entregados</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />No entregados</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Pendientes</span>
      </div>
      {data.map(row => {
        const total = row.entregados + row.noEntregados + row.pendientes;
        const barWidth = Math.round((total / maxTotal) * 100);
        const pEnt = total > 0 ? (row.entregados / total) * 100 : 0;
        const pNoEnt = total > 0 ? (row.noEntregados / total) * 100 : 0;
        const pPend = total > 0 ? (row.pendientes / total) * 100 : 0;
        return (
          <div key={row.label}>
            <div className="flex justify-between text-xs text-gray-400 mb-0.5">
              <span className="truncate max-w-[60%]">{row.label}</span>
              <span className="flex gap-1.5 text-[10px]">
                {row.entregados > 0 && <span className="text-green-400 font-semibold">{row.entregados}✓</span>}
                {row.noEntregados > 0 && <span className="text-orange-400 font-semibold">{row.noEntregados}✗</span>}
                {row.pendientes > 0 && <span className="text-blue-400 font-semibold">{row.pendientes}⏳</span>}
              </span>
            </div>
            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${Math.max(barWidth, total > 0 ? 2 : 0)}%` }}>
                {row.entregados > 0 && <div className="h-full bg-green-500" style={{ width: `${pEnt}%` }} />}
                {row.noEntregados > 0 && <div className="h-full bg-orange-400" style={{ width: `${pNoEnt}%` }} />}
                {row.pendientes > 0 && <div className="h-full bg-blue-400" style={{ width: `${pPend}%` }} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  const bg: Record<string, string> = {
    green: 'bg-green-500/20 border-green-400/30',
    blue: 'bg-blue-500/20 border-blue-400/30',
    orange: 'bg-orange-500/20 border-orange-400/30',
    red: 'bg-red-500/20 border-red-400/30',
    purple: 'bg-purple-500/20 border-purple-400/30',
    gray: 'bg-gray-500/20 border-gray-400/30',
  };
  return (
    <div className={`rounded-xl border p-4 ${bg[color] ?? bg.gray} backdrop-blur-sm`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Contenido principal ──────────────────────────────────────────────────────
function StatsContent() {
  const searchParams = useSearchParams();
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [empresas, setEmpresas] = useState<Map<number, string>>(new Map());
  // Mapa movilNro → nombre de empresa (obtenido del join moviles → empresa_fletera)
  const [movilEmpresa, setMovilEmpresa] = useState<Map<number, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [pRes, sRes, eRes, mRes] = await Promise.all([
          fetch(`/api/pedidos?fecha=${date}`),
          fetch(`/api/services?fecha=${date}`),
          fetch(`/api/empresas`),
          fetch(`/api/moviles-extended`),
        ]);
        const [pData, sData, eData, mData] = await Promise.all([pRes.json(), sRes.json(), eRes.json(), mRes.json()]);
        setPedidos(pData.data ?? pData ?? []);
        setServices(sData.data ?? sData ?? []);
        // Mapa empresa_fletera_id → nombre
        const eMap = new Map<number, string>();
        (eData.data ?? []).forEach((e: Empresa) => eMap.set(e.empresa_fletera_id, e.nombre));
        setEmpresas(eMap);
        // Mapa movilNro → nombre empresa (via join movil → empresa_fletera)
        const mMap = new Map<number, string>();
        (mData.data ?? []).forEach((m: Movil) => {
          if (m.nro != null) {
            const nombre = m.empresa_fletera_nom ?? eMap.get(m.empresa_fletera_id) ?? `Empresa ${m.empresa_fletera_id}`;
            mMap.set(m.nro, nombre);
          }
        });
        setMovilEmpresa(mMap);
      } catch (e) {
        setError('Error al cargar los datos');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [date]);

  // ─── KPIs Pedidos ──────────────────────────────────────────────────────────
  const pedidosStats = useMemo(() => {
    const total = pedidos.length;
    const finalizados = pedidos.filter(p => Number(p.estado_nro) === 2);
    const entregados = finalizados.filter(p => [3, 16].includes(Number(p.sub_estado_nro)));
    const noEntregados = finalizados.filter(p => ![3, 16].includes(Number(p.sub_estado_nro)));
    const sinAsignar = pedidos.filter(p => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0));
    const pendientes = pedidos.filter(p => Number(p.estado_nro) === 1 && p.movil && Number(p.movil) !== 0);
    const pct = finalizados.length > 0 ? Math.round((entregados.length / finalizados.length) * 100) : 0;
    return { total, finalizados: finalizados.length, entregados: entregados.length, noEntregados: noEntregados.length, sinAsignar: sinAsignar.length, pendientes: pendientes.length, pct };
  }, [pedidos]);

  // ─── KPIs Services ─────────────────────────────────────────────────────────
  const servicesStats = useMemo(() => {
    const total = services.length;
    const finalizados = services.filter(s => Number(s.estado_nro) === 2).length;
    const pendientes = total - finalizados;
    const pct = total > 0 ? Math.round((finalizados / total) * 100) : 0;
    return { total, finalizados, pendientes, pct };
  }, [services]);

  // ─── Pedidos por hora ──────────────────────────────────────────────────────
  const pedidosPorHora = useMemo(() => {
    const map: Record<string, number> = {};
    pedidos.forEach(p => {
      const fch = p.fch_hora_para ?? '';
      const hora = fch.includes('T') ? fch.split('T')[1]?.substring(0, 2) : fch.substring(8, 10);
      if (hora && hora.match(/^\d{2}$/)) {
        const h = `${hora}:00`;
        map[h] = (map[h] ?? 0) + 1;
      }
    });
    const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(...sorted.map(e => e[1]), 1);
    return sorted.map(([label, value]) => ({ label, value, pct: Math.round((value / max) * 100) }));
  }, [pedidos]);

  // ─── Pedidos por empresa (multi-serie) ────────────────────────────────────
  const pedidosPorEmpresa = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    const getKey = (p: Pedido): string => {
      const movilNro = p.movil != null ? Number(p.movil) : null;
      if (movilNro && movilNro !== 0 && movilEmpresa.has(movilNro)) return movilEmpresa.get(movilNro)!;
      const empId = p.empresa_fletera_id != null ? Number(p.empresa_fletera_id) : null;
      return empId != null && empresas.has(empId) ? empresas.get(empId)! : empId != null ? `Empresa ${empId}` : 'Sin empresa';
    };
    pedidos.forEach(p => {
      const key = getKey(p);
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if ([3, 16].includes(Number(p.sub_estado_nro))) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes))
      .slice(0, 10);
  }, [pedidos, empresas, movilEmpresa]);

  // ─── Estados de pedidos ────────────────────────────────────────────────────
  const estadosPedidos = useMemo(() => {
    const estados: Record<number, string> = { 1: 'Pendiente', 2: 'Finalizado', 4: 'Cancelado' };
    const map: Record<string, number> = {};
    pedidos.forEach(p => {
      const key = estados[Number(p.estado_nro)] ?? `Estado ${p.estado_nro}`;
      map[key] = (map[key] ?? 0) + 1;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...sorted.map(e => e[1]), 1);
    return sorted.map(([label, value]) => ({ label, value, pct: Math.round((value / max) * 100) }));
  }, [pedidos]);

  // ─── Pedidos por zona (top 12 por total) ────────────────────────────────────
  const pedidosPorZona = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    pedidos.filter(p => p.zona_nro).forEach(p => {
      const key = `Zona ${p.zona_nro}`;
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if ([3, 16].includes(Number(p.sub_estado_nro))) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes))
      .slice(0, 12);
  }, [pedidos]);

  // ─── Atrasos de pedidos pendientes ─────────────────────────────────────────
  const atrasosStats = useMemo(() => {
    const pendientes = pedidos.filter(p => Number(p.estado_nro) === 1);
    let muyAtrasado = 0, atrasado = 0, limiteCercana = 0, enHora = 0, sinHora = 0;
    pendientes.forEach(p => {
      const diffMin = computeDelayMinutes(p.fch_hora_max_ent_comp ?? null);
      if (diffMin === null) { sinHora++; return; }
      if (diffMin >= 10) enHora++;
      else if (diffMin >= 0) limiteCercana++;
      else if (diffMin >= -10) atrasado++;
      else muyAtrasado++;
    });
    const total = pendientes.length;
    const conAtraso = muyAtrasado + atrasado;
    const pctAtraso = total > 0 ? Math.round((conAtraso / total) * 100) : 0;
    return { total, muyAtrasado, atrasado, limiteCercana, enHora, sinHora, pctAtraso };
  }, [pedidos]);

  // ─── Móviles con más entregas ──────────────────────────────────────────────
  const movilesTop = useMemo(() => {
    const map: Record<string, number> = {};
    pedidos.filter(p => Number(p.estado_nro) === 2 && [3,16].includes(Number(p.sub_estado_nro)) && p.movil && Number(p.movil) !== 0)
      .forEach(p => {
        const key = `Móvil ${p.movil}`;
        map[key] = (map[key] ?? 0) + 1;
      });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = Math.max(...sorted.map(e => e[1]), 1);
    return sorted.map(([label, value]) => ({ label, value, pct: Math.round((value / max) * 100) }));
  }, [pedidos]);

  return (
    <div className="h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Centro Estadístico</h1>
          <p className="text-sm text-gray-400">{formatDate(date)}</p>
        </div>
        <button
          onClick={() => window.close()}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          Cerrar
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
        </div>
      )}

      {error && (
        <div className="m-6 p-4 bg-red-500/20 border border-red-400/30 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">

          {/* ── KPIs Pedidos ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Pedidos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard label="Total pedidos" value={pedidosStats.total} color="blue" />
              <KpiCard label="Entregados" value={pedidosStats.entregados} color="green" />
              <KpiCard label="% Entregados" value={`${pedidosStats.pct}%`} color={pedidosStats.pct >= 80 ? 'green' : pedidosStats.pct >= 50 ? 'orange' : 'red'} />
              <KpiCard label="No entregados" value={pedidosStats.noEntregados} color="orange" />
              <KpiCard label="Sin asignar" value={pedidosStats.sinAsignar} color={pedidosStats.sinAsignar > 0 ? 'orange' : 'gray'} />
              <KpiCard label="Finalizados" value={pedidosStats.finalizados} sub={`de ${pedidosStats.total}`} color="purple" />
            </div>
          </section>

          {/* ── KPIs Services ── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Services</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Total services" value={servicesStats.total} color="blue" />
              <KpiCard label="Finalizados" value={servicesStats.finalizados} color="green" />
              <KpiCard label="% Completados" value={`${servicesStats.pct}%`} color={servicesStats.pct >= 80 ? 'green' : servicesStats.pct >= 50 ? 'orange' : 'red'} />
              <KpiCard label="Pendientes" value={servicesStats.pendientes} color={servicesStats.pendientes > 0 ? 'orange' : 'gray'} />
            </div>
          </section>

          {/* ── Gráficos ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* Pedidos por hora */}
            {pedidosPorHora.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Pedidos por hora</h3>
                <BarChart data={pedidosPorHora} colorClass="bg-blue-500" />
              </div>
            )}

            {/* Estados de pedidos */}
            {estadosPedidos.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Pedidos por estado</h3>
                <BarChart data={estadosPedidos} colorClass="bg-purple-500" />

                {/* Donut visual simple */}
                <div className="mt-4 flex gap-2 flex-wrap">
                  {estadosPedidos.map(e => (
                    <span key={e.label} className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                      {e.label}: <strong className="text-white">{e.value}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Pedidos por empresa */}
            {pedidosPorEmpresa.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Pedidos por empresa</h3>
                <StackedBarChart data={pedidosPorEmpresa} />
              </div>
            )}

            {/* Top móviles */}
            {movilesTop.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Top móviles por entregas</h3>
                <BarChart data={movilesTop} colorClass="bg-orange-500" />
              </div>
            )}

            {/* Pedidos por zona */}
            {pedidosPorZona.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Pedidos por zona</h3>
                <StackedBarChart data={pedidosPorZona} />
              </div>
            )}

            {/* Atrasos de pedidos */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-1">Atrasos de pedidos pendientes</h3>
              <p className="text-xs text-gray-500 mb-4">{atrasosStats.total} pendientes en total</p>

              {/* % general con atraso */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400">Con atraso</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: atrasosStats.pctAtraso >= 50 ? '#ef4444' : atrasosStats.pctAtraso >= 20 ? '#f97316' : '#22c55e' }}>
                    {atrasosStats.pctAtraso}%
                  </span>
                  <span className="text-xs text-gray-500">({atrasosStats.muyAtrasado + atrasosStats.atrasado})</span>
                </div>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-4">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${atrasosStats.pctAtraso}%`,
                    background: atrasosStats.pctAtraso >= 50 ? '#ef4444' : atrasosStats.pctAtraso >= 20 ? '#f97316' : '#22c55e',
                  }}
                />
              </div>

              {/* Categorías */}
              <div className="space-y-2.5 text-xs">
                {[
                  { label: 'Muy Atrasado', value: atrasosStats.muyAtrasado, color: '#ef4444', dot: 'bg-red-500' },
                  { label: 'Atrasado', value: atrasosStats.atrasado, color: '#f472b6', dot: 'bg-pink-400' },
                  { label: 'Límite Cercana', value: atrasosStats.limiteCercana, color: '#facc15', dot: 'bg-yellow-400' },
                  { label: 'En Hora', value: atrasosStats.enHora, color: '#22c55e', dot: 'bg-green-500' },
                  { label: 'Sin Hora', value: atrasosStats.sinHora, color: '#6b7280', dot: 'bg-gray-500' },
                ].map(cat => (
                  <div key={cat.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cat.dot}`} />
                      <span className="text-gray-300">{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: atrasosStats.total > 0 ? `${Math.round((cat.value / atrasosStats.total) * 100)}%` : '0%',
                            background: cat.color,
                          }}
                        />
                      </div>
                      <span className="font-semibold text-white w-6 text-right">{cat.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-gray-600 pb-4">
            Datos del {formatDate(date)} · RiogasTracking
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Export con ProtectedRoute + Suspense (requerido por useSearchParams) ─────
export default function StatsPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
        </div>
      }>
        <StatsContent />
      </Suspense>
    </ProtectedRoute>
  );
}
