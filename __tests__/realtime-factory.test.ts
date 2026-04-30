/**
 * Tests para createRealtimeHook
 *
 * Estrategia: como vitest corre en environment 'node' sin DOM ni RTL, no
 * podemos montar el hook con renderHook. En su lugar mockeamos los hooks de
 * React (useState/useEffect/useRef/useMemo/useCallback) con implementaciones
 * mínimas que ejecutan effects sincrónicamente y exponen los setters para
 * que los tests puedan inspeccionar el estado.
 *
 * También mockeamos `@/lib/supabase` con stubs vi.fn() que permiten:
 *  - capturar nombre del canal y configuración (filter/event/table) pasada al .on()
 *  - disparar manualmente el callback de subscribe(status) para probar el flow
 *    SUBSCRIBED → CHANNEL_ERROR → reconnect → SUBSCRIBED
 *  - disparar payloads INSERT/UPDATE/DELETE para validar el Map interno
 *
 * Cobertura:
 *   1. canal con nombre único (timestamp + random)
 *   2. filter aplicado al postgres_changes config
 *   3. INSERT/UPDATE/DELETE en el Map (3 casos)
 *   4. status pasa por subscribing → SUBSCRIBED en flow feliz
 *   5. CHANNEL_ERROR con backoff exponencial; tras 5 retries deja de intentar
 *   6. SUBSCRIBED resetea retryCount
 *   7. cleanup llama removeChannel
 *   8. cambio de filter (effectKey) → cleanup + nuevo setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Supabase y audit-client — antes de importar la factory.
// ─────────────────────────────────────────────────────────────────────────────

type SubscribeCb = (status: string, err?: Error) => void;
type PgChangesCb = (payload: { new: unknown; old: unknown; eventType: string }) => void;

interface CapturedChannel {
  name: string;
  listeners: Array<{
    event: string;
    config: Record<string, unknown>;
    cb: PgChangesCb;
  }>;
  subscribeCb: SubscribeCb | null;
  removed: boolean;
}

const channels: CapturedChannel[] = [];
const removedChannels: CapturedChannel[] = [];

function makeChannelStub(name: string): CapturedChannel & {
  on: (event: string, config: Record<string, unknown>, cb: PgChangesCb) => unknown;
  subscribe: (cb: SubscribeCb) => CapturedChannel;
} {
  const ch: CapturedChannel = { name, listeners: [], subscribeCb: null, removed: false };
  const api = {
    ...ch,
    on(event: string, config: Record<string, unknown>, cb: PgChangesCb) {
      ch.listeners.push({ event, config, cb });
      return api;
    },
    subscribe(cb: SubscribeCb) {
      ch.subscribeCb = cb;
      return ch;
    },
  };
  // Mantener referencia compartida con el array global
  channels.push(ch);
  // Devolver objeto que enlaza listeners/subscribeCb por referencia al ch real
  return new Proxy(api, {
    get(target, prop) {
      if (prop === 'listeners') return ch.listeners;
      if (prop === 'subscribeCb') return ch.subscribeCb;
      if (prop === 'name') return ch.name;
      if (prop === 'removed') return ch.removed;
      return (target as Record<string | symbol, unknown>)[prop];
    },
  }) as CapturedChannel & {
    on: (event: string, config: Record<string, unknown>, cb: PgChangesCb) => unknown;
    subscribe: (cb: SubscribeCb) => CapturedChannel;
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn((name: string) => makeChannelStub(name)),
    removeChannel: vi.fn((ch: CapturedChannel) => {
      ch.removed = true;
      removedChannels.push(ch);
    }),
  },
}));

vi.mock('@/lib/audit-client', () => ({
  sendAuditBatch: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock de React: implementaciones mínimas que ejecutan effects sincrónicamente.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeHookContext {
  states: Array<{ value: unknown; setter: (v: unknown) => void }>;
  refs: Array<{ current: unknown }>;
  effects: Array<{ fn: () => (void | (() => void)); deps: unknown[]; cleanup: (() => void) | null; lastDeps: unknown[] | null }>;
  memos: Array<{ value: unknown; deps: unknown[] }>;
  cursor: { state: number; ref: number; effect: number; memo: number };
}

let activeCtx: FakeHookContext | null = null;

function resetCtx(ctx: FakeHookContext) {
  ctx.cursor = { state: 0, ref: 0, effect: 0, memo: 0 };
}

function newCtx(): FakeHookContext {
  return {
    states: [],
    refs: [],
    effects: [],
    memos: [],
    cursor: { state: 0, ref: 0, effect: 0, memo: 0 },
  };
}

vi.mock('react', () => ({
  useState<T>(init: T | (() => T)) {
    const ctx = activeCtx!;
    const i = ctx.cursor.state++;
    if (ctx.states[i] === undefined) {
      const initial = typeof init === 'function' ? (init as () => T)() : init;
      const slot = {
        value: initial as unknown,
        setter: (v: unknown) => {
          slot.value = typeof v === 'function' ? (v as (prev: unknown) => unknown)(slot.value) : v;
        },
      };
      ctx.states[i] = slot;
    }
    return [ctx.states[i].value as T, ctx.states[i].setter as (v: T | ((prev: T) => T)) => void];
  },
  useRef<T>(init: T) {
    const ctx = activeCtx!;
    const i = ctx.cursor.ref++;
    if (ctx.refs[i] === undefined) ctx.refs[i] = { current: init };
    return ctx.refs[i] as { current: T };
  },
  useEffect(fn: () => (void | (() => void)), deps: unknown[]) {
    const ctx = activeCtx!;
    const i = ctx.cursor.effect++;
    const prev = ctx.effects[i];
    const changed = !prev || !prev.lastDeps || prev.lastDeps.length !== deps.length ||
      prev.lastDeps.some((d, k) => d !== deps[k]);
    if (changed) {
      if (prev?.cleanup) prev.cleanup();
      const cleanup = fn();
      ctx.effects[i] = { fn, deps, cleanup: typeof cleanup === 'function' ? cleanup : null, lastDeps: deps };
    }
  },
  useMemo<T>(fn: () => T, deps: unknown[]) {
    const ctx = activeCtx!;
    const i = ctx.cursor.memo++;
    const prev = ctx.memos[i];
    const changed = !prev || prev.deps.length !== deps.length ||
      prev.deps.some((d, k) => d !== deps[k]);
    if (changed) {
      const value = fn();
      ctx.memos[i] = { value, deps };
      return value;
    }
    return prev.value as T;
  },
  useCallback<T extends (...args: unknown[]) => unknown>(fn: T) {
    return fn;
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Importar la factory después de mockear sus dependencias.
// ─────────────────────────────────────────────────────────────────────────────

import { createRealtimeHook } from '@/lib/hooks/createRealtimeHook';

// Helper: instanciar el hook simulando un componente React.
function runHook<R>(fn: () => R): { result: R; ctx: FakeHookContext; cleanup: () => void } {
  const ctx = newCtx();
  activeCtx = ctx;
  resetCtx(ctx);
  const result = fn();
  activeCtx = null;
  return {
    result,
    ctx,
    cleanup: () => {
      ctx.effects.forEach(e => { if (e.cleanup) e.cleanup(); });
    },
  };
}

// Helper: re-render el hook con dependencias nuevas (como React tras setState).
function reRender<R>(ctx: FakeHookContext, fn: () => R): R {
  activeCtx = ctx;
  resetCtx(ctx);
  const result = fn();
  activeCtx = null;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

type TestRow = {
  id: number;
  name: string;
} & Record<string, unknown>;

beforeEach(() => {
  channels.length = 0;
  removedChannels.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeFactory() {
  return createRealtimeHook<TestRow, { scope: number }, 'id'>({
    table: 'test_table',
    channelPrefix: 'test',
    idKey: 'id',
    events: ['INSERT', 'UPDATE', 'DELETE'],
    filter: ({ scope }) => `scope=eq.${scope}`,
    effectKey: ({ scope }) => `test:${scope}`,
  });
}

describe('createRealtimeHook — flow básico', () => {
  it('crea canal con nombre único (prefix + timestamp + random)', () => {
    const useTest = makeFactory();
    runHook(() => useTest({ scope: 1 }));
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toMatch(/^test-\d+-[a-z0-9]+$/);
  });

  it('aplica filter, schema y table al postgres_changes config', () => {
    const useTest = makeFactory();
    runHook(() => useTest({ scope: 42 }));
    const ch = channels[0];
    // 3 listeners (INSERT/UPDATE/DELETE)
    expect(ch.listeners).toHaveLength(3);
    for (const l of ch.listeners) {
      expect(l.event).toBe('postgres_changes');
      expect(l.config.schema).toBe('public');
      expect(l.config.table).toBe('test_table');
      expect(l.config.filter).toBe('scope=eq.42');
    }
    expect(ch.listeners.map(l => l.config.event)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
  });

  it('omite filter si la config retorna undefined', () => {
    const useTest = createRealtimeHook<TestRow, Record<string, never>, 'id'>({
      table: 't',
      channelPrefix: 'p',
      idKey: 'id',
      events: ['INSERT'],
      filter: () => undefined,
    });
    runHook(() => useTest({}));
    expect(channels[0].listeners[0].config.filter).toBeUndefined();
  });
});

describe('createRealtimeHook — payloads INSERT/UPDATE/DELETE', () => {
  it('INSERT agrega al Map por idKey', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));
    const insertCb = channels[0].listeners.find(l => l.config.event === 'INSERT')!.cb;

    insertCb({ new: { id: 10, name: 'a' }, old: {}, eventType: 'INSERT' });

    const r = reRender(h.ctx, () => makeFactory()({ scope: 1 }));
    // El render no recreará el hook — el state lo tomamos del ctx directo
    void r;
    expect(h.ctx.states[0].value).toBeInstanceOf(Map);
    const map = h.ctx.states[0].value as Map<number, TestRow>;
    expect(map.get(10)).toEqual({ id: 10, name: 'a' });
  });

  it('UPDATE reemplaza el row con mismo id', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));
    const insertCb = channels[0].listeners.find(l => l.config.event === 'INSERT')!.cb;
    const updateCb = channels[0].listeners.find(l => l.config.event === 'UPDATE')!.cb;

    insertCb({ new: { id: 10, name: 'a' }, old: {}, eventType: 'INSERT' });
    updateCb({ new: { id: 10, name: 'b' }, old: { id: 10, name: 'a' }, eventType: 'UPDATE' });

    const map = h.ctx.states[0].value as Map<number, TestRow>;
    expect(map.get(10)).toEqual({ id: 10, name: 'b' });
    expect(map.size).toBe(1);
  });

  it('DELETE remueve el row del Map (usa payload.old)', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));
    const insertCb = channels[0].listeners.find(l => l.config.event === 'INSERT')!.cb;
    const deleteCb = channels[0].listeners.find(l => l.config.event === 'DELETE')!.cb;

    insertCb({ new: { id: 10, name: 'a' }, old: {}, eventType: 'INSERT' });
    deleteCb({ new: null, old: { id: 10, name: 'a' }, eventType: 'DELETE' });

    const map = h.ctx.states[0].value as Map<number, TestRow>;
    expect(map.has(10)).toBe(false);
  });

  it('aplica shouldAccept para filtrar payloads cliente-side', () => {
    const useTest = createRealtimeHook<TestRow, { scope: number; allowed: number[] }, 'id'>({
      table: 't',
      channelPrefix: 'p',
      idKey: 'id',
      events: ['INSERT'],
      filter: ({ scope }) => `scope=eq.${scope}`,
      effectKey: ({ scope, allowed }) => `${scope}:${allowed.join(',')}`,
      shouldAccept: (row, deps) => deps.allowed.includes(row.id),
    });
    const h = runHook(() => useTest({ scope: 1, allowed: [10] }));
    const insertCb = channels[0].listeners[0].cb;

    insertCb({ new: { id: 10, name: 'a' }, old: {}, eventType: 'INSERT' });
    insertCb({ new: { id: 99, name: 'b' }, old: {}, eventType: 'INSERT' });

    const map = h.ctx.states[0].value as Map<number, TestRow>;
    expect(map.has(10)).toBe(true);
    expect(map.has(99)).toBe(false);
  });
});

describe('createRealtimeHook — onUpdate callback', () => {
  it('invoca onUpdate con (row, eventType) en cada cambio', () => {
    const useTest = makeFactory();
    const onUpdate = vi.fn();
    runHook(() => useTest({ scope: 1 }, { onUpdate }));
    const ch = channels[0];

    ch.listeners.find(l => l.config.event === 'INSERT')!.cb({ new: { id: 1, name: 'x' }, old: {}, eventType: 'INSERT' });
    ch.listeners.find(l => l.config.event === 'UPDATE')!.cb({ new: { id: 1, name: 'y' }, old: {}, eventType: 'UPDATE' });
    ch.listeners.find(l => l.config.event === 'DELETE')!.cb({ new: null, old: { id: 1, name: 'y' }, eventType: 'DELETE' });

    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenNthCalledWith(1, { id: 1, name: 'x' }, 'INSERT');
    expect(onUpdate).toHaveBeenNthCalledWith(2, { id: 1, name: 'y' }, 'UPDATE');
    expect(onUpdate).toHaveBeenNthCalledWith(3, { id: 1, name: 'y' }, 'DELETE');
  });
});

describe('createRealtimeHook — status / reconexión', () => {
  it('SUBSCRIBED setea isConnected=true y resetea retryCount', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));
    const ch = channels[0];

    // simular CHANNEL_ERROR primero para incrementar retryCount
    ch.subscribeCb!('CHANNEL_ERROR', new Error('boom'));
    // retryCount está en refs (índice 0). Verificar que se incrementó
    const retryRef = h.ctx.refs[0] as { current: number };
    expect(retryRef.current).toBe(1);

    // Ahora SUBSCRIBED en el mismo canal → debe resetear el contador
    ch.subscribeCb!('SUBSCRIBED');
    expect(retryRef.current).toBe(0);

    // isConnected es el segundo state (después de byId)
    const isConnected = h.ctx.states[1].value;
    expect(isConnected).toBe(true);
  });

  it('CHANNEL_ERROR programa setTimeout con backoff exponencial', () => {
    const useTest = makeFactory();
    runHook(() => useTest({ scope: 1 }));
    const ch = channels[0];

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    ch.subscribeCb!('CHANNEL_ERROR');
    // primer retry: 2^1 * 1000 = 2000ms
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2000);

    // disparar el timer crea un canal nuevo y vuelve a fallar
    vi.runOnlyPendingTimers();
    const ch2 = channels[1];
    ch2.subscribeCb!('CHANNEL_ERROR');
    // segundo retry: 2^2 * 1000 = 4000ms
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 4000);

    vi.runOnlyPendingTimers();
    const ch3 = channels[2];
    ch3.subscribeCb!('CHANNEL_ERROR');
    // tercer retry: 2^3 * 1000 = 8000ms
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 8000);
  });

  it('tras MAX_RETRIES (5) deja de programar nuevos timers', () => {
    const useTest = makeFactory();
    runHook(() => useTest({ scope: 1 }));

    // Disparar 5 errores con timers consecutivos
    for (let i = 0; i < 5; i++) {
      const ch = channels[i];
      ch.subscribeCb!('CHANNEL_ERROR');
      vi.runOnlyPendingTimers();
    }

    // El sexto error no debe programar más timer
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setTimeoutSpy.mockClear();
    const ch6 = channels[5];
    ch6.subscribeCb!('CHANNEL_ERROR');
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('TIMED_OUT es tratado como CHANNEL_ERROR (programa retry)', () => {
    const useTest = makeFactory();
    runHook(() => useTest({ scope: 1 }));

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    channels[0].subscribeCb!('TIMED_OUT');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2000);
  });

  it('CLOSED solo programa reconexión si reconnectOnClosed=true', () => {
    const useTest = makeFactory(); // sin reconnectOnClosed
    runHook(() => useTest({ scope: 1 }));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setTimeoutSpy.mockClear();
    channels[0].subscribeCb!('CLOSED');
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('CLOSED reconecta cuando reconnectOnClosed=true', () => {
    const useTest = createRealtimeHook<TestRow, { scope: number }, 'id'>({
      table: 't', channelPrefix: 'p', idKey: 'id', events: ['INSERT'],
      filter: ({ scope }) => `scope=eq.${scope}`,
      effectKey: ({ scope }) => `${scope}`,
      reconnectOnClosed: true,
    });
    runHook(() => useTest({ scope: 1 }));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setTimeoutSpy.mockClear();
    channels[0].subscribeCb!('CLOSED');
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
  });
});

describe('createRealtimeHook — onReconnect', () => {
  it('NO se invoca en la primera SUBSCRIBED', () => {
    const useTest = makeFactory();
    const onReconnect = vi.fn();
    runHook(() => useTest({ scope: 1 }, { onReconnect }));
    channels[0].subscribeCb!('SUBSCRIBED');
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('se invoca en SUBSCRIBED tras una reconexión', () => {
    const useTest = makeFactory();
    const onReconnect = vi.fn();
    runHook(() => useTest({ scope: 1 }, { onReconnect }));
    channels[0].subscribeCb!('SUBSCRIBED');
    channels[0].subscribeCb!('CHANNEL_ERROR');
    vi.runOnlyPendingTimers();
    channels[1].subscribeCb!('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('createRealtimeHook — cleanup', () => {
  it('cleanup llama removeChannel y limpia timer', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));

    // simular CHANNEL_ERROR para tener un timer pendiente
    channels[0].subscribeCb!('CHANNEL_ERROR');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    h.cleanup();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removedChannels).toContain(channels[0]);
  });

  it('después de cleanup, los payloads no mutan el state', () => {
    const useTest = makeFactory();
    const h = runHook(() => useTest({ scope: 1 }));
    const insertCb = channels[0].listeners.find(l => l.config.event === 'INSERT')!.cb;

    h.cleanup();
    insertCb({ new: { id: 99, name: 'late' }, old: {}, eventType: 'INSERT' });

    const map = h.ctx.states[0].value as Map<number, TestRow>;
    expect(map.size).toBe(0);
  });
});

describe('createRealtimeHook — effectKey change', () => {
  it('cambio de filter (effectKey) → cleanup + nuevo setup', () => {
    const useTest = makeFactory();
    const ctx = newCtx();
    activeCtx = ctx;
    resetCtx(ctx);
    useTest({ scope: 1 });
    activeCtx = null;
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toContain('test-');

    // Re-render con scope distinto → effectKey cambia → cleanup + setup nuevo
    activeCtx = ctx;
    resetCtx(ctx);
    useTest({ scope: 2 });
    activeCtx = null;

    expect(channels).toHaveLength(2);
    expect(removedChannels).toContain(channels[0]);
    expect(channels[1].listeners[0].config.filter).toBe('scope=eq.2');
  });

  it('mismo effectKey en re-render → no recrea canal', () => {
    const useTest = makeFactory();
    const ctx = newCtx();
    activeCtx = ctx;
    resetCtx(ctx);
    useTest({ scope: 1 });
    activeCtx = null;
    expect(channels).toHaveLength(1);

    activeCtx = ctx;
    resetCtx(ctx);
    useTest({ scope: 1 });
    activeCtx = null;
    expect(channels).toHaveLength(1);
  });
});
