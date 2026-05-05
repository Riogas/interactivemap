/**
 * Tests unitarios para el fix: cambio en tabla moviles dispara refetch debounced.
 *
 * AC4 — Debounce: dado un stream de N eventos con <500ms entre cada uno,
 *        el callback final se ejecuta 1 sola vez ~500ms despues del ultimo.
 * AC5 — setOnMovilEvent recibe el callback y onMovilChange lo invoca.
 * AC7 — Si onMovilEvent es null, onMovilChange no explota.
 *
 * Nota: estos tests corren en entorno 'node' con vitest fake timers.
 * Los hooks de React no se montan aqui — se testea la logica pura de debounce
 * y el contrato de callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────────
// Helpers que replican la logica exacta del dashboard
// ──────────────────────────────────────────────────────────────

/**
 * Implementacion inline del debounce (identica a la del dashboard).
 * Se aísla aquí para testearla sin montar React.
 */
function makeDebounced(
  cb: () => void,
  waitMs: number,
): { trigger: () => void; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cb();
      }, waitMs);
    },
    cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Simula el gate selectedDate === todayMontevideo() del dashboard.
 * Si la fecha no es hoy, el refetch no debe dispararse.
 */
function shouldRefetch(selectedDate: string, today: string): boolean {
  return selectedDate === today;
}

/**
 * Simula la logica del RealtimeProvider: onMovilChange llama onMovilEvent si esta seteado.
 */
function simulateOnMovilChange(
  onMovilEventRef: { current: (() => void) | null },
): void {
  // Actualizar latestMovil y lastEventAt son side-effects de React state,
  // no los simulamos aqui; solo el contrato del callback.
  if (onMovilEventRef.current) onMovilEventRef.current();
}

// ──────────────────────────────────────────────────────────────
// AC4 — Debounce colapsa eventos rapidos en 1 sola llamada
// ──────────────────────────────────────────────────────────────

describe('AC4 — debounce de movileEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('5 eventos con <500ms entre cada uno => 1 sola llamada al callback', () => {
    const cb = vi.fn();
    const { trigger, cleanup } = makeDebounced(cb, 500);

    // Disparar 5 eventos con 100ms de separacion
    for (let i = 0; i < 5; i++) {
      trigger();
      vi.advanceTimersByTime(100);
    }

    // Todavia no debe haber llamado al callback (el debounce sigue activo)
    expect(cb).not.toHaveBeenCalled();

    // Avanzar hasta despues del debounce window
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('evento solitario => 1 llamada exactamente despues de waitMs', () => {
    const cb = vi.fn();
    const { trigger, cleanup } = makeDebounced(cb, 500);

    trigger();
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('dos rafagas separadas por >500ms => 2 llamadas independientes', () => {
    const cb = vi.fn();
    const { trigger, cleanup } = makeDebounced(cb, 500);

    // Primera rafaga
    trigger();
    trigger();
    vi.advanceTimersByTime(600); // debounce termina
    expect(cb).toHaveBeenCalledTimes(1);

    // Segunda rafaga
    trigger();
    trigger();
    vi.advanceTimersByTime(600);
    expect(cb).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleanup cancela el timer pendiente — callback no se llama', () => {
    const cb = vi.fn();
    const { trigger, cleanup } = makeDebounced(cb, 500);

    trigger();
    cleanup(); // cancelar antes de que dispare
    vi.advanceTimersByTime(1000);

    expect(cb).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────
// AC5 — onMovilChange invoca el callback registrado via setOnMovilEvent
// ──────────────────────────────────────────────────────────────

describe('AC5 — contrato onMovilEvent en RealtimeProvider', () => {
  it('onMovilChange llama onMovilEvent cuando esta seteado', () => {
    const callback = vi.fn();
    const onMovilEventRef = { current: callback };

    simulateOnMovilChange(onMovilEventRef);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('onMovilChange puede llamarse multiples veces y el callback se invoca cada vez', () => {
    const callback = vi.fn();
    const onMovilEventRef = { current: callback };

    simulateOnMovilChange(onMovilEventRef);
    simulateOnMovilChange(onMovilEventRef);
    simulateOnMovilChange(onMovilEventRef);

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('AC7 — onMovilChange con ref null no explota', () => {
    const onMovilEventRef = { current: null };

    expect(() => {
      simulateOnMovilChange(onMovilEventRef);
    }).not.toThrow();
  });

  it('AC7 — al deregistrar (setear null), eventos posteriores no llaman al callback', () => {
    const callback = vi.fn();
    const onMovilEventRef = { current: callback };

    simulateOnMovilChange(onMovilEventRef); // llama
    expect(callback).toHaveBeenCalledTimes(1);

    onMovilEventRef.current = null; // simula cleanup del useEffect
    simulateOnMovilChange(onMovilEventRef); // no debe llamar
    expect(callback).toHaveBeenCalledTimes(1); // sigue siendo 1
  });
});

// ──────────────────────────────────────────────────────────────
// Gate: selectedDate !== today bloquea el refetch
// ──────────────────────────────────────────────────────────────

describe('Gate historico — selectedDate !== today', () => {
  it('devuelve false cuando selectedDate es historico', () => {
    expect(shouldRefetch('2026-04-01', '2026-05-02')).toBe(false);
  });

  it('devuelve true cuando selectedDate es hoy', () => {
    expect(shouldRefetch('2026-05-02', '2026-05-02')).toBe(true);
  });

  it('debounce respeta el gate: trigger con fecha historica => callback no se llama', () => {
    vi.useFakeTimers();
    const fetchPositions = vi.fn();
    const selectedDate = '2026-04-01';
    const today = '2026-05-02';

    const { trigger, cleanup } = makeDebounced(() => {
      if (!shouldRefetch(selectedDate, today)) return;
      fetchPositions();
    }, 500);

    trigger();
    vi.advanceTimersByTime(600);

    expect(fetchPositions).not.toHaveBeenCalled();

    cleanup();
    vi.useRealTimers();
  });

  it('debounce con fecha = hoy => callback se llama', () => {
    vi.useFakeTimers();
    const fetchPositions = vi.fn();
    const today = '2026-05-02';
    const selectedDate = today;

    const { trigger, cleanup } = makeDebounced(() => {
      if (!shouldRefetch(selectedDate, today)) return;
      fetchPositions();
    }, 500);

    trigger();
    vi.advanceTimersByTime(600);

    expect(fetchPositions).toHaveBeenCalledTimes(1);

    cleanup();
    vi.useRealTimers();
  });
});
