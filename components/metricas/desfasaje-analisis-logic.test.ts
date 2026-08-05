import { describe, it, expect } from 'vitest';
import {
  buildAnalisisFetch,
  lecturaZona,
  veredicto,
  diasGanados,
  fechaCorta,
  pctText,
  sesgoText,
  narrarDiagnostico,
} from './desfasaje-analisis-logic';
import type { AnalisisDiagnostico } from '@/types/metricas-desfasaje';
import type { AnalisisDia } from '@/types/metricas-desfasaje';

const FUNC = 'Estadisticas Cumplimiento';

describe('buildAnalisisFetch()', () => {
  const base = {
    escenario: 1000, tipo: null, dias: 7, fuente: 'informada' as const, fecha: null,
    empresaSel: null, isRoot: true, empresasIds: [], funcionalidades: [FUNC],
  };

  it('skip sin escenario y skip fail-closed para no-root sin empresas', () => {
    expect(buildAnalisisFetch({ ...base, escenario: null }).skip).toBe(true);
    expect(buildAnalisisFetch({ ...base, isRoot: false, empresasIds: [] }).skip).toBe(true);
  });

  it('arma URL con fuente y fecha, y root se anuncia por header', () => {
    const i = buildAnalisisFetch({ ...base, fuente: 'calculada', fecha: '2026-08-03', tipo: 'URGENTE' });
    if (i.skip) throw new Error('no debía saltear');
    expect(i.url).toContain('/api/metricas/desfasaje/analisis?');
    expect(i.url).toContain('fuente=calculada');
    expect(i.url).toContain('fecha=2026-08-03');
    expect(i.url).toContain('tipo=URGENTE');
    expect(i.headers['x-track-isroot']).toBe('S');
    expect(i.headers['x-track-funcs']).toBe(FUNC);
  });

  it('no-root manda el scope por header y NO se anuncia root', () => {
    const i = buildAnalisisFetch({ ...base, isRoot: false, empresasIds: [7, 9] });
    if (i.skip) throw new Error('no debía saltear');
    expect(i.headers['x-track-empresas-ids']).toBe('7,9');
    expect(i.headers['x-track-isroot']).toBeUndefined();
  });
});

describe('lecturaZona() — las filas reales del informe caen en su etiqueta', () => {
  it('zona 72 (sesgo +11,5, tarde 21%) → tarde sistemático', () => {
    expect(lecturaZona({ sesgo_mediana: 11.5, tarde30_pct: 0.214 })).toBe('tarde sistemático');
  });
  it('zona 451 (tarde 23%, sesgo −2,7) → 1 de 4 tarde', () => {
    expect(lecturaZona({ sesgo_mediana: -2.7, tarde30_pct: 0.232 })).toBe('1 de 4 tarde');
  });
  it('zona 390 (sesgo −18,9, tarde 16%) → errático', () => {
    expect(lecturaZona({ sesgo_mediana: -18.9, tarde30_pct: 0.161 })).toBe('errático');
  });
  it('zona 57 (sesgo −18,8, tarde 5%) → sobrepromesa', () => {
    expect(lecturaZona({ sesgo_mediana: -18.8, tarde30_pct: 0.053 })).toBe('sobrepromesa');
  });
  it('zona 27 (sesgo −7,7) → poco colchón', () => {
    expect(lecturaZona({ sesgo_mediana: -7.7, tarde30_pct: 0.174 })).toBe('poco colchón');
  });
  it('zona 452 (sesgo −10, tarde 5%) → disperso', () => {
    expect(lecturaZona({ sesgo_mediana: -10.0, tarde30_pct: 0.054 })).toBe('disperso');
  });
});

describe('veredicto()', () => {
  it('gana el motor con la diferencia en puntos', () => {
    expect(veredicto(0.693, 0.829)).toEqual({ ganador: 'motor', puntos: 13.6 });
  });
  it('gana el Despacho', () => {
    expect(veredicto(0.785, 0.725)).toEqual({ ganador: 'despacho', puntos: 6 });
  });
  it('menos de medio punto es empate, no señal', () => {
    expect(veredicto(0.735, 0.733)?.ganador).toBe('empate');
  });
  it('null cuando falta una de las dos', () => {
    expect(veredicto(null, 0.7)).toBeNull();
  });
});

describe('diasGanados()', () => {
  it('cuenta días por ganador con el umbral de empate', () => {
    const dias: AnalisisDia[] = [
      { fecha: '2026-07-29', n: 100, despacho_le25: 0.693, motor_le25: 0.829, despacho_p80: null, motor_p80: null },
      { fecha: '2026-07-30', n: 100, despacho_le25: 0.785, motor_le25: 0.725, despacho_p80: null, motor_p80: null },
      { fecha: '2026-07-31', n: 100, despacho_le25: 0.735, motor_le25: 0.733, despacho_p80: null, motor_p80: null },
    ];
    expect(diasGanados(dias)).toEqual({ motor: 1, despacho: 1, empates: 1 });
  });
});

describe('formatos', () => {
  it('fechaCorta: día de semana + d/m sin ceros', () => {
    // 2026-08-03 fue lunes.
    expect(fechaCorta('2026-08-03').toLowerCase()).toContain('lun');
    expect(fechaCorta('2026-08-03')).toContain('3/8');
  });
  it('pctText con coma es-UY y em dash para null', () => {
    expect(pctText(0.765)).toBe('76,5%');
    expect(pctText(null)).toBe('—');
  });
  it('sesgoText con signo explícito en los positivos', () => {
    expect(sesgoText(11.5)).toBe('+11,5');
    expect(sesgoText(-10.7)).toBe('-10,7');
  });
});

describe('narrarDiagnostico() — la autopsia real del 4/8 como fixture', () => {
  // Salida REAL de la RPC para el 4/8 (2.393 comparables).
  const DIAG_4_8: AnalisisDiagnostico = {
    n: 2393, ambos: 956, solo_despacho: 793, solo_motor: 271, ninguno: 373,
    c_techo: 31, c_escalera: 127, c_sobrestimo: 595, c_subestimo: 40, c_operativo: 0,
    despacho_colchon: 178, despacho_tarde: 93,
    despacho_le25: 0.7309, motor_le25: 0.5127, cruda_le25: 0.5625, cruda_n: 2393,
  };

  it('dice quién ganó y ordena las causas por peso, con la dominante primero', () => {
    const nar = narrarDiagnostico(DIAG_4_8);
    expect(nar.titulo).toContain('Despacho ganó');
    expect(nar.causas[0].clave).toBe('c_sobrestimo');
    expect(nar.causas[0].n).toBe(595);
    // El operativo (0) no se lista: solo causas con pedidos.
    expect(nar.causas.some((c) => c.clave === 'c_operativo')).toBe(false);
  });

  it('el contrafáctico es SINCERO: con la cruda a 17 pts, dice que falta MODELO, no publicación', () => {
    const nar = narrarDiagnostico(DIAG_4_8);
    const contrafactico = nar.parrafos.find((p2) => p2.includes('CRUDO'));
    expect(contrafactico).toBeDefined();
    expect(contrafactico).toContain('de MODELO');
    expect(contrafactico).not.toContain('fricción de PUBLICACIÓN');
  });

  it('cuando la cruda empata al Despacho, el mensaje cambia a "es publicación"', () => {
    const nar = narrarDiagnostico({ ...DIAG_4_8, cruda_le25: 0.74 });
    const contrafactico = nar.parrafos.find((p2) => p2.includes('CRUDO'));
    expect(contrafactico).toContain('PUBLICACIÓN');
  });

  it('la nota anti-inflación cuenta el colchón y la subpromesa del Despacho', () => {
    const nar = narrarDiagnostico(DIAG_4_8);
    const anti = nar.parrafos.find((p2) => p2.includes('Inflar demoras'));
    expect(anti).toContain('178');
    expect(anti).toContain('93');
  });

  it('empate técnico cuando la diferencia es menor a medio punto', () => {
    const nar = narrarDiagnostico({ ...DIAG_4_8, despacho_le25: 0.731, motor_le25: 0.733 });
    expect(nar.titulo).toContain('Empate');
  });
});
