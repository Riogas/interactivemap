/**
 * Tests para GPSBatchQueue (issue #10).
 *
 * Cubre:
 *  1. Atomicidad del flush con flushPromise mutex: 100 addBatch concurrentes
 *     terminan con TODOS los records insertados (sum de IDs == suma esperada).
 *  2. En caso de error de insert, los records vuelven a la cola y un segundo
 *     flush los procesa (no se pierden).
 *  3. Dos flush concurrentes reusan la misma promesa (mutex).
 *
 * El cliente de @supabase/supabase-js se mockea para no tocar la red.
 * setInterval se neutraliza para que el flushTimer interno (5s) no dispare
 * durante el test y enmascare unhandled rejections.
 * Promise<setTimeout> de los retries del flush se acelera con un mock que
 * resuelve inmediatamente, asi los tests no esperan 2s+4s reales.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock de gpsLog para silenciar el output ruidoso
vi.mock('@/lib/debug-config', () => ({
  gpsLog: vi.fn(),
}));

// Variables compartidas con el mock de @supabase/supabase-js
const insertCalls: Array<Array<Record<string, unknown>>> = [];
let insertImpl: () => Promise<{ data: unknown; error: { message: string } | null }> = async () => ({
  data: null,
  error: null,
});

vi.mock('@supabase/supabase-js', () => {
  const fromBuilder = () => ({
    insert: vi.fn(async (records: Array<Record<string, unknown>>) => {
      insertCalls.push(records);
      return insertImpl();
    }),
    select: () => ({
      in: async () => ({ data: [], error: null }),
      eq: () => ({ single: async () => ({ data: null, error: null }) }),
    }),
  });

  return {
    createClient: vi.fn(() => ({
      from: vi.fn(fromBuilder),
    })),
  };
});

let originalSetInterval: typeof setInterval;
let originalSetTimeout: typeof setTimeout;

async function loadModule() {
  vi.resetModules();
  insertCalls.length = 0;
  insertImpl = async () => ({ data: null, error: null });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

  const mod = await import('@/lib/gps-batch-queue');
  return mod;
}

describe('GPSBatchQueue — atomicidad y resiliencia (issue #10)', () => {
  beforeEach(() => {
    // Neutralizamos el flushTimer interno (setInterval cada 5s) para que
    // no dispare flushes adicionales que generen unhandled rejections.
    originalSetInterval = global.setInterval;
    global.setInterval = (() => 0) as unknown as typeof setInterval;

    // Aceleramos los setTimeout(2s, 4s) usados como exponential backoff
    // entre retries del flush. Los demas usos siguen funcionando si los hay.
    originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: () => void) => {
      Promise.resolve().then(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;
    vi.restoreAllMocks();
  });

  function makeRecord(id: number) {
    return {
      movil_id: `mock-${id}`,
      pedido_id: null,
      escenario_id: null,
      device_id: null,
      usuario: null,
      latitud: -34.9,
      longitud: -56.1,
      utm_x: null,
      utm_y: null,
      accuracy: null,
      altitude: null,
      bearing: null,
      provider: null,
      speed_accuracy: null,
      speed: null,
      vertical_accuracy: null,
      battery_level: null,
      is_charging: null,
      timestamp: new Date().toISOString(),
      timestamp_utc: new Date().toISOString(),
      seq: id,
    };
  }

  it('100 addBatch concurrentes + flush final → todos los records llegan al insert (sin perdidas)', async () => {
    const { getGPSQueue } = await loadModule();
    const queue = getGPSQueue();

    // 100 batches con 1 record cada uno, IDs 0..99 (suma = 4950)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(queue.addBatch([makeRecord(i)]));
    }
    await Promise.all(promises);

    await queue.forceFlush();

    // Sumar los IDs (`seq`) de todos los registros que llegaron al insert mock
    const allInserted = insertCalls.flat() as Array<{ seq: number }>;
    const sum = allInserted.reduce((acc, r) => acc + r.seq, 0);
    const expected = (100 * 99) / 2; // 4950

    expect(allInserted.length).toBe(100);
    expect(sum).toBe(expected);
  });

  it('si el primer flush falla, los records vuelven a la cola y un segundo flush los procesa', async () => {
    const { getGPSQueue } = await loadModule();
    const queue = getGPSQueue();

    // Primer intento: insert siempre falla. Tras MAX_RETRIES (3) _doFlush
    // re-encola los records al frente y propaga el error.
    insertImpl = async () => ({ data: null, error: { message: 'simulated network failure' } });

    await queue.addBatch([makeRecord(1), makeRecord(2), makeRecord(3), makeRecord(4), makeRecord(5)]);

    await expect(queue.forceFlush()).rejects.toThrow();

    // Se intento MAX_RETRIES (3) veces
    expect(insertCalls.length).toBe(3);

    // Reset y deja al insert pasar
    insertCalls.length = 0;
    insertImpl = async () => ({ data: null, error: null });

    await queue.forceFlush();

    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0]).toHaveLength(5);
    const seqs = (insertCalls[0] as Array<{ seq: number }>).map(r => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('flush concurrente reusa la misma promesa (mutex flushPromise)', async () => {
    const { getGPSQueue } = await loadModule();
    const queue = getGPSQueue();

    // Insert lento (resolvemos manualmente) para asegurar que dos flush() se solapen
    let resolveInsert: (v: { data: unknown; error: null }) => void = () => {};
    insertImpl = () =>
      new Promise<{ data: unknown; error: null }>((resolve) => {
        resolveInsert = resolve;
      });

    await queue.addBatch([makeRecord(1), makeRecord(2)]);

    const f1 = queue.forceFlush();
    const f2 = queue.forceFlush();

    // Esperamos un tick para que los flushes arranquen y disparen el insert
    await Promise.resolve();
    await Promise.resolve();

    // Solo un insert deberia haberse llamado (mismo flushPromise)
    expect(insertCalls.length).toBe(1);

    resolveInsert({ data: null, error: null });
    await Promise.all([f1, f2]);

    expect(insertCalls.length).toBe(1);
  });
});
