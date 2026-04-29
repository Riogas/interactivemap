/**
 * Tests para lib/import-helpers/gps-autocreate.ts
 *
 * Cubre:
 *   - isValidLatLng con múltiples shapes (NaN, 0, string, undefined, fuera de rango)
 *   - startOfDayMontevideoIso con fechas fijas (mismo día Montevideo en distintos UTC)
 *   - selectMovilesNeedingDailyPosition: 0 cubiertos, parcialmente cubiertos, todos
 *   - error en query → devuelve []
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidLatLng,
  startOfDayMontevideoIso,
  selectMovilesNeedingDailyPosition,
  buildHistoryInsertRows,
  type MovilCandidate,
} from '../lib/import-helpers/gps-autocreate';

describe('isValidLatLng', () => {
  it('rechaza NaN', () => {
    expect(isValidLatLng(NaN, NaN)).toBe(false);
    expect(isValidLatLng(NaN, -56)).toBe(false);
    expect(isValidLatLng(-34, NaN)).toBe(false);
  });

  it('rechaza 0/0 (AS400 manda 0 como "sin valor")', () => {
    expect(isValidLatLng(0, 0)).toBe(false);
    expect(isValidLatLng(0, -56)).toBe(false);
    expect(isValidLatLng(-34, 0)).toBe(false);
  });

  it('rechaza strings no numéricos', () => {
    expect(isValidLatLng('abc', 'def')).toBe(false);
    expect(isValidLatLng('', '')).toBe(false);
  });

  it('rechaza undefined / null', () => {
    expect(isValidLatLng(undefined, undefined)).toBe(false);
    expect(isValidLatLng(null, null)).toBe(false);
  });

  it('rechaza fuera de rango', () => {
    expect(isValidLatLng(91, -56)).toBe(false);
    expect(isValidLatLng(-91, -56)).toBe(false);
    expect(isValidLatLng(-34, 181)).toBe(false);
    expect(isValidLatLng(-34, -181)).toBe(false);
  });

  it('acepta coords válidas (Uruguay)', () => {
    expect(isValidLatLng(-34.9011, -56.1645)).toBe(true);
  });

  it('acepta strings parseables como numéricos', () => {
    expect(isValidLatLng('-34.9', '-56.1')).toBe(true);
  });
});

describe('startOfDayMontevideoIso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a las 10:00 UTC del 2026-04-28 → ese día Montevideo (00:00 -03:00)', () => {
    vi.setSystemTime(new Date('2026-04-28T10:00:00Z'));
    expect(startOfDayMontevideoIso()).toBe('2026-04-28T00:00:00-03:00');
  });

  it('a las 02:00 UTC del 2026-04-28 (que en Montevideo es 23:00 del 27) → 2026-04-27', () => {
    vi.setSystemTime(new Date('2026-04-28T02:00:00Z'));
    expect(startOfDayMontevideoIso()).toBe('2026-04-27T00:00:00-03:00');
  });

  it('a las 04:00 UTC del 2026-04-28 (01:00 Montevideo) → 2026-04-28', () => {
    vi.setSystemTime(new Date('2026-04-28T04:00:00Z'));
    expect(startOfDayMontevideoIso()).toBe('2026-04-28T00:00:00-03:00');
  });

  it('respeta el parámetro now explícito (no depende de timers)', () => {
    expect(startOfDayMontevideoIso(new Date('2026-01-15T15:30:00Z'))).toBe(
      '2026-01-15T00:00:00-03:00'
    );
  });
});

// Helper: mock minimalista del SupabaseClient para las queries que usamos.
function makeMockClient(returnData: { movil_id: string; fecha_hora: string }[] | null, returnError: unknown = null) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  const client: any = {
    from: vi.fn().mockReturnValue(builder),
  };
  return { client, builder };
}

describe('selectMovilesNeedingDailyPosition', () => {
  const candidatos: MovilCandidate[] = [
    { movil_id: '101', escenario_id: 1000, lat: -34.9, lng: -56.1 },
    { movil_id: '102', escenario_id: 1000, lat: -34.8, lng: -56.2 },
    { movil_id: '103', escenario_id: 1000, lat: -34.7, lng: -56.3 },
  ];

  it('candidatos vacíos → [] sin tocar el client', async () => {
    const { client } = makeMockClient([]);
    const result = await selectMovilesNeedingDailyPosition(client, []);
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('ningún cubierto → devuelve los 3', async () => {
    const { client } = makeMockClient([]);
    const result = await selectMovilesNeedingDailyPosition(client, candidatos);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.movil_id)).toEqual(['101', '102', '103']);
  });

  it('1 cubierto → devuelve los 2 restantes', async () => {
    const { client } = makeMockClient([
      { movil_id: '102', fecha_hora: '2026-04-28T08:00:00-03:00' },
    ]);
    const result = await selectMovilesNeedingDailyPosition(client, candidatos);
    expect(result.map((c) => c.movil_id)).toEqual(['101', '103']);
  });

  it('todos cubiertos → []', async () => {
    const { client } = makeMockClient([
      { movil_id: '101', fecha_hora: '2026-04-28T08:00:00-03:00' },
      { movil_id: '102', fecha_hora: '2026-04-28T08:00:00-03:00' },
      { movil_id: '103', fecha_hora: '2026-04-28T08:00:00-03:00' },
    ]);
    const result = await selectMovilesNeedingDailyPosition(client, candidatos);
    expect(result).toEqual([]);
  });

  it('matching robusto: covered con movil_id numérico vs candidato string', async () => {
    const { client } = makeMockClient([
      { movil_id: 101 as unknown as string, fecha_hora: '2026-04-28T08:00:00-03:00' },
    ]);
    const result = await selectMovilesNeedingDailyPosition(client, candidatos);
    expect(result.map((c) => c.movil_id)).toEqual(['102', '103']);
  });

  it('error en query → [] (best-effort, no aborta)', async () => {
    const { client } = makeMockClient(null, { message: 'boom', code: 'X' });
    const result = await selectMovilesNeedingDailyPosition(client, candidatos);
    expect(result).toEqual([]);
  });
});

describe('buildHistoryInsertRows', () => {
  it('construye filas con campos mínimos requeridos', () => {
    const fixedNow = new Date('2026-04-28T15:30:00Z');
    const needing: MovilCandidate[] = [
      { movil_id: '101', escenario_id: 1000, lat: -34.9, lng: -56.1 },
      { movil_id: '102', escenario_id: 1000, lat: -34.8, lng: -56.2 },
    ];
    const rows = buildHistoryInsertRows(needing, () => fixedNow);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      movil_id: '101',
      escenario_id: 1000,
      latitud: -34.9,
      longitud: -56.1,
      fecha_hora: fixedNow.toISOString(),
    });
    expect(rows[1].movil_id).toBe('102');
  });

  it('input vacío → []', () => {
    expect(buildHistoryInsertRows([])).toEqual([]);
  });
});
