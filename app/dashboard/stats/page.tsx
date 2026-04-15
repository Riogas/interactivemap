'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { computeDelayMinutes } from '@/utils/pedidoDelay';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// ─── Tipos mínimos para este módulo ───────────────────────────────────────────
interface Pedido {
  pedido_id: number;
  estado_nro: number | string;
  sub_estado_nro?: number | string | null;
  sub_estado_desc?: string | null;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
  fch_para?: string;
  zona_nro?: number | string | null;
  fch_hora_max_ent_comp?: string | null;
  fch_hora_mov?: string | null;
  fch_hora_finalizacion?: string | null;
  pedido_hijo?: number | null;
  producto_cod?: string | null;
}
interface Service {
  service_id: number;
  estado_nro?: number | string;
  sub_estado_nro?: number | string | null;
  movil?: number | string;
  empresa_fletera_id?: number | string;
  fch_hora_para?: string;
  fch_hora_max_ent_comp?: string | null;
  fch_hora_finalizacion?: string | null;
}
interface Empresa {
  empresa_fletera_id: number;
  nombre: string;
}
interface Movil {
  nro: number;
  empresa_fletera_id: number;
  empresa_fletera_nom: string | null;
  tamanoLote: number;
  estadoNro: number | null;
  pedidosAsignados: number;
}
// Mismo criterio que el sidebar: activo = estadoNro null/undefined/0/1/2

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[parseInt(m) - 1]} ${y}`;
}

function BarChart({ data, colorClass = 'bg-blue-500' }: { data: { label: string; value: number; pct: number }[]; colorClass?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="space-y-2">
      {data.map((item) => {
        const pctOfTotal = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <div key={item.label}>
            <div className="flex justify-between text-xs text-gray-400 mb-0.5">
              <span className="truncate max-w-[60%]">{item.label}</span>
              <span className="font-semibold text-white">
                {item.value}
                <span className="text-gray-500 font-normal ml-1">· {pctOfTotal}%</span>
              </span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full ${colorClass} rounded-full transition-all duration-700`}
                style={{ width: `${Math.max(item.pct, item.value > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stacked bar (Entregados / No Entregados / Pendientes) ──────────────────
interface StackRow { label: string; entregados: number; noEntregados: number; pendientes: number; }
function StackedBarChart({ data, expanded = false }: { data: StackRow[]; expanded?: boolean }) {
  const maxTotal = Math.max(...data.map(r => r.entregados + r.noEntregados + r.pendientes), 1);
  const barH = expanded ? 'h-7' : 'h-5';
  const spacing = expanded ? 'space-y-5' : 'space-y-2.5';
  return (
    <div className={spacing}>
      {/* Leyenda */}
      <div className="flex gap-3 text-[10px] text-gray-400 mb-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Entregados</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />No entregados</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Pendientes</span>
      </div>
      {data.map(row => {
        const total = row.entregados + row.noEntregados + row.pendientes;
        const barWidth = Math.round((total / maxTotal) * 100);
        const pEnt = total > 0 ? Math.round((row.entregados / total) * 100) : 0;
        const pNoEnt = total > 0 ? Math.round((row.noEntregados / total) * 100) : 0;
        const pPend = total > 0 ? 100 - pEnt - pNoEnt : 0;
        return (
          <div key={row.label}>
            <div className={`flex justify-between ${expanded ? 'text-sm' : 'text-xs'} text-gray-300 mb-0.5`}>
              <span className="truncate max-w-[70%] font-medium">{row.label}</span>
              <span className="font-bold text-white">{total}</span>
            </div>
            <div className={`${barH} bg-white/10 rounded-full overflow-hidden`}>
              <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${Math.max(barWidth, total > 0 ? 2 : 0)}%` }}>
                {row.entregados > 0 && (
                  <div className="h-full bg-green-500 flex items-center justify-center overflow-hidden" style={{ width: `${pEnt}%` }}>
                    {(expanded || pEnt >= 12) && <span className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-gray-900 leading-none`}>{pEnt}%</span>}
                  </div>
                )}
                {row.noEntregados > 0 && (
                  <div className="h-full bg-orange-400 flex items-center justify-center overflow-hidden" style={{ width: `${pNoEnt}%` }}>
                    {(expanded || pNoEnt >= 12) && <span className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-gray-900 leading-none`}>{pNoEnt}%</span>}
                  </div>
                )}
                {row.pendientes > 0 && (
                  <div className="h-full bg-blue-400 flex items-center justify-center overflow-hidden" style={{ width: `${pPend}%` }}>
                    {(expanded || pPend >= 12) && <span className={`${expanded ? 'text-[11px]' : 'text-[9px]'} font-black text-gray-900 leading-none`}>{pPend}%</span>}
                  </div>
                )}
              </div>
            </div>
            {/* Siempre visible en modo expandido: etiquetas de % debajo de la barra */}
            {expanded && total > 0 && (
              <div className="flex gap-4 mt-1.5">
                {pEnt > 0 && <span className="text-[10px] text-green-400 font-semibold">{pEnt}% ent.</span>}
                {pNoEnt > 0 && <span className="text-[10px] text-orange-400 font-semibold">{pNoEnt}% no ent.</span>}
                {pPend > 0 && <span className="text-[10px] text-blue-400 font-semibold">{pPend}% pend.</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getEmpresaNombre(p: { movil?: unknown; empresa_fletera_id?: unknown }, movilEmpresa: Map<number, string>, empresas: Map<number, string>): string {
  const movilNro = p.movil != null ? Number(p.movil) : null;
  if (movilNro && movilNro !== 0 && movilEmpresa.has(movilNro)) return movilEmpresa.get(movilNro)!;
  const empId = p.empresa_fletera_id != null ? Number(p.empresa_fletera_id) : null;
  if (!empId || empId === 0) return 'Sin empresa';
  return empresas.has(empId) ? empresas.get(empId)! : `Empresa ${empId}`;
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

// ─── Tarjeta expandible ───────────────────────────────────────────────────────
function ExpandableCard({ title, children, expandedChildren }: { title: string; children: React.ReactNode; expandedChildren?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto py-8 px-4 stats-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div className="w-full max-w-5xl stats-modal-content">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
              <button
                onClick={() => setExpanded(false)}
                className="text-gray-400 hover:text-white transition-all duration-200 p-2 rounded-xl hover:bg-white/10 group"
                title="Cerrar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:rotate-90 transition-transform duration-200" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="text-sm">{expandedChildren ?? children}</div>
          </div>
        </div>
      )}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
          <button
            onClick={() => setExpanded(true)}
            className="text-gray-500 hover:text-white transition-all duration-200 p-1 rounded-lg hover:bg-white/10 hover:scale-110 active:scale-95"
            title="Expandir"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </>
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
  const [movilesRaw, setMovilesRaw] = useState<Movil[]>([]);
  // Set de IDs de móviles con GPS vigente (INNER JOIN gps_latest_positions)
  const [movilesConGps, setMovilesConGps] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>('Todas');
  const [selectedProducto, setSelectedProducto] = useState<string>('Todos');
  const [refreshSeconds, setRefreshSeconds] = useState<number>(60);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [zonasNoActivasCount, setZonasNoActivasCount] = useState<number | null>(null);
  const [zonasSinMovilCount, setZonasSinMovilCount] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [pRes, sRes, eRes, mRes, gRes] = await Promise.all([
          fetch(`/api/pedidos?fecha=${date}`),
          fetch(`/api/services?fecha=${date}`),
          fetch(`/api/empresas`),
          fetch(`/api/moviles-extended`),
          fetch(`/api/all-positions`),
        ]);
        const [pData, sData, eData, mData, gData] = await Promise.all([pRes.json(), sRes.json(), eRes.json(), mRes.json(), gRes.json()]);
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
            const nombre = (m.empresa_fletera_id && m.empresa_fletera_id !== 0)
              ? (eMap.get(m.empresa_fletera_id) ?? `Empresa ${m.empresa_fletera_id}`)
              : 'Sin empresa';
            mMap.set(m.nro, nombre);
          }
        });
        setMovilEmpresa(mMap);
        setMovilesRaw(mData.data ?? []);
        // Set de IDs con GPS vigente (equivalente al INNER JOIN gps_latest_positions)
        const gpsIds = new Set<string>((gData.data ?? []).map((g: { movilId: number }) => String(g.movilId)));
        setMovilesConGps(gpsIds);
      } catch (e) {
        setError('Error al cargar los datos');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [date, refreshTick]);

  // ─── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const id = setInterval(() => setRefreshTick(t => t + 1), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds]);

  // ─── Fetch data for zone indicators ────────────────────────────────────────
  useEffect(() => {
    const loadZoneData = async () => {
      try {
        const [demorasRes, zonasRes, mzRes] = await Promise.all([
          fetch('/api/demoras'),
          fetch('/api/zonas'),
          fetch('/api/moviles-zonas'),
        ]);
        const [demorasData, zonasData, mzData] = await Promise.all([
          demorasRes.json(),
          zonasRes.json(),
          mzRes.json(),
        ]);

        // ── Mapa de demoras: zona_id → registro con mayor minutos (igual que DashboardIndicators) ──
        const dMap = new Map<number, { minutos: number; activa: boolean }>();
        if (demorasData.success && Array.isArray(demorasData.data)) {
          for (const d of demorasData.data) {
            const existing = dMap.get(d.zona_id);
            if (!existing || d.minutos > existing.minutos) {
              dMap.set(d.zona_id, { minutos: d.minutos, activa: d.activa });
            }
          }
        }

        // ── Zonas No Activas: solo zonas reales (con geojson) donde activa===false ──
        if (zonasData.success && Array.isArray(zonasData.data)) {
          const allZonasReal: { zona_id: number }[] = (zonasData.data || []).filter((z: any) => z.geojson);
          const noActivas = allZonasReal.filter(z => {
            const info = dMap.get(z.zona_id);
            return info !== undefined && info.activa === false;
          }).length;
          setZonasNoActivasCount(noActivas);
        }

        // ── Zonas Sin Móvil (tipo URGENTE, excluyendo zonas no activas) ──
        if (zonasData.success && mzData.success) {
          const allZonas: { zona_id: number }[] = (zonasData.data || []).filter((z: any) => z.geojson);

          // Filtrar moviles-zonas por tipo URGENTE
          const movilesZonas = (mzData.data || []).filter(
            (mz: any) => (mz.tipo_de_servicio || '').toUpperCase() === 'URGENTE'
          );

          // Conteos por zona
          const zonaCounts = new Map<number, { prioridad: number; transito: number }>();
          for (const mz of movilesZonas) {
            const existing = zonaCounts.get(mz.zona_id) || { prioridad: 0, transito: 0 };
            if (mz.prioridad_o_transito === 1) existing.prioridad++;
            else existing.transito++;
            zonaCounts.set(mz.zona_id, existing);
          }

          // Zonas sin móvil excluyendo zonas no activas
          const sinMovil = allZonas.filter((z) => {
            const dInfo = dMap.get(z.zona_id);
            if (dInfo && dInfo.activa === false) return false;
            const counts = zonaCounts.get(z.zona_id);
            return !counts || (counts.prioridad === 0 && counts.transito === 0);
          }).length;
          setZonasSinMovilCount(sinMovil);
        }
      } catch {
        // si falla, simplemente no mostramos el dato
      }
    };
    loadZoneData();
  }, [refreshTick]);

  // ─── Opciones de empresa (para el filtro) ──────────────────────────────────
  // Opciones del combo Empresa → vienen de empresas_fleteras (estado=1), no de pedidos del día
  const empresaOptions = useMemo(() => {
    return Array.from(empresas.values()).sort();
  }, [empresas]);

  // ─── Pedidos filtrados por empresa y producto ─────────────────────────────
  const filteredPedidos = useMemo(() => {
    let result = pedidos;
    if (selectedEmpresa !== 'Todas')
      result = result.filter(p => getEmpresaNombre(p, movilEmpresa, empresas) === selectedEmpresa);
    if (selectedProducto !== 'Todos')
      result = result.filter(p => String(p.producto_cod ?? '') === selectedProducto);
    return result;
  }, [pedidos, selectedEmpresa, selectedProducto, movilEmpresa, empresas]);

  // ─── KPIs Pedidos ──────────────────────────────────────────────────────────
  const pedidosStats = useMemo(() => {
    const total = filteredPedidos.length;
    const finalizados = filteredPedidos.filter(p => Number(p.estado_nro) === 2);
    // Excluir pedidos hijo (re-entregas) del % entregados
    const finalizadosSinHijo = finalizados.filter(p => !p.pedido_hijo);
    const entregados = finalizadosSinHijo.filter(p => [3, 17, 19].includes(Number(p.sub_estado_nro)));
    const noEntregados = finalizadosSinHijo.filter(p => ![3, 17, 19].includes(Number(p.sub_estado_nro)));
    const sinAsignar = filteredPedidos.filter(p => Number(p.estado_nro) === 1 && (!p.movil || Number(p.movil) === 0));
    const pendientes = filteredPedidos.filter(p => Number(p.estado_nro) === 1 && p.movil && Number(p.movil) !== 0);
    const totalPendientes = sinAsignar.length + pendientes.length; // todos los estado 1
    const pct = finalizadosSinHijo.length > 0 ? Math.round((entregados.length / finalizadosSinHijo.length) * 100) : 0;
    return { total, finalizados: finalizados.length, finalizadosSinHijo: finalizadosSinHijo.length, entregados: entregados.length, noEntregados: noEntregados.length, sinAsignar: sinAsignar.length, pendientes: pendientes.length, totalPendientes, pct };
  }, [filteredPedidos]);

  // ─── KPIs Services ─────────────────────────────────────────────────────────
  const servicesStats = useMemo(() => {
    const total = services.length;
    const finalizados = services.filter(s => Number(s.estado_nro) === 2);
    const realizados = finalizados.filter(s => [3, 17, 19].includes(Number(s.sub_estado_nro)));
    const noRealizados = finalizados.filter(s => ![3, 17, 19].includes(Number(s.sub_estado_nro)));
    const sinAsignar = services.filter(s => Number(s.estado_nro) === 1 && (!s.movil || Number(s.movil) === 0));
    const pendientes = services.filter(s => Number(s.estado_nro) === 1 && s.movil && Number(s.movil) !== 0);
    // % Con atraso (pendientes con delay < 0)
    const pendientesList = services.filter(s => Number(s.estado_nro) === 1);
    const conAtraso = pendientesList.filter(s => {
      const d = computeDelayMinutes(s.fch_hora_max_ent_comp ?? null);
      return d !== null && d < 0;
    }).length;
    const pctAtraso = pendientesList.length > 0 ? Math.round((conAtraso / pendientesList.length) * 100) : 0;
    const pctNoRealizados = finalizados.length > 0 ? Math.round((noRealizados.length / finalizados.length) * 100) : 0;
    const totalPendientes = sinAsignar.length + pendientes.length; // todos los estado 1
    return { total, finalizados: finalizados.length, realizados: realizados.length, noRealizados: noRealizados.length, sinAsignar: sinAsignar.length, pendientes: pendientes.length, totalPendientes, conAtraso, pctAtraso, pctNoRealizados };
  }, [services]);

  // ─── % Realizados en hora (services) ────────────────────────────────────────
  const pctRealizadosEnHora = useMemo(() => {
    const realizados = services.filter(s =>
      Number(s.estado_nro) === 2 && [3, 17, 19].includes(Number(s.sub_estado_nro))
    );
    if (realizados.length === 0) return null;
    const conAmbas = realizados.filter(s => s.fch_hora_max_ent_comp && s.fch_hora_finalizacion);
    if (conAmbas.length < 3) return null;
    const enHora = conAmbas.filter(s => {
      const fin = new Date(s.fch_hora_finalizacion!.replace(/\+00$/, '+00:00'));
      const lim = new Date(s.fch_hora_max_ent_comp!.replace(/\+00$/, '+00:00'));
      return fin <= lim;
    });
    return Math.round((enHora.length / conAmbas.length) * 100);
  }, [services]);

  // ─── Pedidos por hora ──────────────────────────────────────────────────────
  const pedidosPorHora = useMemo(() => {
    const map: Record<string, number> = {};
    filteredPedidos.forEach(p => {
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
  }, [filteredPedidos]);

  // ─── Pedidos por empresa (multi-serie) ────────────────────────────────────
  const pedidosPorEmpresa = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.forEach(p => {
      const key = getEmpresaNombre(p, movilEmpresa, empresas);
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if ([3, 17, 19].includes(Number(p.sub_estado_nro))) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes));
  }, [filteredPedidos, empresas, movilEmpresa]);

  // ─── Estados de pedidos (agrupados) ──────────────────────────────────────
  // Finalizado → Entregados (3/17/19) y No entregados, excluyendo pedido_hijo
  // Pendiente  → Móvil Asignado (5) y Sin Móvil Asignado (6+7 fusionados)
  const estadosPedidos = useMemo(() => {
    const total = filteredPedidos.length;
    const byEstado: Record<number, typeof filteredPedidos> = {};
    filteredPedidos.forEach(p => {
      const n = Number(p.estado_nro);
      if (!byEstado[n]) byEstado[n] = [];
      byEstado[n].push(p);
    });
    const maxCount = Math.max(...Object.values(byEstado).map(a => a.length), 1);
    const estadoNombres: Record<number, string> = { 1: 'Pendiente', 2: 'Finalizado', 4: 'Cancelado' };
    return (Object.entries(byEstado) as [string, typeof filteredPedidos][])
      .sort((a, b) => b[1].length - a[1].length)
      .map(([nroStr, list]) => {
        const nro = Number(nroStr);
        const label = estadoNombres[nro] ?? `Estado ${nro}`;
        const count = list.length;
        type SubRow = { label: string; value: number; pct: number; isEntregado: boolean };
        let subEstados: SubRow[];
        if (nro === 2) {
          // Finalizado: agrupar excluyendo pedido_hijo
          const sinHijo = list.filter(p => !p.pedido_hijo);
          const entregCnt = sinHijo.filter(p => [3, 17, 19].includes(Number(p.sub_estado_nro))).length;
          const noEntCnt = sinHijo.length - entregCnt;
          const den = Math.max(sinHijo.length, 1);
          subEstados = [
            { label: 'Entregados', value: entregCnt, pct: Math.round((entregCnt / den) * 100), isEntregado: true },
            { label: 'No entregados', value: noEntCnt, pct: Math.round((noEntCnt / den) * 100), isEntregado: false },
          ].filter(s => s.value > 0);
        } else if (nro === 1) {
          // Pendiente: fusionar sub-estados 6 (Ruteo Man) + 7 (Pend Asig Móvil)
          const subMap: Record<string, number> = {};
          list.forEach(p => {
            const sub = Number(p.sub_estado_nro);
            let key: string;
            if (sub === 6 || sub === 7) {
              key = 'Sin Móvil Asignado';
            } else {
              const desc = (p.sub_estado_desc ?? '').trim();
              key = desc ? `${desc} (${sub})` : `Sub-estado ${sub}`;
            }
            subMap[key] = (subMap[key] ?? 0) + 1;
          });
          subEstados = Object.entries(subMap)
            .sort((a, b) => b[1] - a[1])
            .map(([subLabel, sc]) => ({
              label: subLabel,
              value: sc,
              pct: Math.round((sc / count) * 100),
              isEntregado: false,
            }));
        } else {
          // Otros estados: mostrar sub-estados individuales
          const subMap: Record<string, { count: number; nro: number | null }> = {};
          list.forEach(p => {
            const subNro = p.sub_estado_nro != null ? Number(p.sub_estado_nro) : null;
            const desc = (p.sub_estado_desc ?? '').trim();
            const key = desc ? `${desc} (${subNro ?? ''})` : subNro != null ? `Sub-estado ${subNro}` : 'Sin sub-estado';
            if (!subMap[key]) subMap[key] = { count: 0, nro: subNro };
            subMap[key].count++;
          });
          subEstados = Object.entries(subMap)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([subLabel, { count: sc, nro }]) => ({
              label: subLabel,
              value: sc,
              pct: Math.round((sc / count) * 100),
              isEntregado: nro != null && [3, 17, 19].includes(nro),
            }));
        }
        return {
          label,
          value: count,
          pct: Math.round((count / Math.max(total, 1)) * 100),
          barPct: Math.round((count / maxCount) * 100),
          subEstados,
        };
      });
  }, [filteredPedidos]);

  // ─── Pedidos por zona (top 12 por total) ────────────────────────────────────
  const pedidosPorZona = useMemo(() => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.filter(p => p.zona_nro).forEach(p => {
      const key = `Zona ${p.zona_nro}`;
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2 && !p.pedido_hijo) {
        // Excluir pedidos hijo del conteo de entregados/no entregados
        if ([3, 17, 19].includes(Number(p.sub_estado_nro))) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => (b.entregados + b.noEntregados + b.pendientes) - (a.entregados + a.noEntregados + a.pendientes));
  }, [filteredPedidos]);

  // ─── Atrasos de pedidos pendientes ─────────────────────────────────────────
  const atrasosStats = useMemo(() => {
    const pendientes = filteredPedidos.filter(p => Number(p.estado_nro) === 1);
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
  }, [filteredPedidos]);

  // ─── Móviles con más entregas ──────────────────────────────────────────────
  const movilesTop = useMemo((): StackRow[] => {
    const map: Record<string, { entregados: number; noEntregados: number; pendientes: number }> = {};
    filteredPedidos.filter(p => p.movil && Number(p.movil) !== 0).forEach(p => {
      const key = `Móvil ${p.movil}`;
      if (!map[key]) map[key] = { entregados: 0, noEntregados: 0, pendientes: 0 };
      const estado = Number(p.estado_nro);
      if (estado === 2) {
        if ([3, 17, 19].includes(Number(p.sub_estado_nro))) map[key].entregados++;
        else map[key].noEntregados++;
      } else if (estado === 1) {
        map[key].pendientes++;
      }
    });
    return Object.entries(map)
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => {
        const totalB = b.entregados + b.noEntregados + b.pendientes;
        const totalA = a.entregados + a.noEntregados + a.pendientes;
        if (totalB !== totalA) return totalB - totalA;
        return b.entregados - a.entregados;
      });
  }, [filteredPedidos]);

  // ─── Móviles stats (respeta filtro de empresa) ─────────────────────────────
  const movilesStats = useMemo(() => {
    // Solo móviles con GPS vigente (INNER JOIN gps_latest_positions)
    const conGps = movilesRaw.filter(m => movilesConGps.has(String(m.nro)));
    // Filtrar por empresa si corresponde
    const list = selectedEmpresa === 'Todas'
      ? conGps
      : conGps.filter(m => {
          const nombre = empresas.get(m.empresa_fletera_id) ?? `Empresa ${m.empresa_fletera_id}`;
          return nombre === selectedEmpresa;
        });
    // Activos: mismo criterio que sidebar — solo estadoNro null/undefined/0/1/2
    const activos = list.filter(m => m.estadoNro === null || m.estadoNro === undefined || [0, 1, 2].includes(m.estadoNro));
    const totalActivos = activos.length;
    const conPedidos = activos.filter(m => m.pedidosAsignados > 0).length;
    const sinPedidos = totalActivos - conPedidos;
    const pctConPedidos = totalActivos > 0 ? Math.round((conPedidos / totalActivos) * 100) : 0;
    const pctSinPedidos = totalActivos > 0 ? Math.round((sinPedidos / totalActivos) * 100) : 0;
    // Disponibilidad de lote
    const totalLote = activos.reduce((s, m) => s + (m.tamanoLote ?? 0), 0);
    const disponible = activos.reduce((s, m) => s + Math.max(0, (m.tamanoLote ?? 0) - m.pedidosAsignados), 0);
    const pctDisponibilidad = totalLote > 0 ? Math.round((disponible / totalLote) * 100) : null;
    return { totalActivos, conPedidos, sinPedidos, pctConPedidos, pctSinPedidos, totalLote, disponible, pctDisponibilidad };
  }, [movilesRaw, movilesConGps, selectedEmpresa, empresas]);

  // ─── % Entregados en hora ───────────────────────────────────────────────────
  const pctEntregadosEnHora = useMemo(() => {
    const entregados = filteredPedidos.filter(p =>
      Number(p.estado_nro) === 2 && [3, 17, 19].includes(Number(p.sub_estado_nro)) && !p.pedido_hijo
    );
    if (entregados.length === 0) return null;
    const conAmbas = entregados.filter(p => p.fch_hora_max_ent_comp && p.fch_hora_finalizacion);
    if (conAmbas.length < 3) return null; // no hay suficientes datos
    const enHora = conAmbas.filter(p => {
      const finalizacion = new Date(p.fch_hora_finalizacion!.replace(/\+00$/, '+00:00'));
      const limite = new Date(p.fch_hora_max_ent_comp!.replace(/\+00$/, '+00:00'));
      return finalizacion <= limite;
    });
    return Math.round((enHora.length / conAmbas.length) * 100);
  }, [filteredPedidos]);

  return (
    <div className="h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-md border-b border-white/10 px-4 py-3">
        {/* Row 1: título + total pedidos centrado + cerrar */}
        <div className="relative flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-bold text-white">Centro Estadístico</h1>
            <p className="text-sm text-gray-400">{formatDate(date)}</p>
          </div>
          {/* Total pedidos + Total services centrado absolutamente */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-gray-400 leading-none mb-0.5">Total pedidos</p>
              <p className="text-3xl font-bold text-white leading-none">{pedidosStats.total}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <p className="text-xs text-gray-400 leading-none mb-0.5">Total services</p>
              <p className="text-3xl font-bold text-white leading-none">{servicesStats.total}</p>
            </div>
          </div>
          <button
            onClick={() => window.close()}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            Cerrar
          </button>
        </div>
        {/* Row 2: filtros + refresh */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Filtro empresa */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Empresa:</label>
            <select
              value={selectedEmpresa}
              onChange={e => setSelectedEmpresa(e.target.value)}
              className="text-xs bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
            >
              <option value="Todas" className="bg-gray-900">Todas</option>
              {empresaOptions.map(emp => (
                <option key={emp} value={emp} className="bg-gray-900">{emp}</option>
              ))}
            </select>
          </div>
          {/* Filtro producto */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Producto:</label>
            <select
              value={selectedProducto}
              onChange={e => setSelectedProducto(e.target.value)}
              className="text-xs bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
            >
              <option value="Todos" className="bg-gray-900">Todos</option>
              <option value="1002013" className="bg-gray-900">GLP Envasado 13 Kg</option>
            </select>
          </div>
          {/* Auto-refresh */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">
              Refresh:{' '}
              <span className="text-white font-semibold">
                {refreshSeconds === 0 ? 'Manual' : `${refreshSeconds}s`}
              </span>
            </label>
            <input
              type="range"
              min={0} max={100} step={5}
              value={refreshSeconds}
              onChange={e => setRefreshSeconds(Number(e.target.value))}
              className="w-24 accent-blue-400 cursor-pointer"
            />
            {/* Botón de refresh manual cuando el slash está en 0 */}
            {refreshSeconds === 0 && (
              <button
                onClick={() => setRefreshTick(t => t + 1)}
                title="Actualizar ahora"
                className="text-blue-400 hover:text-blue-300 transition-colors p-1 rounded hover:bg-white/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
          {isLoading && <span className="text-xs text-blue-400 animate-pulse">Actualizando…</span>}
        </div>
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

          {/* ── KPIs Móviles ── */}
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Móviles</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                label="Móviles Activos"
                value={movilesStats.totalActivos}
                sub="total activos"
                color="blue"
              />
              <KpiCard
                label="Con Pedidos Pend."
                value={`${movilesStats.pctConPedidos}%`}
                sub={`${movilesStats.conPedidos} móviles`}
                color={movilesStats.pctConPedidos >= 80 ? 'green' : movilesStats.pctConPedidos >= 40 ? 'orange' : 'red'}
              />
              <KpiCard
                label="Sin Pedidos"
                value={`${movilesStats.pctSinPedidos}%`}
                sub={`${movilesStats.sinPedidos} móviles`}
                color={movilesStats.sinPedidos > 0 ? 'purple' : 'gray'}
              />
              <KpiCard
                label="Zonas No Activas"
                value={zonasNoActivasCount !== null ? zonasNoActivasCount : '—'}
                color={zonasNoActivasCount !== null && zonasNoActivasCount > 0 ? 'red' : 'gray'}
              />
              <KpiCard
                label="Zonas Sin Móvil"
                value={zonasSinMovilCount !== null ? zonasSinMovilCount : '—'}
                sub="tipo urgente"
                color={zonasSinMovilCount !== null && zonasSinMovilCount > 0 ? 'orange' : 'gray'}
              />
              <KpiCard
                label="% Disponibilidad"
                value={movilesStats.pctDisponibilidad !== null ? `${movilesStats.pctDisponibilidad}%` : '—'}
                sub={movilesStats.totalLote > 0 ? `${movilesStats.disponible}/${movilesStats.totalLote} lote` : undefined}
                color={movilesStats.pctDisponibilidad === null ? 'gray' : movilesStats.pctDisponibilidad >= 60 ? 'green' : movilesStats.pctDisponibilidad >= 30 ? 'orange' : 'red'}
              />
            </div>
          </section>

          {/* ── KPIs: Pedidos Pendientes / Finalizados ── */}
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Columna Pedidos Pendientes */}
              <div className="rounded-xl border border-blue-400/20 bg-blue-500/5 p-4">
                <h2 className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-3">Pedidos Pendientes</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Sin asignar"
                    value={pedidosStats.sinAsignar}
                    color={pedidosStats.sinAsignar > 0 ? 'orange' : 'gray'}
                  />
                  <KpiCard
                    label="Total pendientes"
                    value={pedidosStats.totalPendientes}
                    color="blue"
                  />
                  <KpiCard
                    label="% Con atraso"
                    value={`${atrasosStats.pctAtraso}%`}
                    sub={`${atrasosStats.muyAtrasado + atrasosStats.atrasado} pedidos`}
                    color={atrasosStats.pctAtraso >= 50 ? 'red' : atrasosStats.pctAtraso >= 20 ? 'orange' : 'green'}
                  />
                </div>
              </div>
              {/* Columna Pedidos Finalizados */}
              <div className="rounded-xl border border-green-400/20 bg-green-500/5 p-4">
                <h2 className="text-xs font-semibold text-green-300 uppercase tracking-wider mb-3">Pedidos Finalizados</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Entregados"
                    value={pedidosStats.entregados}
                    sub={`de ${pedidosStats.finalizadosSinHijo}`}
                    color="green"
                  />
                  <KpiCard
                    label="% No entregados"
                    value={pedidosStats.finalizadosSinHijo > 0 ? `${Math.round((pedidosStats.noEntregados / pedidosStats.finalizadosSinHijo) * 100)}%` : '—'}
                    sub={`${pedidosStats.noEntregados} pedidos`}
                    color={pedidosStats.noEntregados > 0 ? 'orange' : 'green'}
                  />
                  <KpiCard
                    label="% Entregados en hora"
                    value={pctEntregadosEnHora !== null ? `${pctEntregadosEnHora}%` : '—'}
                    color={pctEntregadosEnHora === null ? 'gray' : pctEntregadosEnHora >= 80 ? 'green' : pctEntregadosEnHora >= 50 ? 'orange' : 'red'}
                  />
                </div>
              </div>
            </div>

          </section>

          {/* ── KPIs Services ── */}
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Columna Services Pendientes */}
              <div className="rounded-xl border border-blue-400/20 bg-blue-500/5 p-4">
                <h2 className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-3">Services Pendientes</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Sin asignar"
                    value={servicesStats.sinAsignar}
                    color={servicesStats.sinAsignar > 0 ? 'orange' : 'gray'}
                  />
                  <KpiCard
                    label="Total pendientes"
                    value={servicesStats.totalPendientes}
                    color="blue"
                  />
                  <KpiCard
                    label="% Con atraso"
                    value={`${servicesStats.pctAtraso}%`}
                    sub={`${servicesStats.conAtraso} services`}
                    color={servicesStats.pctAtraso >= 50 ? 'red' : servicesStats.pctAtraso >= 20 ? 'orange' : 'green'}
                  />
                </div>
              </div>
              {/* Columna Services Finalizados */}
              <div className="rounded-xl border border-green-400/20 bg-green-500/5 p-4">
                <h2 className="text-xs font-semibold text-green-300 uppercase tracking-wider mb-3">Services Finalizados</h2>
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard
                    label="Realizados"
                    value={servicesStats.realizados}
                    sub={`de ${servicesStats.finalizados}`}
                    color="green"
                  />
                  <KpiCard
                    label="% No realizados"
                    value={servicesStats.finalizados > 0 ? `${servicesStats.pctNoRealizados}%` : '—'}
                    sub={`${servicesStats.noRealizados} services`}
                    color={servicesStats.noRealizados > 0 ? 'orange' : 'green'}
                  />
                  <KpiCard
                    label="% Realizados en hora"
                    value={pctRealizadosEnHora !== null ? `${pctRealizadosEnHora}%` : '—'}
                    color={pctRealizadosEnHora === null ? 'gray' : pctRealizadosEnHora >= 80 ? 'green' : pctRealizadosEnHora >= 50 ? 'orange' : 'red'}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Gráficos ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* Pedidos por hora */}
            {pedidosPorHora.length > 0 && (
              <ExpandableCard title="Pedidos por hora">
                <BarChart data={pedidosPorHora} colorClass="bg-blue-500" />
              </ExpandableCard>
            )}

            {/* Estados de pedidos */}
            {estadosPedidos.length > 0 && (
              <ExpandableCard title="Pedidos por estado">
                <div className="space-y-4">
                  {estadosPedidos.map(estado => (
                    <div key={estado.label}>
                      {/* Barra principal de estado */}
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-semibold text-gray-200">{estado.label}</span>
                        <span className="font-bold text-white">
                          {estado.value}
                          <span className="text-gray-500 font-normal ml-1">· {estado.pct}%</span>
                        </span>
                      </div>
                      <div className="h-3 bg-white/10 rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-700"
                          style={{ width: `${Math.max(estado.barPct, estado.value > 0 ? 2 : 0)}%` }}
                        />
                      </div>
                      {/* Sub-estados desglosados */}
                      <div className="pl-3 border-l border-white/10 space-y-1.5">
                        {estado.subEstados.map(sub => (
                          <div key={sub.label}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="text-gray-400 truncate max-w-[65%]">{sub.label}</span>
                              <span className="text-gray-300 font-semibold">
                                {sub.value}
                                <span className="text-gray-600 font-normal ml-1">· {sub.pct}%</span>
                              </span>
                            </div>
                            <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  sub.isEntregado ? 'bg-green-400' :
                                  estado.label === 'Pendiente' ? 'bg-blue-400' : 'bg-orange-400'
                                }`}
                                style={{ width: `${Math.max(sub.pct, sub.value > 0 ? 2 : 0)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ExpandableCard>
            )}

            {/* Pedidos por empresa */}
            {pedidosPorEmpresa.length > 0 && (
              <ExpandableCard
                title="Pedidos por empresa"
                expandedChildren={<StackedBarChart data={pedidosPorEmpresa} expanded />}
              >
                <StackedBarChart data={pedidosPorEmpresa.slice(0, 10)} />
              </ExpandableCard>
            )}

            {/* Top móviles */}
            {movilesTop.length > 0 && (
              <ExpandableCard
                title="Top móviles por entregas"
                expandedChildren={<StackedBarChart data={movilesTop} expanded />}
              >
                <StackedBarChart data={movilesTop.slice(0, 10)} />
              </ExpandableCard>
            )}

            {/* Pedidos por zona */}
            {pedidosPorZona.length > 0 && (
              <ExpandableCard
                title="Pedidos por zona"
                expandedChildren={<StackedBarChart data={pedidosPorZona} expanded />}
              >
                <StackedBarChart data={pedidosPorZona.slice(0, 12)} />
              </ExpandableCard>
            )}

            {/* Atrasos de pedidos */}
            <ExpandableCard title="Atrasos de pedidos pendientes">
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
            </ExpandableCard>
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
