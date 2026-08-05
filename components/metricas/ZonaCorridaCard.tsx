'use client';

/**
 * Card "Radiografía por zona" (pedido de Diego, audio 12 del 5/8): para
 * el día de HOY, por zona — qué demora dio el Despacho, qué dio el motor,
 * la brecha, y el % de acierto del día en cada zona (calculado EN VIVO
 * desde los pedidos entregados). El combo de corridas permite elegir
 * cualquier horario del día; en "Última" la card se refresca sola cada
 * 60 segundos.
 *
 * Datos: /api/metricas/zona-corrida (RPC metricas_zona_corrida).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TipoDesfasaje } from '@/types/metricas-desfasaje';
import { TIPOS_DESFASAJE } from '@/types/metricas-desfasaje';
import type { ZonaCorridaData } from '@/types/metricas-evolucion';
import { formatMin } from './metricas-theme';
import { horaMontevideo } from './demora-comparativa-logic';
import { pctText } from './desfasaje-analisis-logic';
import {
  buildZonaCorridaFetch, ordenarZonas, filtrarZonas, FASE_LABEL,
  type OrdenZonas,
} from './zona-corrida-logic';

const COLOR_DESPACHO = 'var(--color-metricas-despacho)';
const COLOR_MOTOR = 'var(--color-metricas-serie)';
const FASE_COLOR: Record<string, string> = {
  PREDICTIVO: '#5B9BD5',
  GRACIA_VENCIDA: '#E0A800',
  TRANSITO: '#8E6BB8',
};

const REFRESCO_MS = 60_000;

const SELECT_CLS =
  'rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary';
const TH_CLS = 'px-2 py-1.5 text-left text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg';
const TD_CLS = 'px-2 py-1 text-sm text-stats-foreground';

export function ZonaCorridaCard({
  escenario,
  empresaSel,
  isRoot,
  empresasIds,
  funcionalidades,
}: {
  escenario: number | null;
  empresaSel: number | null;
  isRoot: boolean;
  empresasIds: number[];
  funcionalidades: string[];
}) {
  const [tipo, setTipo] = useState<TipoDesfasaje | null>('URGENTE');
  const [corridaSel, setCorridaSel] = useState<string | null>(null); // null = última (en vivo)
  const [orden, setOrden] = useState<OrdenZonas>('brecha');
  const [filtro, setFiltro] = useState('');
  const [data, setData] = useState<ZonaCorridaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  const intent = useMemo(
    () => buildZonaCorridaFetch({ escenario, tipo, corrida: corridaSel, empresaSel, isRoot, empresasIds, funcionalidades }),
    [escenario, tipo, corridaSel, empresaSel, isRoot, empresasIds, funcionalidades],
  );

  const cargar = useCallback(() => {
    if (intent.skip) return;
    setCargando(true);
    fetch(intent.url, { headers: intent.headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: ZonaCorridaData; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
        setError(null);
        setActualizado(new Date());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, [intent]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // En "Última" la foto es viva: refresco cada 60 s con la pestaña visible.
  useEffect(() => {
    if (corridaSel !== null || intent.skip) return;
    const tick = () => {
      if (document.visibilityState === 'visible') cargar();
    };
    const t = setInterval(tick, REFRESCO_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [corridaSel, intent.skip, cargar]);

  if (intent.skip) {
    return (
      <p className="py-6 text-center text-sm text-stats-muted-fg">
        No tenés empresas asignadas para ver la radiografía por zona. Consultá con el administrador.
      </p>
    );
  }

  const zonas = data ? ordenarZonas(filtrarZonas(data.zonas, filtro), orden) : [];
  const enVivo = corridaSel === null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Corrida</span>
          <select
            value={corridaSel ?? ''}
            onChange={(e) => setCorridaSel(e.target.value === '' ? null : e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Última (en vivo)</option>
            {(data?.corridas ?? []).slice().reverse().map((c) => (
              <option key={c} value={c}>{horaMontevideo(c)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo</span>
          <select
            value={tipo ?? ''}
            onChange={(e) => setTipo(e.target.value === '' ? null : (e.target.value as TipoDesfasaje))}
            className={SELECT_CLS}
          >
            <option value="">Urgente + Nocturno</option>
            {TIPOS_DESFASAJE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenZonas)} className={SELECT_CLS}>
            <option value="brecha">Mayor brecha motor−Despacho</option>
            <option value="acierto_motor">Peor acierto del motor hoy</option>
            <option value="zona">Número de zona</option>
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Zona</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Buscar…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="w-24 rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          />
        </label>
        <span className="ml-auto flex items-center gap-2 text-[0.78rem] text-stats-muted-fg">
          {enVivo && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
          )}
          {data?.corrida && <>corrida {horaMontevideo(data.corrida)}</>}
          {actualizado && enVivo && (
            <> · actualizado {actualizado.toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo', hour12: false })}</>
          )}
          <button
            type="button"
            onClick={cargar}
            disabled={cargando}
            className="rounded-md border border-stats-border px-2 py-0.5 text-stats-foreground hover:bg-stats-surface-2 disabled:opacity-50"
          >
            {cargando ? '…' : 'Actualizar'}
          </button>
        </span>
      </div>

      {error !== null ? (
        <p className="py-6 text-center text-sm text-stats-destructive">No se pudo cargar la radiografía: {error}</p>
      ) : !data ? (
        <div className="h-[280px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : data.corrida === null ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">
          Todavía no hay corridas del motor para hoy (arranca a las 07:00).
        </p>
      ) : (
        <>
          <div className="max-h-[480px] overflow-auto rounded-md border border-stats-border">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="sticky top-0 z-10 bg-stats-surface-2">
                <tr>
                  <th className={TH_CLS}>Zona</th>
                  <th className={TH_CLS}>Motor</th>
                  <th className={TH_CLS}>Despacho</th>
                  <th className={TH_CLS}>Brecha</th>
                  <th className={TH_CLS}>Estado</th>
                  <th className={TH_CLS}>Cola</th>
                  <th className={TH_CLS}>Ritmo</th>
                  <th className={TH_CLS} title="Acierto del día por zona, en vivo: % de pedidos entregados HOY con desfasaje ≤25′, sobre los que tienen las dos promesas">
                    Acierto hoy D / M (n)
                  </th>
                </tr>
              </thead>
              <tbody>
                {zonas.map((z) => (
                  <tr key={`${z.zona_id}-${z.tipo_servicio}`} className="border-t border-stats-border/50">
                    <td className={TD_CLS}>
                      Zona {z.zona_id}
                      {tipo === null && <span className="ml-1 text-[0.68rem] text-stats-muted-fg">{z.tipo_servicio}</span>}
                    </td>
                    <td className={`${TD_CLS} font-stats-mono font-semibold`} style={{ color: COLOR_MOTOR }}>
                      {formatMin(z.motor)}′
                    </td>
                    <td className={`${TD_CLS} font-stats-mono font-semibold`} style={{ color: COLOR_DESPACHO }}>
                      {z.despacho != null ? `${formatMin(z.despacho)}′` : '—'}
                    </td>
                    <td className={`${TD_CLS} font-stats-mono`}>
                      {z.brecha != null ? (
                        <span className={Math.abs(z.brecha) >= 30 ? 'font-bold' : ''}>
                          {z.brecha > 0 ? '+' : ''}{formatMin(z.brecha)}′
                        </span>
                      ) : '—'}
                    </td>
                    <td className={TD_CLS}>
                      {z.arranque_fase ? (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold text-white"
                          style={{ background: FASE_COLOR[z.arranque_fase] }}
                        >
                          {FASE_LABEL[z.arranque_fase] ?? z.arranque_fase}
                        </span>
                      ) : z.sin_capacidad ? (
                        <span className="text-[0.72rem] text-stats-muted-fg">sin móvil</span>
                      ) : (
                        <span className="font-stats-mono text-[0.72rem] text-stats-muted-fg">
                          {z.moviles_prioridad ?? 0}P{(z.moviles_transito ?? 0) > 0 ? ` +${z.moviles_transito}T` : ''}
                        </span>
                      )}
                    </td>
                    <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                      {z.cola_por_delante != null ? formatMin(z.cola_por_delante) : '—'}
                    </td>
                    <td className={`${TD_CLS} font-stats-mono text-stats-muted-fg`}>
                      {z.ritmo_usado != null ? `${formatMin(z.ritmo_usado)}′` : '—'}
                    </td>
                    <td className={`${TD_CLS} font-stats-mono`}>
                      {(z.comun ?? 0) > 0 ? (
                        <>
                          <span style={{ color: COLOR_DESPACHO }}>{pctText(z.d_le25)}</span>
                          {' / '}
                          <span style={{ color: COLOR_MOTOR }}>{pctText(z.m_le25)}</span>
                          <span className="text-stats-muted-fg"> ({z.comun})</span>
                        </>
                      ) : (
                        <span className="text-stats-muted-fg">sin entregas aún</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[0.72rem] text-stats-muted-fg">
            La foto (motor, Despacho, brecha, estado) es de la corrida elegida; el acierto es el acumulado del DÍA por
            zona, en vivo desde los pedidos entregados (promesa del motor = corrida vigente a la toma de cada pedido;
            agendados excluidos). Brecha = motor − Despacho: positiva, el motor promete más. Con "Última (en vivo)" la
            card se actualiza sola cada 60 segundos.
          </p>
        </>
      )}
    </div>
  );
}
