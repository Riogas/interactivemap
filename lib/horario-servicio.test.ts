import { describe, it, expect } from 'vitest';
import { isNocturnoHour, determineServicePeriod, parseTimeToDecimal, NIGHT_START_HOUR, DAY_START_HOUR } from './horario-servicio';

/**
 * Helper para crear fechas con hora local sin dependencia de timezone.
 * Usa new Date(year, month, day, hour, minute) que interpreta en TZ local del proceso.
 */
function makeDate(hour: number, minute = 0): Date {
  return new Date(2026, 0, 1, hour, minute, 0, 0);
}

describe('constantes', () => {
  it('NIGHT_START_HOUR es 20.5 (20:30)', () => {
    expect(NIGHT_START_HOUR).toBe(20.5);
  });

  it('DAY_START_HOUR es 6 (06:00)', () => {
    expect(DAY_START_HOUR).toBe(6);
  });
});

describe('parseTimeToDecimal', () => {
  it('parsea HH:MM correctamente', () => {
    expect(parseTimeToDecimal('20:30')).toBe(20.5);
  });

  it('parsea HH:MM:SS ignorando segundos a efectos del decimal', () => {
    expect(parseTimeToDecimal('06:00:00')).toBe(6);
  });

  it('parsea medianoche', () => {
    expect(parseTimeToDecimal('00:00')).toBe(0);
  });

  it('retorna null para null', () => {
    expect(parseTimeToDecimal(null)).toBeNull();
  });

  it('retorna null para string vacio', () => {
    expect(parseTimeToDecimal('')).toBeNull();
  });

  it('retorna null para formato invalido', () => {
    expect(parseTimeToDecimal('abc')).toBeNull();
  });

  it('retorna null para hora fuera de rango', () => {
    expect(parseTimeToDecimal('25:00')).toBeNull();
  });
});

describe('isNocturnoHour', () => {
  it('00:00 es nocturno', () => {
    expect(isNocturnoHour(makeDate(0, 0))).toBe(true);
  });

  it('05:59 es nocturno (antes del fin del nocturno)', () => {
    expect(isNocturnoHour(makeDate(5, 59))).toBe(true);
  });

  it('06:00 es diurno (inicio exacto del diurno)', () => {
    expect(isNocturnoHour(makeDate(6, 0))).toBe(false);
  });

  it('06:01 es diurno', () => {
    expect(isNocturnoHour(makeDate(6, 1))).toBe(false);
  });

  it('12:00 es diurno (mediodia)', () => {
    expect(isNocturnoHour(makeDate(12, 0))).toBe(false);
  });

  it('20:29 es diurno (un minuto antes del inicio nocturno)', () => {
    expect(isNocturnoHour(makeDate(20, 29))).toBe(false);
  });

  it('20:30 es nocturno (inicio exacto del nocturno)', () => {
    expect(isNocturnoHour(makeDate(20, 30))).toBe(true);
  });

  it('20:31 es nocturno', () => {
    expect(isNocturnoHour(makeDate(20, 31))).toBe(true);
  });

  it('23:59 es nocturno', () => {
    expect(isNocturnoHour(makeDate(23, 59))).toBe(true);
  });

  it('03:00 es nocturno (madrugada)', () => {
    expect(isNocturnoHour(makeDate(3, 0))).toBe(true);
  });

  it('10:00 es diurno (manana)', () => {
    expect(isNocturnoHour(makeDate(10, 0))).toBe(false);
  });

  describe('con horarios custom', () => {
    // Custom: nocturno desde 22:00 hasta 07:00
    const customNight = 22;
    const customDay = 7;

    it('21:00 es diurno con nocturno custom desde 22:00', () => {
      expect(isNocturnoHour(makeDate(21, 0), customNight, customDay)).toBe(false);
    });

    it('22:00 es nocturno con nocturno custom desde 22:00', () => {
      expect(isNocturnoHour(makeDate(22, 0), customNight, customDay)).toBe(true);
    });

    it('06:59 es nocturno con diurno custom desde 07:00', () => {
      expect(isNocturnoHour(makeDate(6, 59), customNight, customDay)).toBe(true);
    });

    it('07:00 es diurno con diurno custom desde 07:00', () => {
      expect(isNocturnoHour(makeDate(7, 0), customNight, customDay)).toBe(false);
    });

    it('null customNightStart usa default (20.5)', () => {
      expect(isNocturnoHour(makeDate(20, 30), null, null)).toBe(true);
    });

    it('null customDayStart usa default (6)', () => {
      expect(isNocturnoHour(makeDate(6, 0), null, null)).toBe(false);
    });
  });
});

describe('determineServicePeriod', () => {
  describe('cuando aplicaNocturno=true', () => {
    it('hora diurna (10:00) retorna URGENTE', () => {
      expect(determineServicePeriod(makeDate(10, 0), true)).toBe('URGENTE');
    });

    it('hora nocturna (22:00) retorna NOCTURNO', () => {
      expect(determineServicePeriod(makeDate(22, 0), true)).toBe('NOCTURNO');
    });

    it('hora de madrugada (03:00) retorna NOCTURNO', () => {
      expect(determineServicePeriod(makeDate(3, 0), true)).toBe('NOCTURNO');
    });

    it('exactamente las 20:30 retorna NOCTURNO', () => {
      expect(determineServicePeriod(makeDate(20, 30), true)).toBe('NOCTURNO');
    });

    it('exactamente las 06:00 retorna URGENTE', () => {
      expect(determineServicePeriod(makeDate(6, 0), true)).toBe('URGENTE');
    });
  });

  describe('cuando aplicaNocturno=false (escenario sin nocturno)', () => {
    it('hora nocturna (22:00) retorna URGENTE (siempre diurno)', () => {
      expect(determineServicePeriod(makeDate(22, 0), false)).toBe('URGENTE');
    });

    it('hora diurna (10:00) retorna URGENTE', () => {
      expect(determineServicePeriod(makeDate(10, 0), false)).toBe('URGENTE');
    });

    it('madrugada (03:00) retorna URGENTE (ignora horario nocturno)', () => {
      expect(determineServicePeriod(makeDate(3, 0), false)).toBe('URGENTE');
    });
  });

  describe('con horarios custom', () => {
    it('21:00 con nocturno custom 22:00-07:00 retorna URGENTE', () => {
      expect(determineServicePeriod(makeDate(21, 0), true, 22, 7)).toBe('URGENTE');
    });

    it('22:00 con nocturno custom 22:00-07:00 retorna NOCTURNO', () => {
      expect(determineServicePeriod(makeDate(22, 0), true, 22, 7)).toBe('NOCTURNO');
    });

    it('con custom y aplicaNocturno=false siempre retorna URGENTE', () => {
      expect(determineServicePeriod(makeDate(22, 0), false, 22, 7)).toBe('URGENTE');
    });

    it('null customs usan defaults (backward compat)', () => {
      expect(determineServicePeriod(makeDate(20, 30), true, null, null)).toBe('NOCTURNO');
      expect(determineServicePeriod(makeDate(6, 0), true, null, null)).toBe('URGENTE');
    });
  });
});

describe('deteccion de transicion horaria', () => {
  it('cruzar de 20:29 a 20:30 cambia el periodo de URGENTE a NOCTURNO', () => {
    const antesDeTransicion = makeDate(20, 29);
    const despuesDeTransicion = makeDate(20, 30);

    const periodoAntes = determineServicePeriod(antesDeTransicion, true);
    const periodoDespues = determineServicePeriod(despuesDeTransicion, true);

    expect(periodoAntes).toBe('URGENTE');
    expect(periodoDespues).toBe('NOCTURNO');
    expect(periodoAntes).not.toBe(periodoDespues); // transicion detectada
  });

  it('cruzar de 05:59 a 06:00 cambia el periodo de NOCTURNO a URGENTE', () => {
    const antesDeTransicion = makeDate(5, 59);
    const despuesDeTransicion = makeDate(6, 0);

    const periodoAntes = determineServicePeriod(antesDeTransicion, true);
    const periodoDespues = determineServicePeriod(despuesDeTransicion, true);

    expect(periodoAntes).toBe('NOCTURNO');
    expect(periodoDespues).toBe('URGENTE');
    expect(periodoAntes).not.toBe(periodoDespues); // transicion detectada
  });

  it('con aplicaNocturno=false, cruzar 20:30 NO cambia el periodo', () => {
    const antesDeTransicion = makeDate(20, 29);
    const despuesDeTransicion = makeDate(20, 30);

    const periodoAntes = determineServicePeriod(antesDeTransicion, false);
    const periodoDespues = determineServicePeriod(despuesDeTransicion, false);

    expect(periodoAntes).toBe('URGENTE');
    expect(periodoDespues).toBe('URGENTE');
  });
});
