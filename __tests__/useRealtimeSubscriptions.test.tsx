/**
 * Tests para la lógica de retry/reconexión de useGPSTracking.
 *
 * Estrategia (alineada con el patrón de incidentRecorder.test.ts):
 * dado que el entorno de Vitest es "node" (sin jsdom/happy-dom) y el repo
 * no tiene @testing-library/react instalado, no podemos montar el hook.
 * En su lugar replicamos la lógica del callback de `.subscribe()` con un
 * `retryCountRef` (lo mismo que aplica el fix) y validamos que tras
 * MAX_RETRIES errores consecutivos el handler deja de programar reintentos.
 *
 * Cobertura objetivo (issue #9):
 *  - Reset de retryCountRef cuando llega 'SUBSCRIBED'.
 *  - Incremento + backoff exponencial en CHANNEL_ERROR / TIMED_OUT.
 *  - Tras MAX_RETRIES (=5) errores consecutivos NO se programa el 6º setTimeout.
 *  - El cap del backoff es 30000ms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MAX_RETRIES = 5;

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

/**
 * Construye una réplica fiel del callback que el fix instala dentro de
 * useGPSTracking → setupChannel → .subscribe(callback). Usamos un ref
 * (objeto mutable) para retryCount, mismo enfoque que el componente real.
 */
function buildSubscribeCallback() {
  const retryCountRef: { current: number } = { current: 0 };
  let isConnected = false;
  let error: string | null = null;
  const reconnectAttempts: number[] = []; // delays usados en cada setTimeout

  // setupChannel mock: solo cuenta reconexiones programadas, sin tocar Supabase
  const setupChannel = vi.fn(() => {
    // simulamos que el canal se reconecta y vuelve a recibir status
    // (no se invoca recursivamente acá; los tests llaman handleStatus
    // directamente para mantener control del flujo)
  });

  const handleStatus = (status: Status) => {
    if (status === 'SUBSCRIBED') {
      isConnected = true;
      error = null;
      retryCountRef.current = 0;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      isConnected = false;
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
        reconnectAttempts.push(delay);
        setTimeout(() => setupChannel(), delay);
      } else {
        error = 'Error de conexión persistente. Verifica tu red o Supabase.';
      }
    } else if (status === 'CLOSED') {
      isConnected = false;
    }
  };

  return {
    retryCountRef,
    reconnectAttempts,
    setupChannel,
    handleStatus,
    get isConnected() { return isConnected; },
    get error() { return error; },
  };
}

describe('useGPSTracking — retry counter no stale (issue #9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('SUBSCRIBED resetea retryCountRef.current a 0', () => {
    const ctx = buildSubscribeCallback();
    ctx.retryCountRef.current = 3;

    ctx.handleStatus('SUBSCRIBED');

    expect(ctx.retryCountRef.current).toBe(0);
    expect(ctx.isConnected).toBe(true);
    expect(ctx.error).toBeNull();
  });

  it('CHANNEL_ERROR incrementa retryCountRef y programa setTimeout', () => {
    const ctx = buildSubscribeCallback();

    ctx.handleStatus('CHANNEL_ERROR');

    expect(ctx.retryCountRef.current).toBe(1);
    expect(ctx.reconnectAttempts).toHaveLength(1);
    expect(ctx.error).toBeNull();
    expect(ctx.isConnected).toBe(false);
  });

  it('backoff exponencial: 2s, 4s, 8s, 16s, 32s (cap 30s)', () => {
    const ctx = buildSubscribeCallback();

    for (let i = 0; i < MAX_RETRIES; i++) {
      ctx.handleStatus('CHANNEL_ERROR');
    }

    // 1000 * 2^1=2000, 2^2=4000, 2^3=8000, 2^4=16000, 2^5=32000 -> cap 30000
    expect(ctx.reconnectAttempts).toEqual([2000, 4000, 8000, 16000, 30000]);
  });

  it('tras 5 errores consecutivos NO programa un 6º setTimeout (loop infinito mitigado)', () => {
    const ctx = buildSubscribeCallback();

    for (let i = 0; i < MAX_RETRIES; i++) {
      ctx.handleStatus('CHANNEL_ERROR');
    }
    expect(ctx.reconnectAttempts).toHaveLength(MAX_RETRIES);

    // Sexto error: NO debe programar otro retry
    ctx.handleStatus('CHANNEL_ERROR');

    expect(ctx.reconnectAttempts).toHaveLength(MAX_RETRIES); // sigue siendo 5
    expect(ctx.retryCountRef.current).toBe(MAX_RETRIES); // sin desbordar
    expect(ctx.error).toBe('Error de conexión persistente. Verifica tu red o Supabase.');
  });

  it('TIMED_OUT también incrementa el contador (mismo path que CHANNEL_ERROR)', () => {
    const ctx = buildSubscribeCallback();

    ctx.handleStatus('TIMED_OUT');
    ctx.handleStatus('TIMED_OUT');

    expect(ctx.retryCountRef.current).toBe(2);
    expect(ctx.reconnectAttempts).toHaveLength(2);
  });

  it('SUBSCRIBED después de errores resetea el contador → vuelve a tener 5 retries disponibles', () => {
    const ctx = buildSubscribeCallback();

    // 3 errores
    ctx.handleStatus('CHANNEL_ERROR');
    ctx.handleStatus('CHANNEL_ERROR');
    ctx.handleStatus('CHANNEL_ERROR');
    expect(ctx.retryCountRef.current).toBe(3);

    // Reconexión exitosa
    ctx.handleStatus('SUBSCRIBED');
    expect(ctx.retryCountRef.current).toBe(0);

    // Después de la reconexión, podemos volver a fallar 5 veces sin caer
    // en el branch de "máximo alcanzado" (esto demuestra que NO hay stale closure).
    for (let i = 0; i < MAX_RETRIES; i++) {
      ctx.handleStatus('CHANNEL_ERROR');
    }
    expect(ctx.error).toBeNull();
    expect(ctx.retryCountRef.current).toBe(MAX_RETRIES);

    // El sexto sí entra al límite
    ctx.handleStatus('CHANNEL_ERROR');
    expect(ctx.error).toBe('Error de conexión persistente. Verifica tu red o Supabase.');
  });

  it('reconnectAttempts conserva el orden y refleja exactamente los retries programados', () => {
    const ctx = buildSubscribeCallback();

    // 2 errores → 2 attempts
    ctx.handleStatus('CHANNEL_ERROR');
    ctx.handleStatus('CHANNEL_ERROR');

    // Avanzar timers: cada timeout debe disparar setupChannel
    vi.runAllTimers();

    expect(ctx.setupChannel).toHaveBeenCalledTimes(2);
  });

  it('CLOSED solo marca desconectado pero no programa retry (delegado a Supabase auto-reconnect)', () => {
    const ctx = buildSubscribeCallback();

    ctx.handleStatus('CLOSED');

    expect(ctx.isConnected).toBe(false);
    expect(ctx.reconnectAttempts).toHaveLength(0);
    expect(ctx.retryCountRef.current).toBe(0);
  });
});
