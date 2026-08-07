import { describe, expect, it } from 'vitest';
import type { LabJob, MotorScore, VarianteKnobs, VarianteScore } from '@/types/metricas-variantes';
import {
  PROMO_MARGEN_PTS,
  PROMO_MIN_DIAS_EVALUADOS,
  PROMO_MIN_DIAS_GANADOS,
  buildReprocesoFetch,
  buildVariantesFetch,
  diasVsMotor,
  duracionTexto,
  evaluarPromocion,
  fechaMontevideoHoy,
  hayJobActivo,
  knobChips,
  narrativaLab,
  restarDias,
  resumenJob,
} from './variantes-logic';

const KNOBS_NULOS: VarianteKnobs = {
  estadistico: null,
  nivel_ritmo: null,
  factor: null,
  escalon_minutos: null,
  suavizado: true,
  suavizado_paso: null,
  min_minutos: null,
};

function variante(over: Partial<VarianteScore>): VarianteScore {
  return {
    id: 99,
    codigo: 'X',
    nombre: 'X',
    descripcion: '',
    activa: true,
    knobs: KNOBS_NULOS,
    n: 0,
    le_tol: null,
    sesgo: null,
    dias_ganados: 0,
    dias_total: 0,
    dias: [],
    ...over,
  };
}

describe('restarDias / fechaMontevideoHoy', () => {
  it('cruza límites de mes y año sin sorpresas', () => {
    expect(restarDias('2026-08-07', 6)).toBe('2026-08-01');
    expect(restarDias('2026-08-03', 6)).toBe('2026-07-28');
    expect(restarDias('2026-01-02', 6)).toBe('2025-12-27');
  });

  it('hoy en Montevideo tiene formato YYYY-MM-DD', () => {
    expect(fechaMontevideoHoy(new Date('2026-08-07T15:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a las 02:00 UTC en Montevideo todavía es el día anterior', () => {
    expect(fechaMontevideoHoy(new Date('2026-08-07T02:00:00Z'))).toBe('2026-08-06');
  });
});

describe('buildVariantesFetch', () => {
  const base = {
    escenario: 1000,
    tipo: 'URGENTE' as const,
    dias: 7,
    tolerancia: 25,
    hoy: '2026-08-07',
    empresaSel: null,
    isRoot: true,
    empresasIds: [],
    funcionalidades: ['Estadisticas Cumplimiento'],
  };

  it('arma la URL con el rango calculado desde hoy', () => {
    const intent = buildVariantesFetch(base);
    if (intent.skip) throw new Error('no debería saltear');
    expect(intent.url).toContain('escenario=1000');
    expect(intent.url).toContain('desde=2026-08-01');
    expect(intent.url).toContain('hasta=2026-08-07');
    expect(intent.url).toContain('tolerancia=25');
    expect(intent.url).toContain('tipo=URGENTE');
    expect(intent.headers['x-track-isroot']).toBe('S');
  });

  it('fail-closed: no-root sin empresas asignadas saltea', () => {
    expect(buildVariantesFetch({ ...base, isRoot: false, empresasIds: [] })).toEqual({ skip: true });
  });

  it('no-root manda sus empresas en el header', () => {
    const intent = buildVariantesFetch({ ...base, isRoot: false, empresasIds: [3, 7] });
    if (intent.skip) throw new Error('no debería saltear');
    expect(intent.headers['x-track-empresas-ids']).toBe('3,7');
    expect(intent.headers['x-track-isroot']).toBeUndefined();
  });
});

describe('knobChips', () => {
  it('sin perillas cambiadas es el espejo del motor', () => {
    expect(knobChips(KNOBS_NULOS)).toEqual(['espejo del motor']);
  });

  it('cada perilla produce su chip legible', () => {
    expect(knobChips({ ...KNOBS_NULOS, estadistico: 'MEDIA' })).toEqual(['promedio']);
    expect(knobChips({ ...KNOBS_NULOS, nivel_ritmo: 'ZONA' })).toEqual(['ritmo de zona']);
    expect(knobChips({ ...KNOBS_NULOS, factor: 0.8 })).toEqual(['×0,8']);
    expect(knobChips({ ...KNOBS_NULOS, escalon_minutos: 10 })).toEqual(['escalón 10′']);
    expect(knobChips({ ...KNOBS_NULOS, suavizado: false })).toEqual(['sin escalera']);
    expect(knobChips({ ...KNOBS_NULOS, suavizado_paso: 30 })).toEqual(['escalera de a 30′']);
    expect(knobChips({ ...KNOBS_NULOS, min_minutos: 20 })).toEqual(['piso 20′']);
  });

  it('el combo lista todas sus perillas', () => {
    expect(knobChips({ ...KNOBS_NULOS, factor: 0.8, escalon_minutos: 10 })).toEqual(['×0,8', 'escalón 10′']);
  });
});

const MOTOR: MotorScore = {
  n: 700,
  le_tol: 78,
  sesgo: -4,
  dias: [
    { fecha: '2026-08-01', n: 100, le_tol: 80 },
    { fecha: '2026-08-02', n: 100, le_tol: 75 },
    { fecha: '2026-08-03', n: 100, le_tol: 70 },
    { fecha: '2026-08-04', n: 100, le_tol: 82 },
    { fecha: '2026-08-05', n: 100, le_tol: 78 },
    { fecha: '2026-08-06', n: 100, le_tol: 79 },
    { fecha: '2026-08-07', n: 100, le_tol: 81 },
  ],
};

function diasVariante(leTols: number[], n = 100) {
  return MOTOR.dias.map((d, i) => ({
    fecha: d.fecha,
    n,
    le_tol: leTols[i] ?? null,
    despacho_le_tol: 76,
    gana: null,
  }));
}

describe('diasVsMotor', () => {
  it('cuenta solo días con mínimo de pedidos en ambos lados', () => {
    const v = variante({ dias: diasVariante([85, 80, 75, 85, 80, 85, 85], 10) });
    expect(diasVsMotor(v, MOTOR, 20)).toEqual({ ganados: 0, total: 0 });
    const v2 = variante({ dias: diasVariante([85, 80, 75, 85, 80, 85, 85]) });
    expect(diasVsMotor(v2, MOTOR, 20)).toEqual({ ganados: 7, total: 7 });
  });

  it('empate no cuenta como ganado', () => {
    const v = variante({ dias: diasVariante([80, 75, 70, 82, 78, 79, 81]) });
    expect(diasVsMotor(v, MOTOR, 20)).toEqual({ ganados: 0, total: 7 });
  });
});

describe('evaluarPromocion', () => {
  it('el CAMPEON nunca se promociona', () => {
    const v = variante({ codigo: 'CAMPEON', le_tol: 99, dias: diasVariante([99, 99, 99, 99, 99, 99, 99]) });
    expect(evaluarPromocion(v, MOTOR, 20).promovible).toBe(false);
  });

  it('sin días suficientes no se promociona aunque gane', () => {
    const v = variante({ le_tol: 90, dias: diasVariante([90, 90, 90]).slice(0, 3) });
    const r = evaluarPromocion(v, MOTOR, 20);
    expect(r.promovible).toBe(false);
    expect(r.motivo).toContain(`${PROMO_MIN_DIAS_EVALUADOS}`);
  });

  it('con mayoría de días ganados y margen se promociona', () => {
    const v = variante({ le_tol: 82, dias: diasVariante([85, 80, 75, 85, 80, 85, 85]) });
    const r = evaluarPromocion(v, MOTOR, 20);
    expect(r.promovible).toBe(true);
    expect(r.motivo).toContain('7 de 7');
  });

  it('gana días pero sin margen acumulado: no se promociona', () => {
    const v = variante({
      le_tol: (MOTOR.le_tol ?? 0) + PROMO_MARGEN_PTS - 0.1,
      dias: diasVariante([85, 80, 75, 85, 80, 85, 85]),
    });
    const r = evaluarPromocion(v, MOTOR, 20);
    expect(r.promovible).toBe(false);
    expect(r.motivo).toContain('margen');
  });

  it('pierde la mayoría de los días: no se promociona', () => {
    const v = variante({ le_tol: 90, dias: diasVariante([70, 70, 60, 70, 70, 85, 85]) });
    const r = evaluarPromocion(v, MOTOR, 20);
    expect(r.promovible).toBe(false);
    expect(r.motivo).toContain(`${PROMO_MIN_DIAS_GANADOS}`);
  });
});

describe('narrativaLab', () => {
  it('sin datos lo dice sin inventar', () => {
    const texto = narrativaLab({ variantes: [], motor: null, despacho: null, minN: 20, tolerancia: 25 });
    expect(texto).toContain('todavía no juntó');
  });

  it('elige la mejor variante real (nunca el control) y compara contra los dos', () => {
    const campeon = variante({ codigo: 'CAMPEON', nombre: 'Campeón', le_tol: 95, n: 700 });
    const mejor = variante({
      codigo: 'FACTOR_080',
      nombre: 'Calibración ×0,80',
      knobs: { ...KNOBS_NULOS, factor: 0.8 },
      le_tol: 82,
      n: 700,
      dias: diasVariante([85, 80, 75, 85, 80, 85, 85]),
    });
    const texto = narrativaLab({
      variantes: [campeon, mejor],
      motor: MOTOR,
      despacho: { le_tol: 76 },
      minN: 20,
      tolerancia: 25,
    });
    expect(texto).toContain('Calibración ×0,80');
    expect(texto).toContain('×0,8');
    expect(texto).toContain('vs el motor real');
    expect(texto).toContain('vs el Despacho');
    expect(texto).not.toContain('Campeón (');
  });
});

function job(over: Partial<LabJob>): LabJob {
  return {
    id: 1,
    escenario: 1000,
    desde: '2026-08-01',
    hasta: '2026-08-07',
    variantes: null,
    estado: 'PENDIENTE',
    corridas: null,
    filas: null,
    error: null,
    pedido_por: 'dmedaglia@riogas.com.uy',
    creado_at: '2026-08-07T12:00:00Z',
    iniciado_at: null,
    terminado_at: null,
    duracion_seg: null,
    ...over,
  };
}

describe('buildReprocesoFetch', () => {
  const base = {
    escenario: 1000,
    isRoot: true,
    funcionalidades: ['Estadisticas Cumplimiento'],
  };

  it('sin escenario saltea', () => {
    expect(buildReprocesoFetch({ ...base, escenario: null })).toEqual({ skip: true });
  });

  it('fail-closed: el que no es root no reprocesa, tenga las empresas que tenga', () => {
    expect(buildReprocesoFetch({ ...base, isRoot: false })).toEqual({ skip: true });
    expect(
      buildReprocesoFetch({
        ...base,
        isRoot: false,
        crear: { desde: '2026-08-01', hasta: '2026-08-07', variantes: null },
      }),
    ).toEqual({ skip: true });
  });

  it('sin crear es la consulta de la cola (GET, sin body)', () => {
    const intent = buildReprocesoFetch(base);
    if (intent.skip) throw new Error('no debería saltear');
    expect(intent.method).toBe('GET');
    expect(intent.url).toBe('/api/metricas/variantes/reproceso?escenario=1000');
    expect(intent.headers['x-track-isroot']).toBe('S');
    expect(intent.headers['x-track-funcs']).toBe('Estadisticas Cumplimiento');
    expect(intent.body).toBeUndefined();
  });

  it('con crear arma el POST con el rango y todas las variantes', () => {
    const intent = buildReprocesoFetch({
      ...base,
      crear: { desde: '2026-08-01', hasta: '2026-08-07', variantes: null },
    });
    if (intent.skip) throw new Error('no debería saltear');
    expect(intent.method).toBe('POST');
    expect(intent.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(intent.body ?? '{}')).toEqual({
      desde: '2026-08-01',
      hasta: '2026-08-07',
      variantes: null,
    });
  });

  it('manda la selección de variantes tal cual', () => {
    const intent = buildReprocesoFetch({
      ...base,
      crear: { desde: '2026-08-05', hasta: '2026-08-07', variantes: [3, 7] },
    });
    if (intent.skip) throw new Error('no debería saltear');
    expect(JSON.parse(intent.body ?? '{}').variantes).toEqual([3, 7]);
  });

  it('selección vacía no es «todas»: no se pide nada', () => {
    expect(
      buildReprocesoFetch({ ...base, crear: { desde: '2026-08-01', hasta: '2026-08-07', variantes: [] } }),
    ).toEqual({ skip: true });
  });
});

describe('hayJobActivo', () => {
  it('pendiente o corriendo cuentan; listo y error no', () => {
    expect(hayJobActivo([])).toBe(false);
    expect(hayJobActivo([job({ estado: 'LISTO' }), job({ id: 2, estado: 'ERROR' })])).toBe(false);
    expect(hayJobActivo([job({ estado: 'LISTO' }), job({ id: 2, estado: 'PENDIENTE' })])).toBe(true);
    expect(hayJobActivo([job({ estado: 'CORRIENDO' })])).toBe(true);
  });
});

describe('duracionTexto', () => {
  it('formatea segundos y minutos, y no inventa cuando no hay dato', () => {
    expect(duracionTexto(null)).toBeNull();
    expect(duracionTexto(undefined)).toBeNull();
    expect(duracionTexto(-3)).toBeNull();
    expect(duracionTexto(45)).toBe('45 s');
    expect(duracionTexto(120)).toBe('2 min');
    expect(duracionTexto(200)).toBe('3 min 20 s');
  });
});

describe('resumenJob', () => {
  it('pendiente: dice el rango, el alcance y que espera al worker', () => {
    const texto = resumenJob(job({}));
    expect(texto).toContain('1/8 al 7/8');
    expect(texto).toContain('todas las variantes');
    expect(texto).toContain('en cola');
  });

  it('un solo día no se escribe como rango', () => {
    expect(resumenJob(job({ desde: '2026-08-07', hasta: '2026-08-07' }))).toContain('7/8 · todas');
  });

  it('cuenta las variantes elegidas, en singular y en plural', () => {
    expect(resumenJob(job({ variantes: [4] }))).toContain('1 variante ');
    expect(resumenJob(job({ variantes: [4, 5, 6] }))).toContain('3 variantes');
  });

  it('corriendo muestra hace cuánto', () => {
    const texto = resumenJob(job({ estado: 'CORRIENDO', duracion_seg: 95 }));
    expect(texto).toContain('corriendo hace 1 min 35 s');
  });

  it('listo muestra corridas y filas con separador de miles', () => {
    const texto = resumenJob(job({ estado: 'LISTO', corridas: 1240, filas: 16120, duracion_seg: 180 }));
    expect(texto).toContain('1.240 corridas');
    expect(texto).toContain('16.120 filas');
    expect(texto).toContain('en 3 min');
  });

  it('listo sin corridas lo dice en vez de mostrar un cero pelado', () => {
    expect(resumenJob(job({ estado: 'LISTO', corridas: null, filas: null }))).toContain('sin corridas');
  });

  it('error muestra el mensaje de la base', () => {
    const texto = resumenJob(job({ estado: 'ERROR', error: 'division by zero' }));
    expect(texto).toContain('falló: division by zero');
  });

  it('error sin mensaje no inventa uno', () => {
    expect(resumenJob(job({ estado: 'ERROR', error: null }))).toContain('sin detalle');
  });
});
