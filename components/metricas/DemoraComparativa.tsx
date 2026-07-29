'use client';

/**
 * Comparativa entre la demora que calcula TrackMovil y la que informa el
 * AS400, por zona y tipo de servicio.
 *
 * El AS400 solo informa URGENTE. Para NOCTURNO y SERVICE se dibuja solo
 * nuestra línea y se dice explícitamente: un hueco sin explicar se lee como
 * un bug.
 */

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TIPOS_DEMORA } from '@/types/demoras-comparativa';
import type { TipoDemora, ComparativaData } from '@/types/demoras-comparativa';
import { formatMin } from './metricas-theme';
import { sinAlcanceNoRoot, buildComparativaFetch, mensajeSinDatos, MENSAJE_SIN_ALCANCE } from './demora-comparativa-logic';

const COLOR_CALC = 'var(--color-metricas-serie)';
const COLOR_AS400 = 'var(--color-metricas-nocturno)';
/** Marca de los puntos sin capacidad (B2): amarillo de alerta del tema stats. */
const COLOR_SIN_CAP = 'var(--color-stats-warning, #eab308)';

function horaDe(iso: string): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Punto del gráfico: la serie del endpoint más lo que necesita Recharts. */
interface PuntoGrafico {
  corrida_at: string;
  zona_id: number;
  calculada: number | null;
  as400: number | null;
  hora: string;
  /** Cuántas zonas de ese timestamp informaron el techo por falta de móviles. */
  sin_cap_n: number;
  /** Cuántas zonas hay en ese timestamp (1 cuando hay zona elegida). */
  total_n: number;
}

/**
 * Dot de la línea calculada: invisible salvo cuando el punto viene de una
 * corrida SIN CAPACIDAD (B2). Ahí la demora informada es el techo por
 * definición —no había un solo móvil activo—, no un número que salió del
 * modelo; sin marcarlo, el arranque del día se lee como "el motor dice 120".
 */
function DotSinCapacidad(props: {
  cx?: number; cy?: number; payload?: PuntoGrafico;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload || payload.sin_cap_n === 0) return null;
  // Relleno pleno solo si TODAS las zonas del punto están sin capacidad;
  // hueco si es parcial (agregado de varias zonas).
  const pleno = payload.sin_cap_n === payload.total_n;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.2}
      stroke={COLOR_SIN_CAP}
      strokeWidth={1.6}
      fill={pleno ? COLOR_SIN_CAP : 'none'}
    />
  );
}

export function DemoraComparativa({
  escenario,
  isRoot,
  empresasIds,
  funcionalidades,
}: {
  escenario: number | null;
  /** true = ve todas las empresas (root). Viene de canSeeAllEmpresas(user). */
  isRoot: boolean;
  /** Empresas fleteras del scope del usuario. Vacio + no root = card vacia. */
  empresasIds: number[];
  /**
   * Nombres de funcionalidades de los roles del usuario. Van al header
   * x-track-funcs: el endpoint corre requireFuncionalidad('Estadisticas
   * Cumplimiento') y sin este header ningun no-root pasaba (B5).
   */
  funcionalidades: string[];
}) {
  const [tipo, setTipo] = useState<TipoDemora>('URGENTE');
  const [zona, setZona] = useState<number | null>(null);
  const [data, setData] = useState<ComparativaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Fix round 1 (Important): un no-root sin ninguna empresa en su scope NO
  // tiene ninguna zona posible que ver — el fail-closed del endpoint
  // (EMPTY_DATA) ya se sabe de antemano, así que ni se llama. Distinto del
  // caso "el motor no corrió" (con scope, pero sin corridas hoy).
  const sinAlcance = sinAlcanceNoRoot(isRoot, empresasIds);

  useEffect(() => {
    const intent = buildComparativaFetch({ escenario, tipo, zona, isRoot, empresasIds, funcionalidades });
    if (intent.skip) return;

    const ac = new AbortController();
    setCargando(true);
    setError(null);

    fetch(intent.url, { headers: intent.headers, signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        if (!j?.success) throw new Error(j?.error ?? 'Error desconocido');
        setData(j.data as ComparativaData);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escenario, tipo, zona, isRoot, empresasIds.join(','), funcionalidades.join(',')]);

  const hayAs400 = tipo === 'URGENTE';

  // La serie viene con puntos de TODAS las zonas cuando no hay una elegida.
  // Dibujarla tal cual da una linea en zigzag saltando entre zonas en el mismo
  // timestamp. Con zona elegida se grafica esa; sin zona, se promedia por
  // timestamp para que la linea signifique "el escenario en conjunto".
  const serie: PuntoGrafico[] = (() => {
    const puntos = data?.serie ?? [];
    if (zona != null) {
      return puntos.map((p) => ({
        corrida_at: p.corrida_at,
        zona_id: p.zona_id,
        calculada: p.calculada,
        as400: p.as400,
        hora: horaDe(p.corrida_at),
        sin_cap_n: p.sin_capacidad ? 1 : 0,
        total_n: 1,
      }));
    }
    const porHora = new Map<string, { c: number[]; a: number[]; sinCap: number; total: number }>();
    for (const p of puntos) {
      const e = porHora.get(p.corrida_at) ?? { c: [], a: [], sinCap: 0, total: 0 };
      e.c.push(p.calculada);
      if (p.as400 !== null) e.a.push(p.as400);
      if (p.sin_capacidad) e.sinCap += 1;
      e.total += 1;
      porHora.set(p.corrida_at, e);
    }
    const prom = (xs: number[]) =>
      xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    return [...porHora.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([corrida_at, e]) => ({
        corrida_at,
        zona_id: -1,
        // Fix round 1 (Minor): e.c nunca está vacío acá (se puebla al crear
        // la entrada del Map, arriba), así que el `?? 0` original era rama
        // muerta hoy — pero si la acumulación cambia alguna vez y un
        // promedio queda sin dato, preferimos un hueco visible en el
        // gráfico (null, sin connectNulls en esta Line) a un 0 falso y
        // creíble. Mismo tipo que as400.
        calculada: prom(e.c),
        as400: prom(e.a),
        hora: horaDe(corrida_at),
        sin_cap_n: e.sinCap,
        total_n: e.total,
      }));
  })();

  const excluidas = data?.excluidas_sin_capacidad ?? 0;
  const totalFilas = data?.total_filas ?? 0;
  const escenarioConfigurado = data?.escenario_configurado ?? true;

  if (sinAlcance) {
    return <p className="py-6 text-center text-sm text-stats-muted-fg">{MENSAJE_SIN_ALCANCE}</p>;
  }

  if (error) {
    return <p className="py-6 text-center text-sm text-stats-destructive">No se pudo cargar la comparativa: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Tipo</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDemora)}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            {TIPOS_DEMORA.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-[0.3rem]">
          <span className="text-[0.66rem] font-semibold uppercase tracking-wide text-stats-muted-fg">Zona</span>
          <select
            value={zona ?? ''}
            onChange={(e) => setZona(e.target.value === '' ? null : Number(e.target.value))}
            className="rounded-md border border-stats-border bg-stats-surface-2 px-2.5 py-1.5 text-sm text-stats-foreground outline-none focus:border-stats-primary"
          >
            <option value="">Todas las zonas</option>
            {(data?.zonas ?? []).map((z) => (
              <option key={z.zona_id} value={z.zona_id}>{z.zona_nombre}</option>
            ))}
          </select>
        </label>
        {!hayAs400 && (
          <p className="max-w-[34ch] text-[0.78rem] text-stats-muted-fg">
            El AS400 no informa demora para {tipo}: solo se muestra la línea calculada.
          </p>
        )}
      </div>

      {cargando && !data ? (
        <div className="h-[240px] animate-pulse rounded-lg bg-stats-surface-2" />
      ) : serie.length === 0 ? (
        <p className="py-6 text-center text-sm text-stats-muted-fg">
          {mensajeSinDatos(escenarioConfigurado)}
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={serie} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stats-border)" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 11 }} stroke="var(--color-stats-muted-fg)" />
              <YAxis unit="'" tick={{ fontSize: 11 }} stroke="var(--color-stats-muted-fg)" />
              {/* Recharts 3.10 tipa Formatter con `ValueType | undefined` (unknown a
                  efectos prácticos), no `number | null` — mismo ajuste que
                  components/metricas/TipoBarChart.tsx:80 (LabelList formatter). */}
              <Tooltip formatter={(v: unknown) => (v == null ? '—' : `${formatMin(v as number)} min`)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {/* dot condicional: solo se pinta en los puntos sin capacidad (B2). */}
              <Line
                type="stepAfter"
                dataKey="calculada"
                name="Calculada"
                stroke={COLOR_CALC}
                strokeWidth={2.4}
                dot={<DotSinCapacidad />}
                activeDot={{ r: 3.5 }}
              />
              {hayAs400 && (
                <Line type="monotone" dataKey="as400" name="AS400" stroke={COLOR_AS400} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>

          {excluidas > 0 && (
            <p className="flex items-start gap-2 text-[0.78rem] leading-snug text-stats-muted-fg">
              <span
                aria-hidden
                className="mt-[0.35rem] inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: COLOR_SIN_CAP }}
              />
              <span>
                {excluidas} de {totalFilas} corridas del día no tenían ningún móvil activo en la
                zona: informan el techo por definición, no por cálculo. Están marcadas en el
                gráfico y <strong>quedan fuera</strong> del promedio y de la brecha de la tabla.
              </span>
            </p>
          )}
        </>
      )}

      {(data?.zonas.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-left text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Zona</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Calculada</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">AS400</th>
                <th className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg">Brecha</th>
                <th
                  className="border-b border-stats-border px-2.5 py-1.5 text-right text-[0.68rem] font-bold uppercase tracking-wide text-stats-muted-fg"
                  title="Corridas del día sin ningún móvil activo en la zona: informan el techo por definición y quedan fuera del promedio."
                >
                  s/cap.
                </th>
              </tr>
            </thead>
            <tbody>
              {(data?.zonas ?? []).slice(0, 12).map((z) => (
                <tr key={z.zona_id} className="hover:bg-stats-surface-2">
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-stats-foreground">{z.zona_nombre}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.prom_calculada)}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.prom_as400)}</td>
                  <td className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-foreground">{formatMin(z.brecha)}</td>
                  {/* B2: cuántas corridas de esa zona quedaron fuera del promedio.
                      Una zona con "12 / 99" es una zona cuyo promedio se apoya en
                      poca evidencia — sin esta columna, el número parecía firme. */}
                  <td
                    className="border-b border-stats-border px-2.5 py-1.5 text-right font-stats-mono tabular-nums text-stats-muted-fg"
                    style={z.excluidas_sin_capacidad > 0 ? { color: COLOR_SIN_CAP } : undefined}
                  >
                    {z.excluidas_sin_capacidad > 0
                      ? `${z.excluidas_sin_capacidad} / ${z.excluidas_sin_capacidad + z.muestras}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
