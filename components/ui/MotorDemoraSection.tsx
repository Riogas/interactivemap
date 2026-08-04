'use client';

/**
 * Preferencias Globales → sección "Motor de demora informada".
 *
 * Edita demoras_modelo (todas las perillas del cálculo) y demoras_config
 * (ventanas y encendido por tipo) del escenario elegido, contra
 * /api/demoras/modelo. La validación de dominio vive en los CHECKs de la
 * base; acá solo se tipa y se explica cada perilla. Cada guardado queda
 * versionado por el trigger (historial visible abajo) y las corridas
 * siguientes (≤10 min) salen estampadas con la versión nueva.
 *
 * Sin useAuth a propósito: los headers llegan por props (los computa el
 * modal) — la sección se puede renderizar y previsualizar sola.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type Primitivo = string | number | boolean | null;

interface ModeloRow { [k: string]: Primitivo }
interface ConfigRow {
  tipo_servicio: string;
  motor_activo: boolean;
  hora_inicio: string;
  hora_fin: string;
  [k: string]: Primitivo;
}
interface HistorialRow { version: number; cambiado_at: string; cambiado_por: string | null }
interface VentanaRow {
  tipo_servicio: string;
  dia_tipo: string;
  hora_inicio: string;
  hora_fin: string;
  [k: string]: Primitivo;
}
interface EsperaRow {
  tipo_servicio: string;
  dia_tipo: string;
  zona_id: number | null;
  hora_max: string;
  [k: string]: Primitivo;
}

interface Payload {
  modelo: ModeloRow | null;
  config: ConfigRow[];
  historial: HistorialRow[];
  escenarios: number[];
  ventanas: VentanaRow[];
  esperaMax: EsperaRow[];
}

const DIA_TIPOS = ['HABIL', 'SABADO', 'DOMINGO'];
const DIA_LABEL: Record<string, string> = { HABIL: 'Hábiles', SABADO: 'Sábado', DOMINGO: 'Domingo' };

type TipoCampo = 'int' | 'num' | 'bool' | 'select';

interface CampoDef {
  key: string;
  label: string;
  tipo: TipoCampo;
  hint?: string;
  opciones?: { valor: string; label: string }[];
  step?: number;
}

interface GrupoDef { titulo: string; descripcion?: string; campos: CampoDef[] }

const GRUPOS: GrupoDef[] = [
  {
    titulo: 'Salida publicada',
    descripcion: 'Los bordes del número que se informa.',
    campos: [
      { key: 'min_minutos', label: 'Mínimo (min)', tipo: 'int' },
      { key: 'max_minutos', label: 'Máximo / techo (min)', tipo: 'int' },
      { key: 'escalon_minutos', label: 'Redondeo (escalón, min)', tipo: 'int' },
    ],
  },
  {
    titulo: 'Suavizado',
    descripcion: 'Cuánto puede moverse el publicado entre corridas (cada 10 min).',
    campos: [
      { key: 'subida_max', label: 'Suba máxima por corrida', tipo: 'int' },
      { key: 'bajada_max', label: 'Baja máxima por corrida', tipo: 'int' },
      {
        key: 'suavizado_bypass_cambio_capacidad', label: 'Saltar el suavizado si cambió la cantidad de móviles', tipo: 'bool',
        hint: 'Un móvil que entra o sale es un cambio estructural, no ruido: el publicado salta directo al valor nuevo.',
      },
    ],
  },
  {
    titulo: 'Arranque sin móvil',
    descripcion: 'Qué informar cuando la zona no tiene ningún móvil de prioridad.',
    campos: [
      {
        key: 'arranque_sin_movil_modo', label: 'Modo', tipo: 'select',
        opciones: [
          { valor: 'TECHO', label: 'Techo (histórico)' },
          { valor: 'DESPACHO', label: 'Valor del Despacho (solo zona vacía)' },
          { valor: 'DESPACHO_MAS_COLA', label: 'Despacho + cola × ritmo (también con pedidos)' },
          { valor: 'PREDICTIVO', label: 'Predictivo: espera al primer móvil + cola × ritmo' },
        ],
        hint: 'PREDICTIVO (solo URGENTE): estima a qué hora aparece el primer móvil de prioridad con el histórico de la zona y promete esa espera; el tránsito es invisible hasta la espera máxima. NOCTURNO/SERVICE siguen como Despacho + cola.',
      },
      {
        key: 'activacion_percentil', label: 'Percentil del histórico', tipo: 'num', step: 0.05,
        hint: '0.5 = mediana (elegido por retro-backtest); 0.75 = más conservador.',
      },
      { key: 'activacion_margen_minutos', label: 'Colchón sobre la estimación (min)', tipo: 'int' },
      {
        key: 'activacion_min_muestras', label: 'Días mínimos de muestra', tipo: 'int',
        hint: 'Sin muestra suficiente cae a: histórico general de la zona → apertura de la ventana.',
      },
      {
        key: 'activacion_gracia_minutos', label: 'Gracia si el móvil no aparece (min)', tipo: 'int',
        hint: 'Pasada la hora estimada + gracia, la escalera sube al techo hasta la espera máxima.',
      },
    ],
  },
  {
    titulo: 'La cola',
    descripcion: 'Cuánto pesa cada pedido que espera.',
    campos: [
      {
        key: 'asignados_modo', label: 'Pedidos ya asignados', tipo: 'select',
        opciones: [
          { valor: 'COMPLETO', label: 'Cuentan enteros (histórico)' },
          { valor: 'PESO', label: 'Cuentan un peso fijo' },
          { valor: 'PROGRESO', label: 'Cuentan lo que les falta (realista)' },
        ],
        hint: 'PROGRESO descuenta el tiempo que el pedido ya lleva arriba del móvil contra el ritmo de la zona.',
      },
      { key: 'peso_asignados', label: 'Peso fijo (solo modo PESO)', tipo: 'num', step: 0.05 },
      {
        key: 'atrapados_modo', label: 'Pedidos atrapados (móvil que no salió)', tipo: 'select',
        opciones: [
          { valor: 'EXCLUIR', label: 'Excluir' },
          { valor: 'COMO_SIN_ASIGNAR', label: 'Contar como sin asignar' },
          { valor: 'EN_COLA', label: 'Dejar en la cola' },
        ],
      },
    ],
  },
  {
    titulo: 'Ritmo',
    descripcion: 'Cómo se mide cuánto tarda un móvil por pedido (cascada chofer → móvil → zona → global).',
    campos: [
      {
        key: 'estadistico', label: 'Estadístico', tipo: 'select',
        opciones: [
          { valor: 'MEDIANA', label: 'Mediana' },
          { valor: 'MEDIA', label: 'Media' },
          { valor: 'P75', label: 'Percentil 75' },
          { valor: 'P90', label: 'Percentil 90' },
        ],
      },
      { key: 'ritmo_dias_ventana', label: 'Ventana de historia (días)', tipo: 'int' },
      { key: 'ritmo_min_muestras', label: 'Muestras mínimas', tipo: 'int' },
      { key: 'ritmo_hueco_max_minutos', label: 'Hueco máximo entre entregas (min)', tipo: 'int' },
      { key: 'ritmo_hueco_min_minutos', label: 'Piso del intervalo (min)', tipo: 'int', hint: 'Filtra marcaciones en lote.' },
      { key: 'ritmo_default_minutos', label: 'Ritmo por defecto (min/pedido)', tipo: 'int' },
      { key: 'ritmo_solo_con_cola', label: 'Solo intervalos con cola esperando', tipo: 'bool' },
    ],
  },
  {
    titulo: 'Capacidad y traslados',
    campos: [
      { key: 'dedicacion_transito', label: 'Dedicación de una zona de tránsito', tipo: 'num', step: 0.05 },
      { key: 'transito_dedicacion_max_total', label: 'Tope total de tránsitos', tipo: 'num', step: 0.05 },
      { key: 'traslado_fuera_zona_minutos', label: 'Traslado desde otra zona (min)', tipo: 'int' },
      { key: 'incluir_entrega_propia', label: 'Contar la entrega en curso del móvil', tipo: 'bool' },
    ],
  },
  {
    titulo: 'Modelo y calibración',
    campos: [
      {
        key: 'modelo', label: 'Modelo de cálculo', tipo: 'select',
        opciones: [
          { valor: 'CONSUMO_TRAMOS', label: 'Consumo por tramos (vigente)' },
          { valor: 'CAPACIDAD_PROMEDIO', label: 'Capacidad promedio (comparación)' },
        ],
      },
      { key: 'factor_calibracion', label: 'Factor de calibración global', tipo: 'num', step: 0.05, hint: 'Multiplica el resultado crudo. 1 = sin ajuste.' },
    ],
  },
];

const TIPOS_CONFIG = ['URGENTE', 'NOCTURNO', 'SERVICE'];

const hhmm = (v: Primitivo) => String(v ?? '').slice(0, 5);

/**
 * Las tres filas URGENTE de la ventana por tipo de día. Si alguna no
 * existe en la base (solo se siembra URGENTE), se sintetiza desde la
 * ventana general de demoras_config — editarla la crea al guardar.
 */
function ventanasUrgente(p: Payload): VentanaRow[] {
  const cfgUrg = p.config.find((c) => c.tipo_servicio === 'URGENTE');
  return DIA_TIPOS.map((dia) => {
    const fila = (p.ventanas ?? []).find((v) => v.tipo_servicio === 'URGENTE' && v.dia_tipo === dia);
    return fila
      ? { ...fila }
      : {
          tipo_servicio: 'URGENTE',
          dia_tipo: dia,
          hora_inicio: String(cfgUrg?.hora_inicio ?? '07:00'),
          hora_fin: String(cfgUrg?.hora_fin ?? '23:30'),
        };
  });
}

const claveEspera = (e: { dia_tipo: string; zona_id: number | null }) =>
  `${e.dia_tipo}|${e.zona_id ?? 'def'}`;

export default function MotorDemoraSection({
  trackFuncs,
  isRootHeader,
  userName,
}: {
  trackFuncs: string;
  isRootHeader: 'S' | 'N';
  userName: string | null;
}) {
  const [escenario, setEscenario] = useState<number>(1000);
  const [data, setData] = useState<Payload | null>(null);
  const [modelo, setModelo] = useState<ModeloRow | null>(null);
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [ventanas, setVentanas] = useState<VentanaRow[]>([]);
  const [espera, setEspera] = useState<EsperaRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  // Formulario del override nuevo de espera máxima.
  const [nvZona, setNvZona] = useState('');
  const [nvDia, setNvDia] = useState('HABIL');
  const [nvHora, setNvHora] = useState('09:00');

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-track-isroot': isRootHeader,
      'x-track-funcs': trackFuncs,
      'x-track-user': userName ?? '',
    }),
    [isRootHeader, trackFuncs, userName],
  );

  const cargar = useCallback((esc: number) => {
    setCargando(true);
    setResultado(null);
    fetch(`/api/demoras/modelo?escenario=${esc}`, { headers })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: Payload; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
        setModelo(j.data.modelo ? { ...j.data.modelo } : null);
        setConfig(j.data.config.map((c) => ({ ...c })));
        setVentanas(ventanasUrgente(j.data));
        setEspera((j.data.esperaMax ?? []).filter((e) => e.tipo_servicio === 'URGENTE').map((e) => ({ ...e })));
      })
      .catch((e: unknown) => setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) }))
      .finally(() => setCargando(false));
  }, [headers]);

  useEffect(() => {
    cargar(escenario);
  }, [escenario, cargar]);

  // Diff contra lo cargado: el PUT viaja solo con lo que cambió (el
  // historial versiona por guardado — sin diff, cada save "cambiaría" todo).
  const cambios = useMemo(() => {
    const original = data?.modelo ?? null;
    const modeloDiff: Record<string, Primitivo> = {};
    if (original && modelo) {
      for (const k of Object.keys(modelo)) {
        if (modelo[k] !== original[k]) modeloDiff[k] = modelo[k];
      }
    }
    const configDiff = config
      .map((c) => {
        const orig = (data?.config ?? []).find((o) => o.tipo_servicio === c.tipo_servicio);
        if (!orig) return null;
        const d: Record<string, Primitivo> = {};
        for (const k of ['motor_activo', 'hora_inicio', 'hora_fin']) {
          if (c[k] !== orig[k]) d[k] = c[k];
        }
        return Object.keys(d).length > 0 ? { tipo_servicio: c.tipo_servicio, ...d } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Ventana por tipo de día (URGENTE): fila entera cuando cambió algo
    // (el PUT upsertea — la fila puede no existir todavía).
    const ventanasInit = data ? ventanasUrgente(data) : [];
    const ventanasDiff = ventanas
      .filter((v) => {
        const o = ventanasInit.find((x) => x.dia_tipo === v.dia_tipo);
        return !o || hhmm(o.hora_inicio) !== hhmm(v.hora_inicio) || hhmm(o.hora_fin) !== hhmm(v.hora_fin);
      })
      .map((v) => ({
        tipo_servicio: 'URGENTE',
        dia_tipo: v.dia_tipo,
        hora_inicio: hhmm(v.hora_inicio),
        hora_fin: hhmm(v.hora_fin),
      }));

    // Espera máxima: cambios y altas van con hora; los overrides quitados
    // viajan con hora_max null (la default nunca se borra).
    const esperaInit = (data?.esperaMax ?? []).filter((e) => e.tipo_servicio === 'URGENTE');
    const esperaDiff: Array<{ tipo_servicio: string; dia_tipo: string; zona_id: number | null; hora_max: string | null }> = [];
    for (const e of espera) {
      const o = esperaInit.find((x) => claveEspera(x) === claveEspera(e));
      if (!o || hhmm(o.hora_max) !== hhmm(e.hora_max)) {
        esperaDiff.push({ tipo_servicio: 'URGENTE', dia_tipo: e.dia_tipo, zona_id: e.zona_id, hora_max: hhmm(e.hora_max) });
      }
    }
    for (const o of esperaInit) {
      if (o.zona_id != null && !espera.some((e) => claveEspera(e) === claveEspera(o))) {
        esperaDiff.push({ tipo_servicio: 'URGENTE', dia_tipo: o.dia_tipo, zona_id: o.zona_id, hora_max: null });
      }
    }

    return { modeloDiff, configDiff, ventanasDiff, esperaDiff };
  }, [data, modelo, config, ventanas, espera]);

  const hayCambios = Object.keys(cambios.modeloDiff).length > 0 || cambios.configDiff.length > 0
    || cambios.ventanasDiff.length > 0 || cambios.esperaDiff.length > 0;

  const guardar = () => {
    if (!hayCambios || guardando) return;
    setGuardando(true);
    setResultado(null);
    fetch('/api/demoras/modelo', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        escenario,
        modelo: Object.keys(cambios.modeloDiff).length > 0 ? cambios.modeloDiff : undefined,
        config: cambios.configDiff.length > 0 ? cambios.configDiff : undefined,
        ventanas: cambios.ventanasDiff.length > 0 ? cambios.ventanasDiff : undefined,
        esperaMax: cambios.esperaDiff.length > 0 ? cambios.esperaDiff : undefined,
      }),
    })
      .then((r) => r.json())
      .then((j: { success: boolean; data?: Payload; error?: string }) => {
        if (!j.success || !j.data) throw new Error(j.error ?? 'Error desconocido');
        setData(j.data);
        setModelo(j.data.modelo ? { ...j.data.modelo } : null);
        setConfig(j.data.config.map((c) => ({ ...c })));
        setVentanas(ventanasUrgente(j.data));
        setEspera((j.data.esperaMax ?? []).filter((e) => e.tipo_servicio === 'URGENTE').map((e) => ({ ...e })));
        setResultado({ ok: true, msg: `Guardado — versión ${String(j.data.modelo?.version ?? '?')}. Impacta en la próxima corrida (≤10 min).` });
      })
      .catch((e: unknown) => setResultado({ ok: false, msg: e instanceof Error ? e.message : String(e) }))
      .finally(() => setGuardando(false));
  };

  const setCampo = (key: string, valor: Primitivo) => {
    setModelo((m) => (m ? { ...m, [key]: valor } : m));
  };

  const renderCampo = (c: CampoDef) => {
    if (!modelo) return null;
    const v = modelo[c.key];
    const deshabilitado =
      (c.key === 'peso_asignados' && modelo['asignados_modo'] !== 'PESO') ||
      (c.key.startsWith('activacion_') && modelo['arranque_sin_movil_modo'] !== 'PREDICTIVO');

    // Los select van en layout vertical (label arriba, control abajo): al
    // lado, el combo aplastaba la etiqueta en la columna angosta del grid.
    if (c.tipo === 'select') {
      return (
        <div key={c.key} className="py-1.5">
          <div className="text-sm text-gray-700">{c.label}</div>
          <select
            value={String(v ?? '')}
            onChange={(e) => setCampo(c.key, e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
          >
            {(c.opciones ?? []).map((o) => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
          </select>
          {c.hint && <div className="mt-0.5 text-xs text-gray-400">{c.hint}</div>}
        </div>
      );
    }

    return (
      <div key={c.key} className="flex items-center justify-between gap-3 py-1">
        <div className="min-w-0">
          <div className={`text-sm ${deshabilitado ? 'text-gray-400' : 'text-gray-700'}`}>{c.label}</div>
          {c.hint && <div className="text-xs text-gray-400">{c.hint}</div>}
        </div>
        {c.tipo === 'bool' ? (
          <input
            type="checkbox"
            checked={v === true}
            onChange={(e) => setCampo(c.key, e.target.checked)}
            className="h-4 w-4 shrink-0 accent-blue-600"
          />
        ) : (
          <input
            type="number"
            step={c.tipo === 'num' ? (c.step ?? 0.01) : 1}
            value={v === null || v === undefined ? '' : Number(v)}
            disabled={deshabilitado}
            onChange={(e) => {
              const n = e.target.value === '' ? null : Number(e.target.value);
              setCampo(c.key, n);
            }}
            className="w-24 shrink-0 rounded border border-gray-300 px-2 py-1 text-right text-sm text-gray-800 disabled:bg-gray-100 disabled:text-gray-400"
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-700">Motor de demora informada</div>
          <div className="text-xs text-gray-400">
            Todas las perillas del cálculo, por escenario. Cada guardado queda versionado y las corridas siguientes salen estampadas con la versión nueva.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Escenario</label>
          <select
            value={escenario}
            onChange={(e) => setEscenario(Number(e.target.value))}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
          >
            {(data?.escenarios?.length ? data.escenarios : [escenario]).map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          {modelo && (
            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
              versión {String(modelo.version ?? '—')}
            </span>
          )}
        </div>
      </div>

      {cargando && !modelo ? (
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
      ) : !modelo ? (
        <p className="py-4 text-sm text-gray-500">
          Este escenario no tiene configuración del motor (sin fila en demoras_modelo).
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {GRUPOS.map((g) => (
              <div key={g.titulo} className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{g.titulo}</div>
                {g.descripcion && <div className="mb-1 text-xs text-gray-400">{g.descripcion}</div>}
                <div className="divide-y divide-gray-100">
                  {g.campos.map(renderCampo)}
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Encendido y ventanas por tipo</div>
              <div className="mb-1 text-xs text-gray-400">Fuera de la ventana, ese tipo no calcula (no es un error).</div>
              <div className="divide-y divide-gray-100">
                {TIPOS_CONFIG.map((tipo) => {
                  const fila = config.find((c) => c.tipo_servicio === tipo);
                  if (!fila) {
                    return (
                      <div key={tipo} className="py-1 text-sm text-gray-400">
                        {tipo}: sin fila en demoras_config (tipo apagado)
                      </div>
                    );
                  }
                  return (
                    <div key={tipo} className="flex flex-wrap items-center gap-3 py-1.5">
                      <label className="flex w-28 items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={fila.motor_activo === true}
                          onChange={(e) =>
                            setConfig((cs) => cs.map((c) => (c.tipo_servicio === tipo ? { ...c, motor_activo: e.target.checked } : c)))
                          }
                          className="h-4 w-4 accent-blue-600"
                        />
                        {tipo}
                      </label>
                      <input
                        type="time"
                        value={String(fila.hora_inicio ?? '').slice(0, 5)}
                        onChange={(e) =>
                          setConfig((cs) => cs.map((c) => (c.tipo_servicio === tipo ? { ...c, hora_inicio: e.target.value } : c)))
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                      />
                      <span className="text-xs text-gray-400">a</span>
                      <input
                        type="time"
                        value={String(fila.hora_fin ?? '').slice(0, 5)}
                        onChange={(e) =>
                          setConfig((cs) => cs.map((c) => (c.tipo_servicio === tipo ? { ...c, hora_fin: e.target.value } : c)))
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Ventana por tipo de día (URGENTE)</div>
              <div className="mb-1 text-xs text-gray-400">
                Cuándo corre el motor cada tipo de día. Manda sobre la ventana general de arriba; NOCTURNO y SERVICE siguen usando la general.
              </div>
              <div className="divide-y divide-gray-100">
                {ventanas.map((v) => (
                  <div key={v.dia_tipo} className="flex flex-wrap items-center gap-3 py-1.5">
                    <span className="w-28 text-sm text-gray-700">{DIA_LABEL[v.dia_tipo] ?? v.dia_tipo}</span>
                    <input
                      type="time"
                      value={hhmm(v.hora_inicio)}
                      onChange={(e) =>
                        setVentanas((vs) => vs.map((x) => (x.dia_tipo === v.dia_tipo ? { ...x, hora_inicio: e.target.value } : x)))
                      }
                      className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                    />
                    <span className="text-xs text-gray-400">a</span>
                    <input
                      type="time"
                      value={hhmm(v.hora_fin)}
                      onChange={(e) =>
                        setVentanas((vs) => vs.map((x) => (x.dia_tipo === v.dia_tipo ? { ...x, hora_fin: e.target.value } : x)))
                      }
                      className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 md:col-span-2">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Espera máxima al móvil de prioridad (URGENTE)</div>
              <div className="mb-1 text-xs text-gray-400">
                Hasta qué hora del día el arranque predictivo espera al primer móvil de prioridad (el tránsito es invisible hasta esa hora).
                La default aplica a todas las zonas; un override la pisa solo para esa zona.
              </div>
              <div className="flex flex-wrap items-center gap-4 py-1.5">
                {DIA_TIPOS.map((dia) => {
                  const fila = espera.find((e) => e.zona_id === null && e.dia_tipo === dia);
                  return (
                    <label key={dia} className="flex items-center gap-2 text-sm text-gray-700">
                      {DIA_LABEL[dia]}
                      <input
                        type="time"
                        value={fila ? hhmm(fila.hora_max) : ''}
                        onChange={(e) => {
                          const hora = e.target.value;
                          setEspera((es) => {
                            const idx = es.findIndex((x) => x.zona_id === null && x.dia_tipo === dia);
                            if (idx >= 0) return es.map((x, i) => (i === idx ? { ...x, hora_max: hora } : x));
                            return [...es, { tipo_servicio: 'URGENTE', dia_tipo: dia, zona_id: null, hora_max: hora }];
                          });
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                      />
                    </label>
                  );
                })}
              </div>

              {espera.some((e) => e.zona_id !== null) && (
                <div className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
                  {espera
                    .filter((e) => e.zona_id !== null)
                    .sort((a, b) => (a.zona_id ?? 0) - (b.zona_id ?? 0) || a.dia_tipo.localeCompare(b.dia_tipo))
                    .map((e) => (
                      <div key={claveEspera(e)} className="flex flex-wrap items-center gap-3 py-1.5">
                        <span className="w-24 text-sm text-gray-700">Zona {e.zona_id}</span>
                        <span className="w-20 text-xs text-gray-500">{DIA_LABEL[e.dia_tipo] ?? e.dia_tipo}</span>
                        <input
                          type="time"
                          value={hhmm(e.hora_max)}
                          onChange={(ev) =>
                            setEspera((es) => es.map((x) => (claveEspera(x) === claveEspera(e) ? { ...x, hora_max: ev.target.value } : x)))
                          }
                          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                        />
                        <button
                          type="button"
                          onClick={() => setEspera((es) => es.filter((x) => claveEspera(x) !== claveEspera(e)))}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                <span className="text-xs text-gray-500">Override por zona:</span>
                <input
                  type="number"
                  placeholder="Zona"
                  value={nvZona}
                  onChange={(e) => setNvZona(e.target.value)}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                />
                <select
                  value={nvDia}
                  onChange={(e) => setNvDia(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
                >
                  {DIA_TIPOS.map((d) => (
                    <option key={d} value={d}>{DIA_LABEL[d]}</option>
                  ))}
                </select>
                <input
                  type="time"
                  value={nvHora}
                  onChange={(e) => setNvHora(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
                />
                <button
                  type="button"
                  disabled={!Number.isFinite(Number.parseInt(nvZona, 10)) || nvHora === ''}
                  onClick={() => {
                    const zona = Number.parseInt(nvZona, 10);
                    if (!Number.isFinite(zona)) return;
                    setEspera((es) => {
                      const nueva = { tipo_servicio: 'URGENTE', dia_tipo: nvDia, zona_id: zona, hora_max: nvHora };
                      const idx = es.findIndex((x) => claveEspera(x) === claveEspera(nueva));
                      if (idx >= 0) return es.map((x, i) => (i === idx ? { ...x, hora_max: nvHora } : x));
                      return [...es, nueva];
                    });
                    setNvZona('');
                  }}
                  className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={guardar}
              disabled={!hayCambios || guardando}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {guardando ? 'Guardando…' : 'Guardar cambios del motor'}
            </button>
            {hayCambios && !guardando && (
              <span className="text-xs text-gray-500">
                {Object.keys(cambios.modeloDiff).length + cambios.configDiff.length + cambios.ventanasDiff.length + cambios.esperaDiff.length} cambio(s) sin guardar
              </span>
            )}
            {resultado && (
              <span className={`text-xs ${resultado.ok ? 'text-green-600' : 'text-red-600'}`}>{resultado.msg}</span>
            )}
          </div>

          {(data?.historial?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Últimos cambios</div>
              <ul className="space-y-0.5">
                {(data?.historial ?? []).map((h) => (
                  <li key={h.version} className="text-xs text-gray-500">
                    v{h.version} · {new Date(h.cambiado_at).toLocaleString('es-UY', { timeZone: 'America/Montevideo' })}
                    {h.cambiado_por ? ` · ${h.cambiado_por}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
