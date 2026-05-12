import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordRealtimeFailure,
  shouldShowManualBanner,
  triggerAutoReload,
  scheduleHealthyReset,
  dismissRealtimeReloadBanner,
} from './realtime-health';

describe('realtime-health auto-reload', () => {
  const mockReload = vi.fn();
  const mockSessionStorage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    mockReload.mockClear();
    mockSessionStorage.clear();

    vi.stubGlobal('window', {
      location: {
        pathname: '/dashboard',
        reload: mockReload,
      },
    });

    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockSessionStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockSessionStorage.set(key, value),
      removeItem: (key: string) => mockSessionStorage.delete(key),
      clear: () => mockSessionStorage.clear(),
      length: mockSessionStorage.size,
      key: (index: number) => Array.from(mockSessionStorage.keys())[index] ?? null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debería disparar auto-reload cuando shouldReload pasa a true y circuit breaker NO activo', () => {
    triggerAutoReload();
    expect(mockReload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledOnce();
  });

  it('circuit breaker: después de 3 disparos dentro de 10min, NO reload más', () => {
    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledTimes(3);

    expect(shouldShowManualBanner()).toBe(true);

    vi.advanceTimersByTime(1000);
    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledTimes(3);
  });

  it('guard de visibility: si visibilityState=hidden, NO reload inmediato', () => {
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: vi.fn((event, handler) => {
        if (event === 'visibilitychange') {
          setTimeout(() => {
            vi.stubGlobal('document', {
              visibilityState: 'visible',
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
            });
            handler();
          }, 1000);
        }
      }),
      removeEventListener: vi.fn(),
    });

    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledOnce();
  });

  it('guard de /login: si pathname=/login, NO reload', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/login',
        reload: mockReload,
      },
    });

    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('reset por inactividad: si no hay fallos en 30s, contador se resetea', () => {
    triggerAutoReload();
    vi.advanceTimersByTime(2000);
    expect(mockReload).toHaveBeenCalledOnce();

    const beforeReset = shouldShowManualBanner();
    expect(beforeReset).toBe(false);

    scheduleHealthyReset();
    vi.advanceTimersByTime(30_000);

    const counter = JSON.parse(
      mockSessionStorage.get('trackmovil:rt-auto-reload-count') ?? '{"count":0,"firstAt":0}'
    );
    expect(counter.count).toBe(0);
  });

  it('dismissRealtimeReloadBanner debería resetear flags', () => {
    triggerAutoReload();
    expect(mockReload).not.toHaveBeenCalled();

    dismissRealtimeReloadBanner();
    vi.advanceTimersByTime(2000);
    expect(mockReload).not.toHaveBeenCalled();
  });
});
