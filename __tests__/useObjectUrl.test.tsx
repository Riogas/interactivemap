/**
 * Tests para useObjectUrl (issue #11).
 *
 * Estrategia (alineada con el patron de incidentRecorder.test.ts):
 * el entorno de Vitest es "node" sin jsdom y el repo no tiene
 * @testing-library/react instalado. Replicamos la maquinaria minima
 * de React (useState/useEffect simulados) suficiente para ejecutar
 * el hook tal cual, y verificamos que createObjectURL/revokeObjectURL
 * se llaman en los momentos correctos.
 *
 * Cobertura:
 *  - Mount + unmount con un blob → revokeObjectURL llamado 1 vez.
 *  - Cambiar el blob 3 veces → createObjectURL llamado 4 veces (initial + 3),
 *    revokeObjectURL llamado 3 veces antes de unmount.
 *  - Pasar null → url es null, sin createObjectURL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mini simulador de React hooks (suficiente para testear useObjectUrl)
// ─────────────────────────────────────────────────────────────────────────────
// Replicamos la API minima de useState/useEffect que usa el hook bajo test.
// La logica exacta del hook (que no se modifica) se importa como source of
// truth desde el archivo real para evitar drift.

type Cleanup = (() => void) | void;

interface Slot {
  state?: { value: unknown };
  effect?: { deps: ReadonlyArray<unknown>; cleanup: Cleanup };
}

class HookHarness<T = unknown> {
  private slots: Slot[] = [];
  private slotIndex = 0;
  private pendingEffects: Array<{ slotIdx: number; fn: () => Cleanup; deps: ReadonlyArray<unknown> }> = [];
  private renderFn!: () => T;
  private inEffect = false;
  unmounted = false;
  lastResult: T | undefined;

  setRender(fn: () => T) {
    this.renderFn = fn;
  }

  render(): T {
    if (this.unmounted) throw new Error('rendered after unmount');
    // Loop hasta estabilidad: render → ejecutar effects → si setState dentro
    // del effect, re-render. Limite de 50 iteraciones para detectar loops.
    let iterations = 0;
    while (true) {
      if (++iterations > 50) throw new Error('useObjectUrl harness: render loop excedido');
      this.slotIndex = 0;
      this.pendingEffects = [];
      this.lastResult = this.renderFn();

      // Ejecutar effects cuyos deps cambiaron. Marcamos `inEffect` para que
      // un setState dentro del effect NO dispare un render anidado.
      let stateChanged = false;
      this.inEffect = true;
      try {
        for (const eff of this.pendingEffects) {
          const slot = this.slots[eff.slotIdx];
          const prev = slot.effect;
          const depsChanged =
            !prev ||
            prev.deps.length !== eff.deps.length ||
            prev.deps.some((d, i) => !Object.is(d, eff.deps[i]));
          if (depsChanged) {
            if (prev?.cleanup) prev.cleanup();
            const cleanup = eff.fn();
            slot.effect = { deps: eff.deps, cleanup };
          }
        }
        // Drenar setState pendientes acumulados durante los effects
        if (this.pendingSetState) {
          this.pendingSetState = false;
          stateChanged = true;
        }
      } finally {
        this.inEffect = false;
      }

      if (!stateChanged) return this.lastResult!;
      // Si hubo setState durante el effect, re-render (pero sin disparar
      // los mismos effects: ya se almacenaron sus deps actuales).
    }
  }

  private pendingSetState = false;

  unmount() {
    if (this.unmounted) return;
    for (const slot of this.slots) {
      if (slot.effect?.cleanup) slot.effect.cleanup();
    }
    this.unmounted = true;
  }

  useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void] {
    const idx = this.slotIndex++;
    if (!this.slots[idx]) {
      this.slots[idx] = { state: { value: initial } };
    }
    const slot = this.slots[idx];
    const value = slot.state!.value as S;
    const setter = (next: S | ((prev: S) => S)) => {
      const newVal =
        typeof next === 'function'
          ? (next as (prev: S) => S)(slot.state!.value as S)
          : next;
      if (!Object.is(newVal, slot.state!.value)) {
        slot.state!.value = newVal;
        if (this.inEffect) {
          // Aplazar el re-render hasta que termine la fase de effects
          this.pendingSetState = true;
        } else if (!this.unmounted) {
          this.render();
        }
      }
    };
    return [value, setter];
  }

  useEffect(fn: () => Cleanup, deps: ReadonlyArray<unknown>) {
    const idx = this.slotIndex++;
    if (!this.slots[idx]) this.slots[idx] = {};
    this.pendingEffects.push({ slotIdx: idx, fn, deps });
  }
}

// Stubeamos `react` con la harness antes de importar el hook real.
// Cada test crea una harness fresca y la inyecta via __setHarness.
let activeHarness: HookHarness | null = null;

vi.mock('react', () => ({
  useState: <S,>(initial: S) => activeHarness!.useState(initial),
  useEffect: (fn: () => Cleanup, deps: ReadonlyArray<unknown>) => activeHarness!.useEffect(fn, deps),
}));

// Importacion dinamica para que el mock de react aplique al hook real
async function loadHook() {
  const mod = await import('@/lib/hooks/useObjectUrl');
  return mod.useObjectUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de URL.createObjectURL / revokeObjectURL
// ─────────────────────────────────────────────────────────────────────────────

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;
let urlCounter = 0;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
  urlCounter = 0;
  createSpy = vi.fn(() => `blob:mock-${++urlCounter}`);
  revokeSpy = vi.fn();
  // Preservamos el constructor URL de Node (lo necesita Blob internamente);
  // solo sobreescribimos los metodos.
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  (URL as unknown as { createObjectURL: typeof createSpy }).createObjectURL = createSpy;
  (URL as unknown as { revokeObjectURL: typeof revokeSpy }).revokeObjectURL = revokeSpy;
});

afterEach(() => {
  if (originalCreate) URL.createObjectURL = originalCreate;
  if (originalRevoke) URL.revokeObjectURL = originalRevoke;
  activeHarness = null;
});

function makeBlob(size = 100, type = 'video/webm'): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('useObjectUrl — leak prevention (issue #11)', () => {
  it('mount con un blob → createObjectURL una vez, devuelve la URL', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    const blob: Blob | null = makeBlob();
    harness.setRender(() => useObjectUrl(blob));
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(harness.lastResult).toBe('blob:mock-1');
  });

  it('mount + unmount → revokeObjectURL llamado 1 vez', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    const blob = makeBlob();
    harness.setRender(() => useObjectUrl(blob));
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(0);

    harness.unmount();

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-1');
  });

  it('cambiar el blob 3 veces → createObjectURL 4 veces (initial + 3 cambios), revokeObjectURL 3 veces antes del unmount', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    let blob: Blob | null = makeBlob(100);
    harness.setRender(() => useObjectUrl(blob));
    harness.render(); // initial → create #1

    blob = makeBlob(200);
    harness.render(); // change 1 → revoke #1, create #2

    blob = makeBlob(300);
    harness.render(); // change 2 → revoke #2, create #3

    blob = makeBlob(400);
    harness.render(); // change 3 → revoke #3, create #4

    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(revokeSpy).toHaveBeenCalledTimes(3);

    // Unmount: revoke del ultimo URL (#4)
    harness.unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(4);
  });

  it('pasar null → url es null y NO se llama createObjectURL', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    const blob: Blob | null = null;
    harness.setRender(() => useObjectUrl(blob));
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(0);
    expect(harness.lastResult).toBeNull();
  });

  it('pasar undefined → url es null y NO se llama createObjectURL', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    const blob: Blob | undefined = undefined;
    harness.setRender(() => useObjectUrl(blob));
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(0);
    expect(harness.lastResult).toBeNull();
  });

  it('blob → null → revoca el URL anterior y deja result en null', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    let blob: Blob | null = makeBlob();
    harness.setRender(() => useObjectUrl(blob));
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(1);

    blob = null;
    harness.render();

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(harness.lastResult).toBeNull();
  });

  it('mismo blob (referencia identica) en re-render NO crea un nuevo URL', async () => {
    const useObjectUrl = await loadHook();
    const harness = new HookHarness<string | null>();
    activeHarness = harness;

    const blob = makeBlob();
    harness.setRender(() => useObjectUrl(blob));
    harness.render(); // create #1
    harness.render(); // mismo blob → useEffect no re-corre
    harness.render();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(0);
  });
});
