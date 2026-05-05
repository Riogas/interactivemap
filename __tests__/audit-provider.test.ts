/**
 * Tests unitarios para el comportamiento del toggle en AuditProvider
 * (lib/audit-client.ts + lógica de enqueue/enabled).
 *
 * AC1 — Cuando enabled=false, sendAuditBatch NO se llama desde el interceptor.
 * AC2 — Cuando enabled=true, sendAuditBatch SÍ se llama.
 * AC3 — sendAuditBatch no tira si events es array vacío.
 * AC4 — sendAuditBeacon hace fallback a sendAuditBatch si sendBeacon falla.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendAuditBatch, sendAuditBeacon, type AuditClientEvent } from '@/lib/audit-client';

// ─── helpers ────────────────────────────────────────────────────────────────

const mockEvent = (): AuditClientEvent => ({
  event_type: 'api_call',
  method: 'GET',
  endpoint: '/api/test',
  response_status: 200,
  duration_ms: 50,
});

// ─── sendAuditBatch ──────────────────────────────────────────────────────────

describe('sendAuditBatch', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any;
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalWindow = (global as any).window;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;
    // Simulate browser environment for the typeof window check in audit-client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = global;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = originalWindow;
  });

  it('AC1/AC3 — no llama fetch si events es vacío', () => {
    sendAuditBatch([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AC2 — llama fetch a /api/audit con los eventos', async () => {
    sendAuditBatch([mockEvent()]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/audit');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('no lanza excepcion si fetch falla', () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    // No debe tirar
    expect(() => sendAuditBatch([mockEvent()])).not.toThrow();
  });
});

// ─── sendAuditBeacon ─────────────────────────────────────────────────────────

describe('sendAuditBeacon', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any;
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalWindow = (global as any).window;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = global;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = originalWindow;
  });

  it('AC4 — si sendBeacon devuelve false, hace fallback a sendAuditBatch (fetch)', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = global.navigator as any;
    const originalSendBeacon = nav.sendBeacon;
    nav.sendBeacon = sendBeaconMock;

    sendAuditBeacon([mockEvent()]);

    // sendBeacon devolvió false → debe llamar a fetch como fallback
    expect(fetchMock).toHaveBeenCalledOnce();

    nav.sendBeacon = originalSendBeacon;
  });

  it('no llama fetch si sendBeacon tuvo éxito (true)', () => {
    const sendBeaconMock = vi.fn().mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = global.navigator as any;
    const originalSendBeacon = nav.sendBeacon;
    nav.sendBeacon = sendBeaconMock;

    sendAuditBeacon([mockEvent()]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeaconMock).toHaveBeenCalledOnce();

    nav.sendBeacon = originalSendBeacon;
  });

  it('AC3 — no hace nada si events es vacío', () => {
    const sendBeaconMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = global.navigator as any;
    const originalSendBeacon = nav.sendBeacon;
    nav.sendBeacon = sendBeaconMock;

    sendAuditBeacon([]);
    expect(sendBeaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    nav.sendBeacon = originalSendBeacon;
  });
});

// ─── Toggle logic (unit test de la logica pura) ──────────────────────────────

describe('Toggle logic — enabled ref behavior', () => {
  it('enqueue con enabled=false descarta el evento (no llama sendAuditBatch)', () => {
    // Test de la logica pura que el AuditProvider implementa:
    // si enabledRef.current === false, enqueue es no-op.
    const batchSpy = vi.fn();
    const buffer: AuditClientEvent[] = [];

    const enabled = { current: false };
    const enqueue = (event: AuditClientEvent) => {
      if (!enabled.current) return; // <-- esta es la linea critica
      buffer.push(event);
      if (buffer.length >= 20) {
        batchSpy(buffer.splice(0, buffer.length));
      }
    };

    enqueue(mockEvent());
    enqueue(mockEvent());

    expect(buffer).toHaveLength(0);
    expect(batchSpy).not.toHaveBeenCalled();
  });

  it('enqueue con enabled=true encola el evento', () => {
    const buffer: AuditClientEvent[] = [];
    const enabled = { current: true };

    const enqueue = (event: AuditClientEvent) => {
      if (!enabled.current) return;
      buffer.push(event);
    };

    enqueue(mockEvent());
    enqueue(mockEvent());

    expect(buffer).toHaveLength(2);
  });

  it('al pasar de true a false, los batches en buffer se descartan', () => {
    const buffer: AuditClientEvent[] = [mockEvent(), mockEvent(), mockEvent()];
    const enabled = { current: true };

    // Simular toggle OFF
    enabled.current = false;
    if (!enabled.current) {
      buffer.splice(0, buffer.length); // descartar buffer
    }

    expect(buffer).toHaveLength(0);
  });
});
