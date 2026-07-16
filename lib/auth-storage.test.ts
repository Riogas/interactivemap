/**
 * Tests del storage condicional de sesión (Modo Kiosko). Ver `lib/auth-storage.ts`.
 *
 * Entorno vitest = 'node' (sin jsdom, ver vitest.config.ts) → se stubea `window`
 * con dos Storage en memoria (Map-backed), mismo patrón que
 * `lib/realtime-health.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStorage } from './auth-storage';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  } as Storage;
}

describe('authStorage — storage condicional (Modo Kiosko)', () => {
  let mockSessionStorage: Storage;
  let mockLocalStorage: Storage;

  beforeEach(() => {
    mockSessionStorage = createMemoryStorage();
    mockLocalStorage = createMemoryStorage();
    vi.stubGlobal('window', {
      sessionStorage: mockSessionStorage,
      localStorage: mockLocalStorage,
    });
    // Reset explícito: el modo es estado de módulo, persiste entre tests.
    authStorage.setPersistMode('session');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('modo "session" (default) — comportamiento actual, SIN cambios', () => {
    it('setItem escribe en sessionStorage', () => {
      authStorage.setItem('trackmovil_token', 'tok-123');
      expect(mockSessionStorage.getItem('trackmovil_token')).toBe('tok-123');
    });

    it('setItem limpia localStorage aunque haya basura preexistente (condición 2)', () => {
      mockLocalStorage.setItem('trackmovil_token', 'basura-vieja');
      authStorage.setItem('trackmovil_token', 'tok-nuevo');
      expect(mockLocalStorage.getItem('trackmovil_token')).toBeNull();
      expect(mockSessionStorage.getItem('trackmovil_token')).toBe('tok-nuevo');
    });

    it('getPersistMode() refleja "session" por defecto', () => {
      expect(authStorage.getPersistMode()).toBe('session');
    });
  });

  describe('modo "local" (Modo Kiosko)', () => {
    beforeEach(() => {
      authStorage.setPersistMode('local');
    });

    it('setItem escribe en localStorage', () => {
      authStorage.setItem('trackmovil_user', '{"id":"1"}');
      expect(mockLocalStorage.getItem('trackmovil_user')).toBe('{"id":"1"}');
    });

    it('setItem espeja en sessionStorage (evita staleness de getItem)', () => {
      authStorage.setItem('trackmovil_user', '{"id":"1"}');
      expect(mockSessionStorage.getItem('trackmovil_user')).toBe('{"id":"1"}');
    });

    it('getItem devuelve el valor persistido en localStorage', () => {
      authStorage.setItem('trackmovil_token', 'tok-kiosko');
      expect(authStorage.getItem('trackmovil_token')).toBe('tok-kiosko');
    });

    it('getPersistMode() refleja "local"', () => {
      expect(authStorage.getPersistMode()).toBe('local');
    });
  });

  describe('flip "local" → "session" (revocación de ModoKiosko, AC13)', () => {
    it('el siguiente setItem limpia la copia en localStorage', () => {
      authStorage.setPersistMode('local');
      authStorage.setItem('trackmovil_user', '{"id":"kiosko-viejo"}');
      expect(mockLocalStorage.getItem('trackmovil_user')).toBe('{"id":"kiosko-viejo"}');

      // Revocación: próximo login/arranque resuelve ModoKiosko=false.
      authStorage.setPersistMode('session');
      authStorage.setItem('trackmovil_user', '{"id":"usuario-normal"}');

      expect(mockLocalStorage.getItem('trackmovil_user')).toBeNull();
      expect(mockSessionStorage.getItem('trackmovil_user')).toBe('{"id":"usuario-normal"}');
    });

    it('LIMITACIÓN CONOCIDA (documentada en security.md y docs/MODO_KIOSKO.md): ' +
      'el flip de modo por sí solo, SIN un setItem posterior, NO limpia el residuo ' +
      'en localStorage — un mero cold-start/hydrate que re-deriva el modo a "session" ' +
      'no basta para revocar; hace falta un setItem/removeItem real (próximo login o logout)', () => {
      authStorage.setPersistMode('local');
      authStorage.setItem('trackmovil_user', '{"id":"kiosko-viejo"}');
      expect(mockLocalStorage.getItem('trackmovil_user')).toBe('{"id":"kiosko-viejo"}');

      // Solo el flip de modo (equivalente a hydrateFromStorage en un cold start
      // sin login real posterior) — NINGÚN setItem/removeItem se ejecuta.
      authStorage.setPersistMode('session');

      // El residuo sigue ahí: este test documenta el gap MEDIO aceptado por el
      // usuario (Decisión OQ1 punto 5) — si este test empieza a fallar porque
      // ahora SÍ se limpia en el flip, hay que revisar si es una mejora
      // intencional o una regresión de performance/timing.
      expect(mockLocalStorage.getItem('trackmovil_user')).toBe('{"id":"kiosko-viejo"}');
    });
  });

  describe('getItem — fallback a localStorage (migración)', () => {
    it('si sessionStorage está vacío, lee de localStorage', () => {
      mockLocalStorage.setItem('trackmovil_token', 'tok-migrado');
      expect(authStorage.getItem('trackmovil_token')).toBe('tok-migrado');
    });

    it('prioriza sessionStorage sobre localStorage', () => {
      mockSessionStorage.setItem('trackmovil_token', 'tok-session');
      mockLocalStorage.setItem('trackmovil_token', 'tok-local-viejo');
      expect(authStorage.getItem('trackmovil_token')).toBe('tok-session');
    });
  });

  describe('removeItem', () => {
    it('borra la key de ambos storages', () => {
      mockSessionStorage.setItem('trackmovil_token', 'a');
      mockLocalStorage.setItem('trackmovil_token', 'b');
      authStorage.removeItem('trackmovil_token');
      expect(mockSessionStorage.getItem('trackmovil_token')).toBeNull();
      expect(mockLocalStorage.getItem('trackmovil_token')).toBeNull();
    });
  });
});
